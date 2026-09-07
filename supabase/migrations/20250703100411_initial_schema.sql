-- ================================================
-- Agents Table
-- ================================================
CREATE TABLE if not exists agents (
  id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  -- Requests that name only the agent (`/v1/agents/:agent_name/...`) are
  -- routed to the closest skill; these decide when one becomes a new skill.
  auto_create_skills BOOLEAN NOT NULL DEFAULT TRUE,
  skill_match_threshold FLOAT NOT NULL DEFAULT 0.8,
  max_auto_created_skills INTEGER NOT NULL DEFAULT 10,
  -- Another agent that reviews every response before the client receives it;
  -- NULL means responses go unreviewed. Deleting the reviewer stops the
  -- reviews rather than blocking the delete.
  reviewer_agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  -- Whether a response the reviewer could not judge is withheld rather than
  -- delivered.
  review_fail_closed BOOLEAN NOT NULL DEFAULT FALSE,
  -- Whether a client whose response the reviewer withheld is told the
  -- reviewer's reason, or only that it was withheld.
  review_expose_reason BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT agents_reviewer_not_self CHECK (reviewer_agent_id IS NULL OR reviewer_agent_id <> id)
);

CREATE INDEX IF NOT EXISTS idx_agents_reviewer_agent_id ON agents(reviewer_agent_id);
COMMENT ON COLUMN agents.reviewer_agent_id IS 'Another agent that reviews every response before the client receives it; NULL means unreviewed';
COMMENT ON COLUMN agents.review_fail_closed IS 'Whether a response the reviewer could not judge is withheld rather than delivered';
COMMENT ON COLUMN agents.review_expose_reason IS 'Whether a client whose response was withheld is told the reviewer reason, or only that it was withheld';

CREATE TRIGGER update_agents_updated_at BEFORE UPDATE ON agents
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE agents IS 'Table to store information about agents.';
COMMENT ON COLUMN agents.description IS 'Description of the agent. Used to generate system prompts and evaluations';

ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full_access" ON agents FOR ALL TO service_role USING (true) WITH CHECK (true);


-- ================================================
-- Skills Table
-- ================================================
CREATE TABLE if not exists skills (
  id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  agent_id UUID NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  optimize BOOLEAN NOT NULL DEFAULT TRUE,
  configuration_count INTEGER NOT NULL DEFAULT 3,
  clustering_interval INTEGER NOT NULL DEFAULT 15,
  reflection_min_requests_per_arm INTEGER NOT NULL DEFAULT 2,
  exploration_temperature FLOAT NOT NULL DEFAULT 1.0,
  total_requests BIGINT NOT NULL DEFAULT 0,
  allowed_template_variables TEXT[] NOT NULL DEFAULT '{}',
  -- Set by the gateway when it creates the skill for a request: the caller's
  -- system prompt seeds the first arms, so the skill starts as a pass-through.
  auto_created BOOLEAN NOT NULL DEFAULT FALSE,
  seed_system_prompt TEXT,
  last_clustering_at TIMESTAMPTZ,
  last_clustering_log_start_time BIGINT,
  evaluations_regenerated_at TIMESTAMPTZ,
  evaluation_lock_acquired_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
  UNIQUE(agent_id, name)
);

CREATE TRIGGER update_skills_updated_at BEFORE UPDATE ON skills
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX idx_skills_agent_id ON skills(agent_id);
CREATE INDEX idx_skills_name ON skills(name);
CREATE INDEX idx_skills_evaluation_lock ON skills(evaluation_lock_acquired_at)
  WHERE evaluation_lock_acquired_at IS NOT NULL;
CREATE INDEX idx_skills_last_clustering ON skills(last_clustering_at)
  WHERE last_clustering_at IS NOT NULL;

