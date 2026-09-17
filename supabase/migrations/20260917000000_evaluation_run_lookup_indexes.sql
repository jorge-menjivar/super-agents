-- Indexes for the edge-bucket lookups on `get_evaluation_scores_by_time_bucket`:
-- the newest run of a series before a time, and the oldest after it.
--
-- Without an index in that order, finding the nearest run beyond an edge reads
-- every run the skill has and sorts them; with one it is a seek to the end of a
-- range. The four-column index matches the DISTINCT ON key, so the agent-wide
-- query gets one row per series without a sort; the two-column one serves the
-- per-skill queries the skill cards make, which cannot use an index led by
-- `agent_id`.
--
-- Appended rather than folded into the initial schema, mirroring
-- `0004_evaluation_run_lookup_indexes` on the libSQL side, so the two backends'
-- migration histories stay in step.

CREATE INDEX IF NOT EXISTS idx_evaluation_runs_skill_created
  ON skill_optimization_evaluation_runs(skill_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_evaluation_runs_series_created
  ON skill_optimization_evaluation_runs(agent_id, skill_id, cluster_id, created_at DESC);
