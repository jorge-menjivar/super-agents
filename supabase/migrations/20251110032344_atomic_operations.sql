-- ================================================
-- Atomic increment functions
-- ================================================

-- Atomically increment both cluster counters (algorithm + observability)
CREATE OR REPLACE FUNCTION increment_cluster_counters(
  p_cluster_id UUID
)
RETURNS SETOF skill_optimization_clusters AS $$
BEGIN
  RETURN QUERY
  UPDATE skill_optimization_clusters
  SET
    total_steps = total_steps + 1,
    observability_total_requests = observability_total_requests + 1
  WHERE id = p_cluster_id
  RETURNING *;
END;
$$ LANGUAGE plpgsql
SET search_path = public;

COMMENT ON FUNCTION increment_cluster_counters IS 'Atomically increment both total_steps (algorithm) and observability_total_requests (observability) counters';

-- Atomically increment skill total_requests counter
CREATE OR REPLACE FUNCTION increment_skill_total_requests(
  p_skill_id UUID
)
RETURNS SETOF skills AS $$
BEGIN
  RETURN QUERY
  UPDATE skills
  SET total_requests = total_requests + 1
  WHERE id = p_skill_id
  RETURNING *;
END;
$$ LANGUAGE plpgsql
SET search_path = public;

COMMENT ON FUNCTION increment_skill_total_requests IS 'Atomically increment the skill total_requests counter by 1';

-- Atomically update arm stats for multiple evaluations AND increment cluster/skill counters together
-- This ensures all evaluation stats are updated atomically with cluster.total_steps
CREATE OR REPLACE FUNCTION update_arm_and_increment_counters(
  p_arm_id UUID,
  p_evaluation_results JSONB -- Array of {evaluation_id: UUID, score: FLOAT}
)
RETURNS TABLE(
  arm skill_optimization_arms,
  cluster skill_optimization_clusters,
  skill skills
) AS $$
DECLARE
  v_arm skill_optimization_arms;
  v_cluster skill_optimization_clusters;
  v_skill skills;
  v_cluster_id UUID;
  v_skill_id UUID;
  v_agent_id UUID;
  v_result JSONB;
  v_evaluation_id UUID;
  v_score DOUBLE PRECISION;
  v_old_n INTEGER;
  v_old_total_reward DOUBLE PRECISION;
  v_old_n2 DOUBLE PRECISION;
  v_new_n INTEGER;
  v_new_total_reward DOUBLE PRECISION;
  v_new_mean DOUBLE PRECISION;
  v_new_n2 DOUBLE PRECISION;
BEGIN
  -- Get arm metadata (cluster_id, skill_id, agent_id)
  SELECT
    cluster_id,
    skill_id,
    agent_id
  INTO v_cluster_id, v_skill_id, v_agent_id
  FROM skill_optimization_arms
  WHERE id = p_arm_id;

  -- Check if arm exists
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Arm with id % not found', p_arm_id;
  END IF;

  -- Update stats for each evaluation result
  FOR v_result IN SELECT * FROM jsonb_array_elements(p_evaluation_results)
  LOOP
    v_evaluation_id := (v_result->>'evaluation_id')::UUID;
    v_score := (v_result->>'score')::DOUBLE PRECISION;

    -- Get current stats for this arm+evaluation combo
    SELECT
      n,
      total_reward,
      n2
    INTO v_old_n, v_old_total_reward, v_old_n2
    FROM skill_optimization_arm_stats
    WHERE arm_id = p_arm_id AND evaluation_id = v_evaluation_id;

    -- If stats don't exist, initialize to 0
    IF NOT FOUND THEN
      v_old_n := 0;
      v_old_total_reward := 0;
      v_old_n2 := 0;
    END IF;

    -- Calculate new stats using incremental update formulas for Thompson Sampling
    v_new_n := v_old_n + 1;
    v_new_total_reward := v_old_total_reward + v_score;
    v_new_mean := v_new_total_reward / v_new_n;
    v_new_n2 := v_old_n2 + (v_score * v_score);

    -- Upsert arm stats (insert or update)
    INSERT INTO skill_optimization_arm_stats (
      arm_id,
      evaluation_id,
      agent_id,
      skill_id,
      cluster_id,
      n,
      mean,
      n2,
      total_reward
    ) VALUES (
      p_arm_id,
      v_evaluation_id,
      v_agent_id,
      v_skill_id,
      v_cluster_id,
      v_new_n,
      v_new_mean,
      v_new_n2,
      v_new_total_reward
    )
    ON CONFLICT (arm_id, evaluation_id) DO UPDATE SET
      n = v_new_n,
      mean = v_new_mean,
      n2 = v_new_n2,
      total_reward = v_new_total_reward,
      updated_at = CURRENT_TIMESTAMP;
  END LOOP;

  -- Get the updated arm
  SELECT * INTO v_arm
  FROM skill_optimization_arms
  WHERE id = p_arm_id;

  -- Increment cluster counters
  UPDATE skill_optimization_clusters
  SET
    total_steps = total_steps + 1,
    observability_total_requests = observability_total_requests + 1
  WHERE id = v_cluster_id
  RETURNING * INTO v_cluster;

  -- Check if cluster was found and updated
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cluster with id % not found', v_cluster_id;
  END IF;

  -- Increment skill counter
  UPDATE skills
  SET total_requests = total_requests + 1
  WHERE id = v_skill_id
  RETURNING * INTO v_skill;

  -- Check if skill was found and updated
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Skill with id % not found', v_skill_id;
  END IF;

  -- Return all updated entities
  RETURN QUERY SELECT v_arm, v_cluster, v_skill;