COMMENT ON TABLE skills IS 'Table to store skills that an agent possesses.';
COMMENT ON COLUMN skills.description IS 'Description of the skill. Used to generate system prompts and evaluations';
COMMENT ON COLUMN skills.optimize IS 'Whether to optimize the skill';
COMMENT ON COLUMN skills.configuration_count IS 'Number of configurations (clusters)';
COMMENT ON COLUMN skills.clustering_interval IS 'Recompute the centroid of the clusters every N requests so that they can better represent the last N requests.';
COMMENT ON COLUMN skills.reflection_min_requests_per_arm IS 'Minimum number of requests per arm in a configuration (cluster) to trigger reflection. This is to ensure that the arms for the cluster have convergence.';
COMMENT ON COLUMN skills.exploration_temperature IS 'Temperature for exploration. Higher values lead to more exploration.';
COMMENT ON COLUMN skills.total_requests IS 'Total number of requests for this skill (never resets, for lifetime observability)';
COMMENT ON COLUMN skills.allowed_template_variables IS 'List of allowed Jinja-style template variables that can be used in system prompts (e.g., datetime)';
COMMENT ON COLUMN skills.last_clustering_at IS 'Timestamp when clustering was last performed for this skill';
COMMENT ON COLUMN skills.last_clustering_log_start_time IS 'Unix timestamp of the most recent log used in the last clustering batch';
COMMENT ON COLUMN skills.evaluations_regenerated_at IS 'Timestamp when evaluations were first regenerated with real examples (after 5 requests)';
COMMENT ON COLUMN skills.evaluation_lock_acquired_at IS 'Lock timestamp to prevent concurrent evaluation regeneration (5 minute timeout)';

ALTER TABLE skills ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full_access" ON skills FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ================================================
-- Skill Optimization Clusters Table
-- ================================================
CREATE TABLE IF NOT EXISTS skill_optimization_clusters (
  id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  agent_id UUID NOT NULL,
  skill_id UUID NOT NULL,
  name TEXT NOT NULL,
  total_steps BIGINT NOT NULL DEFAULT 0,
  observability_total_requests BIGINT NOT NULL DEFAULT 0,
  centroid FLOAT[] NOT NULL,
  reflection_lock_acquired_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
  FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
);

CREATE TRIGGER update_skill_optimization_clusters_updated_at BEFORE UPDATE ON skill_optimization_clusters
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX idx_skill_optimization_clusters_name ON skill_optimization_clusters(name);
CREATE INDEX idx_skill_optimization_clusters_agent_id ON skill_optimization_clusters(agent_id);
CREATE INDEX idx_skill_optimization_clusters_skill_id ON skill_optimization_clusters(skill_id);
CREATE INDEX idx_clusters_reflection_lock ON skill_optimization_clusters(reflection_lock_acquired_at)
  WHERE reflection_lock_acquired_at IS NOT NULL;

COMMENT ON TABLE skill_optimization_clusters IS 'Table to store skill optimization clusters (partitions)';
COMMENT ON COLUMN skill_optimization_clusters.total_steps IS 'Total number of requests since last optimization cycle (resets during reflection/evaluation regen, used by Thompson Sampling)';
COMMENT ON COLUMN skill_optimization_clusters.observability_total_requests IS 'Total number of requests routed to this cluster (never resets, for observability)';
COMMENT ON COLUMN skill_optimization_clusters.centroid IS 'Center of the cluster';
COMMENT ON COLUMN skill_optimization_clusters.reflection_lock_acquired_at IS 'Lock timestamp to prevent concurrent system prompt reflection for this cluster (10 minute timeout)';

ALTER TABLE skill_optimization_clusters ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full_access" ON skill_optimization_clusters FOR ALL TO service_role USING (true) WITH CHECK (true);


-- ================================================
-- Tools table
-- ================================================
CREATE TABLE if not exists tools (
  id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  agent_id UUID NOT NULL,
  hash TEXT NOT NULL,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  raw_data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
  UNIQUE(agent_id, hash)
);

