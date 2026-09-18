-- `logs_summary`: a log row as a list reads it, and the indexes a list is
-- ordered by.
--
-- Most of a log row is the conversation -- the body the caller sent, the body
-- that reached the provider, the embedding -- and a table of requests draws
-- none of it. Reading fifty rows of a busy agent whole costs hundreds of times
-- what reading their scalars does, and every one of those bytes then crosses
-- the wire to a browser with no use for them.
--
-- The view keeps one thing from the exchange: the parameters the provider was
-- asked with, which the logs table shows as the temperature and the thinking
-- effort. Subtracting the conversation keys leaves a handful of scalars rather
-- than the messages they sat beside. It is NULL when no provider was asked,
-- which is what `ai_provider_request_log` being NULL already meant.
--
-- The indexes are what the lists order by. `logs` had `agent_id` and
-- `start_time` indexed separately, which cannot serve one query: filtering by
-- the agent and ordering by time sorted every row the agent had.
--
-- Appended rather than folded into the initial schema, mirroring
-- `0005_log_summaries` on the libSQL side, so the two backends' migration
-- histories stay in step.

CREATE VIEW logs_summary
WITH (security_invoker = true)
AS
SELECT
  l.id, l.agent_id, l.skill_id, l.cluster_id,
  l.method, l.endpoint, l.function_name,
  l.start_time, l.first_token_time, l.status, l.end_time, l.duration,
  l.ai_provider, l.model, l.cache_status, l.error,
  l.trace_id, l.parent_span_id, l.span_id, l.span_name,
  l.app_id, l.external_user_id, l.external_user_human_name,
  l.user_metadata, l.metadata,
  l.avg_eval_score, l.eval_run_count,
  -- Each hook's verdict without what it judged: a hook that withheld or
  -- replaced a response keeps that response on its own log, and the lists
  -- only colour a row by the verdict.
  (SELECT COALESCE(
            jsonb_agg(h - 'request_body' - 'response_body'),
            '[]'::jsonb
          )
   FROM jsonb_array_elements(l.hook_logs) h) AS hook_logs,
  -- The embedding is one of the columns left out, so the filter that asks for
  -- rows that have one is answered here instead of by reading it.
  (l.embedding IS NOT NULL) AS has_embedding,
  (l.ai_provider_request_log -> 'request_body')
    - 'messages' - 'tools' - 'input' - 'prompt' AS provider_request_params
FROM logs_with_eval_scores l;

CREATE INDEX IF NOT EXISTS idx_logs_agent_start_time
  ON logs(agent_id, start_time DESC);

CREATE INDEX IF NOT EXISTS idx_logs_skill_start_time
  ON logs(skill_id, start_time DESC);

CREATE INDEX IF NOT EXISTS idx_logs_trace_start_time
  ON logs(trace_id, start_time);