END;
$$ LANGUAGE plpgsql
SET search_path = public;

COMMENT ON FUNCTION update_arm_and_increment_counters IS 'Atomically update arm stats for multiple evaluation methods and increment cluster/skill counters in a single transaction. Takes an array of {evaluation_id, score} objects and updates each evaluation stat independently. Ensures all updates happen atomically. Raises an exception if arm, cluster, or skill is not found.';

-- Atomically try to acquire skill evaluation regeneration lock
-- Returns the skill if lock was acquired, NULL if already locked or completed
CREATE OR REPLACE FUNCTION try_acquire_evaluation_lock(
  p_skill_id UUID,
  p_lock_timeout_seconds INTEGER DEFAULT 300
)
RETURNS SETOF skills AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_lock_cutoff TIMESTAMPTZ := v_now - (p_lock_timeout_seconds || ' seconds')::INTERVAL;
BEGIN
  RETURN QUERY
  UPDATE skills
  SET evaluation_lock_acquired_at = v_now
  WHERE id = p_skill_id
    -- Not already completed
    AND evaluations_regenerated_at IS NULL
    -- No lock exists, or lock is stale
    AND (
      evaluation_lock_acquired_at IS NULL
      OR evaluation_lock_acquired_at < v_lock_cutoff
    )
  RETURNING *;
END;
$$ LANGUAGE plpgsql
SET search_path = public;

-- Release evaluation regeneration lock
CREATE OR REPLACE FUNCTION release_evaluation_lock(
  p_skill_id UUID
)
RETURNS SETOF skills AS $$
BEGIN
  RETURN QUERY
  UPDATE skills
  SET evaluation_lock_acquired_at = NULL
  WHERE id = p_skill_id
  RETURNING *;
END;
$$ LANGUAGE plpgsql
SET search_path = public;

-- ================================================
-- Cluster Reflection Lock Functions
-- ================================================

-- Atomically try to acquire cluster reflection lock
-- Returns the cluster if lock was acquired, NULL if already locked
CREATE OR REPLACE FUNCTION acquire_cluster_reflection_lock(
  p_cluster_id UUID,
  p_lock_timeout_seconds INT DEFAULT 600  -- 10 minutes
)
RETURNS SETOF skill_optimization_clusters AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_lock_cutoff TIMESTAMPTZ := v_now - (p_lock_timeout_seconds || ' seconds')::INTERVAL;
BEGIN
  RETURN QUERY
  UPDATE skill_optimization_clusters
  SET reflection_lock_acquired_at = v_now
  WHERE id = p_cluster_id
    -- No lock exists, or lock is stale
    AND (
      reflection_lock_acquired_at IS NULL
      OR reflection_lock_acquired_at < v_lock_cutoff
    )
  RETURNING *;