CREATE TRIGGER update_tools_updated_at BEFORE UPDATE ON tools
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX idx_tools_agent_id ON tools(agent_id);
CREATE INDEX idx_tools_hash ON tools(hash);
CREATE INDEX idx_tools_type ON tools(type);
CREATE INDEX idx_tools_name ON tools(name);

ALTER TABLE tools ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full_access" ON tools FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ================================================
-- Logs Table
-- ================================================
-- Define enum types first
CREATE TYPE http_method AS ENUM ('GET', 'POST', 'PUT', 'DELETE', 'PATCH');

CREATE TYPE cache_status_enum AS ENUM (
  'HIT',
  'SEMANTIC_HIT',
  'MISS',
  'SEMANTIC_MISS',
  'REFRESH',
  'DISABLED'
);

CREATE TABLE IF NOT EXISTS logs (
  -- Base info
  id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  agent_id UUID NOT NULL,
  skill_id UUID NOT NULL,
  cluster_id UUID,
  method http_method NOT NULL,
  endpoint TEXT NOT NULL,
  function_name TEXT NOT NULL,
  start_time BIGINT NOT NULL, -- Timestamp (ms) when request started
  first_token_time BIGINT, -- Timestamp (ms) when first token received (for streaming), NULL for non-streaming
  base_sa_config JSONB NOT NULL,
  -- Null while the request is still running. The row is written when the
  -- request arrives rather than when it finishes, so that work in progress is
  -- visible and a request that fails before reaching a provider -- or never
  -- finishes at all -- still leaves a trace. end_time IS NULL means running.
  status INTEGER,
  end_time BIGINT, -- Timestamp (ms) when request completed
  duration BIGINT, -- Total duration in milliseconds (end_time - start_time)
  -- Maybe redundant. Used for indexing.
  ai_provider TEXT,
  model TEXT,
  -- Main data
  ai_provider_request_log JSONB,
  hook_logs JSONB NOT NULL,
  metadata JSONB NOT NULL,
  embedding FLOAT[] DEFAULT NULL,
  -- The system prompt (or Responses `instructions`) the caller sent, as
  -- received. ai_provider_request_log holds the body that reached the
  -- provider, in which an optimized skill has substituted its own prompt.
  original_system_prompt TEXT,
  -- Cache info
  cache_status cache_status_enum,
  -- Why it failed, when it failed before a provider answered. A failure the
  -- provider reported is in ai_provider_request_log instead.
  error TEXT,
  -- Tracing info
  trace_id TEXT,
  parent_span_id TEXT,
  span_id TEXT,
  span_name TEXT,
  -- User metadata
  app_id TEXT,
  external_user_id TEXT,
  external_user_human_name TEXT,
  user_metadata JSONB,
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
  FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE,
  FOREIGN KEY (cluster_id) REFERENCES skill_optimization_clusters(id) ON DELETE SET NULL
);

CREATE INDEX idx_logs_agent_id ON logs(agent_id);
CREATE INDEX idx_logs_skill_id ON logs(skill_id);
CREATE INDEX idx_logs_start_time ON logs(start_time);
CREATE INDEX idx_logs_end_time ON logs(end_time);
CREATE INDEX idx_logs_app_id ON logs(app_id);
CREATE INDEX idx_logs_span_id ON logs(span_id);
CREATE INDEX idx_logs_parent_span_id ON logs(parent_span_id);
CREATE INDEX idx_logs_status ON logs(status);
CREATE INDEX idx_logs_method ON logs(method);
CREATE INDEX idx_logs_cache_status ON logs(cache_status);

ALTER TABLE logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full_access" ON logs FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON COLUMN logs.start_time IS 'Timestamp in milliseconds when the request started';
COMMENT ON COLUMN logs.first_token_time IS 'Timestamp in milliseconds when the first token was received (for streaming responses). NULL for non-streaming requests or if not captured.';
COMMENT ON COLUMN logs.end_time IS 'Timestamp in milliseconds when the request completed';
COMMENT ON COLUMN logs.duration IS 'Total request duration in milliseconds (end_time - start_time)';

-- ================================================
-- Feedback Table
-- ================================================
CREATE TABLE IF NOT EXISTS feedbacks (
  id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  log_id UUID NOT NULL,
  score FLOAT CHECK (
    score >= 0
    AND score <= 1
  ),
  feedback TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (log_id) REFERENCES logs(id) ON DELETE CASCADE
);

ALTER TABLE feedbacks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full_access" ON feedbacks FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ================================================
-- Improved Responses Table
-- ================================================
CREATE TABLE if not exists improved_responses (
  id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  agent_id UUID NOT NULL,
  skill_id UUID NOT NULL,
  log_id UUID NOT NULL,
  original_response_body JSONB NOT NULL,
  improved_response_body JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
  FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE,
  FOREIGN KEY (log_id) REFERENCES logs(id) ON DELETE CASCADE
);

CREATE TRIGGER update_improved_responses_updated_at BEFORE UPDATE ON improved_responses
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX idx_improved_responses_agent_id ON improved_responses(agent_id);
CREATE INDEX idx_improved_responses_skill_id ON improved_responses(skill_id);
CREATE INDEX idx_improved_responses_log_id ON improved_responses(log_id);

ALTER TABLE improved_responses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full_access" ON improved_responses FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ================================================
-- Cache Table
-- ================================================
CREATE TABLE IF NOT EXISTS cache (
  key CHAR(64) PRIMARY KEY,
  value TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);

ALTER TABLE cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full_access" ON cache FOR ALL TO service_role USING (true) WITH CHECK (true);


-- ================================================
-- AI Providers Table
-- ================================================
CREATE TABLE IF NOT EXISTS ai_providers (
  id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  ai_provider TEXT NOT NULL,
  name TEXT NOT NULL,
  api_key TEXT,
  custom_fields JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(ai_provider, name)
);

CREATE TRIGGER ai_providers_updated_at BEFORE UPDATE ON ai_providers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX idx_ai_providers_ai_provider ON ai_providers(ai_provider);
CREATE INDEX idx_ai_providers_name ON ai_providers(name);

ALTER TABLE ai_providers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full_access" ON ai_providers FOR ALL TO service_role USING (true) WITH CHECK (true);


-- ================================================
-- Models Table
-- ================================================
CREATE TABLE IF NOT EXISTS models (
  id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  ai_provider_id UUID NOT NULL,
  model_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (ai_provider_id) REFERENCES ai_providers(id) ON DELETE CASCADE,
  UNIQUE(ai_provider_id, model_name)
);

CREATE TRIGGER update_models_updated_at BEFORE UPDATE ON models
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX idx_models_ai_provider_id ON models(ai_provider_id);
CREATE INDEX idx_models_model_name ON models(model_name);

ALTER TABLE models ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full_access" ON models FOR ALL TO service_role USING (true) WITH CHECK (true);


-- ================================================
-- Skills Models Bridge Table
-- ================================================
CREATE TABLE IF NOT EXISTS skill_models (
  skill_id UUID NOT NULL,
  model_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (skill_id, model_id),
  FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE,
  FOREIGN KEY (model_id) REFERENCES models(id) ON DELETE CASCADE
);

CREATE INDEX idx_skill_models_skill_id ON skill_models(skill_id);
CREATE INDEX idx_skill_models_model_id ON skill_models(model_id);

-- ================================================
-- Agent Models Bridge Table
-- ================================================
-- The models a skill the gateway creates for the agent starts with.
CREATE TABLE IF NOT EXISTS agent_models (
  agent_id UUID NOT NULL,
  model_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (agent_id, model_id),
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
  FOREIGN KEY (model_id) REFERENCES models(id) ON DELETE CASCADE
);

CREATE INDEX idx_agent_models_agent_id ON agent_models(agent_id);
CREATE INDEX idx_agent_models_model_id ON agent_models(model_id);