END;
$$ LANGUAGE plpgsql
SET search_path = public;

COMMENT ON FUNCTION acquire_cluster_reflection_lock IS 'Atomically acquire reflection lock for a cluster if no valid lock exists. Returns cluster if successful, empty if lock already held.';

-- Release cluster reflection lock
CREATE OR REPLACE FUNCTION release_cluster_reflection_lock(
  p_cluster_id UUID
)
RETURNS SETOF skill_optimization_clusters AS $$
BEGIN
  RETURN QUERY
  UPDATE skill_optimization_clusters
  SET reflection_lock_acquired_at = NULL
  WHERE id = p_cluster_id
  RETURNING *;
END;
$$ LANGUAGE plpgsql
SET search_path = public;

COMMENT ON FUNCTION release_cluster_reflection_lock IS 'Release reflection lock for a cluster.';

-- Atomically try to acquire reclustering lock
-- Returns the skill if lock was acquired, NULL if already locked
CREATE OR REPLACE FUNCTION try_acquire_reclustering_lock(
  p_skill_id UUID,
  p_lock_timeout_ms INTEGER DEFAULT 60000
)
RETURNS SETOF skills AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_lock_cutoff TIMESTAMPTZ := v_now - ((p_lock_timeout_ms / 1000.0) || ' seconds')::INTERVAL;
BEGIN
  RETURN QUERY
  UPDATE skills
  SET last_clustering_at = v_now
  WHERE id = p_skill_id
    -- No lock exists, or lock is stale
    AND (
      last_clustering_at IS NULL
      OR last_clustering_at < v_lock_cutoff
    )
  RETURNING *;
END;
$$ LANGUAGE plpgsql
SET search_path = public;

COMMENT ON FUNCTION try_acquire_reclustering_lock IS 'Atomically acquire reclustering lock by updating last_clustering_at only if it is older than the timeout threshold. Returns the skill if lock was acquired, NULL if already locked.';

-- Complete evaluation regeneration (mark complete and release lock atomically)
CREATE OR REPLACE FUNCTION complete_evaluation_regeneration(
  p_skill_id UUID
)
RETURNS SETOF skills AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
BEGIN
  RETURN QUERY
  UPDATE skills
  SET
    evaluations_regenerated_at = v_now,
    evaluation_lock_acquired_at = NULL
  WHERE id = p_skill_id
  RETURNING *;
END;
$$ LANGUAGE plpgsql
SET search_path = public;

-- Reset all cluster total_steps for a skill atomically
-- Useful after soft reset when regenerating evaluations
CREATE OR REPLACE FUNCTION reset_skill_cluster_steps(
  p_skill_id UUID
)
RETURNS TABLE(cluster_id UUID, old_steps INTEGER, new_steps INTEGER) AS $$
BEGIN
  RETURN QUERY
  UPDATE skill_optimization_clusters
  SET total_steps = 0
  WHERE skill_id = p_skill_id
  RETURNING id, total_steps, 0;
END;
$$ LANGUAGE plpgsql
SET search_path = public;

-- ================================================
-- Evaluation Scores View and Time-Bucketing Function
-- ================================================

-- Create a view that extracts evaluation scores from evaluation runs
-- This is more efficient than fetching full JSONB results for charts
CREATE VIEW evaluation_runs_with_scores
WITH (security_invoker = true)
AS
SELECT
  er.id,
  er.agent_id,
  er.skill_id,
  er.cluster_id,
  er.log_id,
  er.created_at,
  -- Calculate weighted average score
  (
    SELECT SUM((result->>'score')::FLOAT * e.weight) / NULLIF(SUM(e.weight), 0)
    FROM jsonb_array_elements(er.results) AS result
    INNER JOIN skill_optimization_evaluations e ON e.id = (result->>'evaluation_id')::UUID
  ) AS avg_score,
  -- Aggregate scores by evaluation method name (not ID)
  (
    SELECT jsonb_object_agg(
      e.evaluation_method,
      (result->>'score')::FLOAT
    )
    FROM jsonb_array_elements(er.results) AS result
    INNER JOIN skill_optimization_evaluations e ON e.id = (result->>'evaluation_id')::UUID
  ) AS scores_by_evaluation