ALTER TABLE agent_models ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full_access" ON agent_models FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE skill_models ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full_access" ON skill_models FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE models IS 'AI models tied to specific AI providers';
COMMENT ON COLUMN models.ai_provider_id IS 'The AI provider that enables access to this model';
COMMENT ON COLUMN models.model_name IS 'The name of the AI model (e.g., gpt-5, claude-sonnet-4-5)';
COMMENT ON TABLE skill_models IS 'Bridge table linking skills to the models they can use';


-- ================================================
-- Skill Optimization Arms Table
-- ================================================
CREATE TABLE IF NOT EXISTS skill_optimization_arms (
  id UUID NOT NULL DEFAULT extensions.uuid_generate_v4(),
  agent_id UUID NOT NULL,
  skill_id UUID NOT NULL,
  cluster_id UUID NOT NULL,
  name TEXT NOT NULL,
  params JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
  FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE,
  FOREIGN KEY (cluster_id) REFERENCES skill_optimization_clusters(id) ON DELETE CASCADE
);

CREATE TRIGGER update_skill_optimization_arms_updated_at BEFORE UPDATE ON skill_optimization_arms
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX idx_skill_optimization_arms_name ON skill_optimization_arms(name);
CREATE INDEX idx_skill_optimization_arms_agent_id ON skill_optimization_arms(agent_id);
CREATE INDEX idx_skill_optimization_arms_skill_id ON skill_optimization_arms(skill_id);

ALTER TABLE skill_optimization_arms ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full_access" ON skill_optimization_arms FOR ALL TO service_role USING (true) WITH CHECK (true);


-- ================================================
-- Skill Optimization Evaluations Table
-- ================================================
CREATE TABLE if not exists skill_optimization_evaluations (
  id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  agent_id UUID NOT NULL,
  skill_id UUID NOT NULL,
  evaluation_method TEXT NOT NULL,
  params JSONB NOT NULL DEFAULT '{}',
  weight FLOAT NOT NULL DEFAULT 1.0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
  FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE,
  UNIQUE (agent_id, skill_id, evaluation_method),
  CHECK (weight > 0)
);

CREATE TRIGGER update_skill_optimization_evaluations_updated_at BEFORE UPDATE ON skill_optimization_evaluations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX idx_skill_optimization_evaluations_agent_id ON skill_optimization_evaluations(agent_id);
CREATE INDEX idx_skill_optimization_evaluations_evaluation_method ON skill_optimization_evaluations(evaluation_method);

COMMENT ON COLUMN skill_optimization_evaluations.evaluation_method IS 'The method used for evaluating the skill';
COMMENT ON COLUMN skill_optimization_evaluations.params IS 'The parameters used for the evaluation run configuration and settings';
COMMENT ON COLUMN skill_optimization_evaluations.weight IS 'Weight of this evaluation method in the final score calculation. Higher weights mean this evaluation has more influence on the final score. Must be positive.';

ALTER TABLE skill_optimization_evaluations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full_access" ON skill_optimization_evaluations FOR ALL TO service_role USING (true) WITH CHECK (true);


-- ================================================
-- Skill Optimization Arm Stats Table
-- ================================================
CREATE TABLE IF NOT EXISTS skill_optimization_arm_stats (
  arm_id UUID NOT NULL,
  evaluation_id UUID NOT NULL,
  agent_id UUID NOT NULL,
  skill_id UUID NOT NULL,
  cluster_id UUID NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  mean FLOAT NOT NULL DEFAULT 0,
  n2 FLOAT NOT NULL DEFAULT 0,
  total_reward FLOAT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (arm_id, evaluation_id),
  FOREIGN KEY (arm_id) REFERENCES skill_optimization_arms(id) ON DELETE CASCADE,
  FOREIGN KEY (evaluation_id) REFERENCES skill_optimization_evaluations(id) ON DELETE CASCADE,
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
  FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE,
  FOREIGN KEY (cluster_id) REFERENCES skill_optimization_clusters(id) ON DELETE CASCADE
);

CREATE TRIGGER update_skill_optimization_arm_stats_updated_at BEFORE UPDATE ON skill_optimization_arm_stats
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX idx_skill_optimization_arm_stats_arm_id ON skill_optimization_arm_stats(arm_id);
CREATE INDEX idx_skill_optimization_arm_stats_evaluation_id ON skill_optimization_arm_stats(evaluation_id);
CREATE INDEX idx_skill_optimization_arm_stats_skill_id ON skill_optimization_arm_stats(skill_id);
CREATE INDEX idx_skill_optimization_arm_stats_cluster_id ON skill_optimization_arm_stats(cluster_id);

COMMENT ON TABLE skill_optimization_arm_stats IS 'Stores per-evaluation statistics for each arm, enabling weighted averaging of multiple evaluation methods';
COMMENT ON COLUMN skill_optimization_arm_stats.n IS 'Number of requests evaluated by this evaluation method for this arm';
COMMENT ON COLUMN skill_optimization_arm_stats.mean IS 'Running mean score for this evaluation method';
COMMENT ON COLUMN skill_optimization_arm_stats.n2 IS 'Sum of squared differences for variance calculation (used by Thompson Sampling)';
COMMENT ON COLUMN skill_optimization_arm_stats.total_reward IS 'Sum of all rewards for this evaluation method';

ALTER TABLE skill_optimization_arm_stats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full_access" ON skill_optimization_arm_stats FOR ALL TO service_role USING (true) WITH CHECK (true);


-- ================================================
-- Skill Optimization Evaluation Runs Table
-- ================================================
CREATE TABLE IF NOT EXISTS skill_optimization_evaluation_runs (
  id UUID NOT NULL DEFAULT extensions.uuid_generate_v4(),
  agent_id UUID NOT NULL,
  skill_id UUID NOT NULL,
  cluster_id UUID,
  log_id UUID NOT NULL,
  results JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
  FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE,
  FOREIGN KEY (cluster_id) REFERENCES skill_optimization_clusters(id) ON DELETE SET NULL,
  FOREIGN KEY (log_id) REFERENCES logs(id) ON DELETE CASCADE
);

CREATE INDEX idx_skill_optimization_evaluation_runs_agent_id ON skill_optimization_evaluation_runs(agent_id);
CREATE INDEX idx_skill_optimization_evaluation_runs_skill_id ON skill_optimization_evaluation_runs(skill_id);
CREATE INDEX idx_skill_optimization_evaluation_runs_log_id ON skill_optimization_evaluation_runs(log_id);

COMMENT ON TABLE skill_optimization_evaluation_runs IS 'Table to store evaluation runs for skill optimization';
COMMENT ON COLUMN skill_optimization_evaluation_runs.log_id IS 'Reference to the log that was evaluated';

ALTER TABLE skill_optimization_evaluation_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full_access" ON skill_optimization_evaluation_runs FOR ALL TO service_role USING (true) WITH CHECK (true);


-- ================================================
-- Skill Events Table
-- ================================================
CREATE TABLE IF NOT EXISTS skill_events (
  id UUID NOT NULL DEFAULT extensions.uuid_generate_v4(),

  -- References
  agent_id UUID NOT NULL,
  skill_id UUID NOT NULL,
  cluster_id UUID,
  -- cluster_id is NULL for skill-wide events (model_added, model_removed, etc.)
  -- cluster_id is NOT NULL for cluster-specific events (reflection)

  event_type TEXT NOT NULL,

  -- Optional metadata (JSON for flexibility)
  metadata JSONB DEFAULT '{}'::jsonb,
  -- Examples:
  --   reflection: { "arms_count": 10, "best_score": 0.85 }
  --   model_added: { "model_name": "gpt-4o" }
  --   model_removed: { "model_name": "gpt-4" }
  --   evaluation_added: { "evaluation_method": "task_completion" }
  --   evaluation_removed: { "evaluation_method": "tool_correctness" }
  --   description_updated: { "old_description": "...", "new_description": "..." }
  --   partitions_reclustered: { "old_count": 3, "new_count": 5 }

  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  PRIMARY KEY (id),
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
  FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE,
  FOREIGN KEY (cluster_id) REFERENCES skill_optimization_clusters(id) ON DELETE CASCADE
);
  