FROM skill_optimization_evaluation_runs er;

-- Create a function to aggregate scores by time buckets
-- This allows flexible time bucketing (1min, 5min, 30min, 1hour, 1day) without separate views
CREATE OR REPLACE FUNCTION get_evaluation_scores_by_time_bucket(
  p_agent_id UUID DEFAULT NULL,
  p_skill_id UUID DEFAULT NULL,
  p_cluster_id UUID DEFAULT NULL,
  p_interval INTERVAL DEFAULT '1 hour',
  p_start_time TIMESTAMPTZ DEFAULT NOW() - INTERVAL '24 hours',
  p_end_time TIMESTAMPTZ DEFAULT NOW(),
  -- Also return the bucket nearest outside each end of the range, per series:
  -- what a chart needs to draw a line as it crosses its window rather than as
  -- it starts. Off by default, so every existing caller is unaffected.
  p_edge_buckets BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
  time_bucket TIMESTAMPTZ,
  agent_id UUID,
  skill_id UUID,
  cluster_id UUID,
  avg_score FLOAT,
  scores_by_evaluation JSONB,
  count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  WITH edge_runs AS (
    -- The nearest run beyond each end of the range, one per series.
    --
    -- Two ordered lookups rather than a pass over the series' history: this is
    -- the whole point of the flag, so it must not cost what asking for a wider
    -- range cost. `idx_evaluation_runs_series_created` matches this key order,
    -- which is what keeps it a seek.
    (
      SELECT DISTINCT ON (ers.agent_id, ers.skill_id, ers.cluster_id)
        ers.agent_id AS aid,
        ers.skill_id AS sid,
        ers.cluster_id AS cid,
        ers.created_at AS at
      FROM evaluation_runs_with_scores ers
      WHERE p_edge_buckets
        AND ers.created_at < p_start_time
        AND (p_agent_id IS NULL OR ers.agent_id = p_agent_id)
        AND (p_skill_id IS NULL OR ers.skill_id = p_skill_id)
        AND (p_cluster_id IS NULL OR ers.cluster_id = p_cluster_id)
      ORDER BY ers.agent_id, ers.skill_id, ers.cluster_id, ers.created_at DESC
    )
    UNION ALL
    (
      SELECT DISTINCT ON (ers.agent_id, ers.skill_id, ers.cluster_id)
        ers.agent_id, ers.skill_id, ers.cluster_id, ers.created_at
      FROM evaluation_runs_with_scores ers
      WHERE p_edge_buckets
        AND ers.created_at > p_end_time
        AND (p_agent_id IS NULL OR ers.agent_id = p_agent_id)
        AND (p_skill_id IS NULL OR ers.skill_id = p_skill_id)
        AND (p_cluster_id IS NULL OR ers.cluster_id = p_cluster_id)
      ORDER BY ers.agent_id, ers.skill_id, ers.cluster_id, ers.created_at ASC
    )
  ),
  edge_buckets AS (
    -- Those runs name a bucket; the bucket is then read whole below, because
    -- its score is the mean of every run in it and not of the one that found it.
    SELECT
      aid,
      sid,
      cid,
      to_timestamp(
        FLOOR(EXTRACT(EPOCH FROM at) / EXTRACT(EPOCH FROM p_interval))
          * EXTRACT(EPOCH FROM p_interval)
      ) AS bucket_start
    FROM edge_runs
  ),
  bucketed_runs AS (
    SELECT
      -- Floored to a multiple of the interval from the epoch, which is where
      -- the libSQL connector and the charts put their buckets too.
      --
      -- This used to read `date_trunc('hour', …) + (seconds past the hour /
      -- interval)::INTEGER * interval`, which is wrong twice over: a cast to
      -- INTEGER rounds rather than truncates, so a run at 10:40 was filed
      -- under the 11:00 bucket -- a bucket that starts after the run that is
      -- in it -- and starting from the hour leaves every interval longer than
      -- an hour off the grid, a six-hour bucket beginning at 10:00.
      to_timestamp(
        FLOOR(EXTRACT(EPOCH FROM ers.created_at) / EXTRACT(EPOCH FROM p_interval))
          * EXTRACT(EPOCH FROM p_interval)
      ) AS bucket,
      ers.agent_id AS aid,
      ers.skill_id AS sid,
      ers.cluster_id AS cid,
      ers.avg_score,
      ers.scores_by_evaluation
    FROM evaluation_runs_with_scores ers
    WHERE (p_agent_id IS NULL OR ers.agent_id = p_agent_id)
      AND (p_skill_id IS NULL OR ers.skill_id = p_skill_id)
      AND (p_cluster_id IS NULL OR ers.cluster_id = p_cluster_id)
      AND (
        (ers.created_at >= p_start_time AND ers.created_at <= p_end_time)
        OR EXISTS (
          SELECT 1
          FROM edge_buckets eb
          WHERE eb.aid = ers.agent_id
            AND eb.sid = ers.skill_id
            AND (eb.cid = ers.cluster_id OR (eb.cid IS NULL AND ers.cluster_id IS NULL))
            AND ers.created_at >= eb.bucket_start
            AND ers.created_at < eb.bucket_start + p_interval
        )
      )
  ),
  aggregated_by_bucket AS (
    SELECT
      bucket,
      aid,
      sid,
      cid,
      scores.key AS evaluation_method,
      AVG((scores.value)::float) AS avg_value
    FROM bucketed_runs
    CROSS JOIN LATERAL jsonb_each_text(bucketed_runs.scores_by_evaluation) AS scores
    GROUP BY bucket, aid, sid, cid, scores.key
  )
  SELECT
    aggregated_by_bucket.bucket AS time_bucket,
    aggregated_by_bucket.aid AS agent_id,
    aggregated_by_bucket.sid AS skill_id,
    aggregated_by_bucket.cid AS cluster_id,
    -- Recalculate weighted average using current evaluation weights
    (
      SELECT SUM(ab2.avg_value * COALESCE(e.weight, 1.0)) / NULLIF(SUM(COALESCE(e.weight, 1.0)), 0)
      FROM aggregated_by_bucket ab2
      LEFT JOIN skill_optimization_evaluations e
        ON e.skill_id = aggregated_by_bucket.sid
        AND e.evaluation_method = ab2.evaluation_method
      WHERE ab2.bucket = aggregated_by_bucket.bucket
        AND ab2.aid = aggregated_by_bucket.aid
        AND ab2.sid = aggregated_by_bucket.sid
        AND (ab2.cid = aggregated_by_bucket.cid OR (ab2.cid IS NULL AND aggregated_by_bucket.cid IS NULL))
    ) AS avg_score,
    jsonb_object_agg(
      aggregated_by_bucket.evaluation_method,
      aggregated_by_bucket.avg_value
    ) AS scores_by_evaluation,
    (
      SELECT COUNT(*)
      FROM bucketed_runs br
      WHERE br.bucket = aggregated_by_bucket.bucket
        AND br.aid = aggregated_by_bucket.aid
        AND br.sid = aggregated_by_bucket.sid
        AND (br.cid = aggregated_by_bucket.cid OR (br.cid IS NULL AND aggregated_by_bucket.cid IS NULL))
    ) AS count
  FROM aggregated_by_bucket
  GROUP BY aggregated_by_bucket.bucket, aggregated_by_bucket.aid, aggregated_by_bucket.sid, aggregated_by_bucket.cid
  ORDER BY aggregated_by_bucket.bucket ASC;
END;
$$ LANGUAGE plpgsql
SET search_path = public;

-- Add comments explaining the view and function
COMMENT ON VIEW evaluation_runs_with_scores IS
'Materialized scores from evaluation runs for efficient chart queries. avg_score is WEIGHTED by evaluation weights. scores_by_evaluation uses method names (e.g., "task_completion") as keys. Uses SECURITY INVOKER to respect querying user''s RLS policies.';

COMMENT ON FUNCTION get_evaluation_scores_by_time_bucket IS
'Aggregates evaluation scores into time buckets with scores broken down by evaluation method. Returns avg_score (correctly weighted using current evaluation weights) and scores_by_evaluation for displaying per-method charts. With p_edge_buckets, also returns the bucket nearest outside each end of the range per series, which is what lets a chart draw a line crossing its window.';