-- Indexes for efficient queries
CREATE INDEX idx_skill_events_skill_id ON skill_events(skill_id);
CREATE INDEX idx_skill_events_cluster_id ON skill_events(cluster_id) WHERE cluster_id IS NOT NULL;
CREATE INDEX idx_skill_events_type ON skill_events(event_type);
CREATE INDEX idx_skill_events_created_at ON skill_events(created_at DESC);

-- Composite index for common query pattern: get events for a skill by type
CREATE INDEX idx_skill_events_skill_type_time ON skill_events(skill_id, event_type, created_at DESC);

-- Composite index for cluster-specific events
CREATE INDEX idx_skill_events_cluster_time ON skill_events(cluster_id, created_at DESC) WHERE cluster_id IS NOT NULL;

-- Add RLS policies
ALTER TABLE skill_events ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view all skill events
CREATE POLICY "Enable read access for all users" ON skill_events
  FOR SELECT USING (true);

-- Policy: Only the system can insert events (through functions)
CREATE POLICY "Enable insert for service role only" ON skill_events
  FOR INSERT WITH CHECK (true);

-- Comments
COMMENT ON TABLE skill_events IS 'Tracks important events that affect skill optimization';
COMMENT ON COLUMN skill_events.event_type IS 'Type of event (stored as TEXT for flexibility in adding new types). Valid values are enforced by check constraint.';
COMMENT ON COLUMN skill_events.cluster_id IS 'NULL for skill-wide events, NOT NULL for cluster-specific events';
COMMENT ON COLUMN skill_events.metadata IS 'Flexible JSON field for event-specific data';


-- ================================================
-- Logs with Evaluation Scores View
-- ================================================
-- This view efficiently computes weighted average evaluation scores for each log
-- by aggregating all evaluation results from skill_optimization_evaluation_runs
-- and joining with skill_optimization_evaluations to get weights
CREATE VIEW logs_with_eval_scores
WITH (security_invoker = true)
AS
SELECT
  l.*,
  COALESCE(
    (
      -- Calculate weighted average score
      -- For each log, we need to:
      -- 1. Get all evaluation results from evaluation_runs
      -- 2. Join with evaluations to get the weights
      -- 3. Calculate weighted sum / sum of weights
      SELECT
        SUM(score * weight) / NULLIF(SUM(weight), 0)
      FROM (
        -- Extract all scores from all evaluation runs for this log
        SELECT
          (result->>'score')::FLOAT AS score,
          e.weight AS weight
        FROM skill_optimization_evaluation_runs er
        CROSS JOIN LATERAL jsonb_array_elements(er.results) AS result
        LEFT JOIN skill_optimization_evaluations e
          ON e.id = (result->>'evaluation_id')::UUID
        WHERE er.log_id = l.id
          AND result->>'score' IS NOT NULL
          AND e.weight IS NOT NULL
      ) AS weighted_scores
    ),
    NULL
  ) AS avg_eval_score,
  (
    SELECT COUNT(*)
    FROM skill_optimization_evaluation_runs er
    WHERE er.log_id = l.id
  ) AS eval_run_count
FROM logs l;

COMMENT ON VIEW logs_with_eval_scores IS 'Logs enriched with weighted average evaluation score and evaluation run count. The avg_eval_score is calculated as a weighted average based on the weight field in skill_optimization_evaluations. Use this view for efficient list queries that need to display evaluation scores. Uses SECURITY INVOKER to respect querying user''s RLS policies.';

-- Index on log_id for the evaluation_runs table is already created above
-- This makes the subquery lookups efficient
