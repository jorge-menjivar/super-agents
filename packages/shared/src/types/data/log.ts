import { FunctionName } from '@shared/types/api/request';
import { AIProvider } from '@shared/types/constants';
import { HttpMethod } from '@shared/types/http';
import { CacheMode, CacheStatus } from '@shared/types/middleware/cache';
import { Hook, HookResult } from '@shared/types/middleware/hooks';

import { z } from 'zod';

export const LogResponseBodyError = z.object({
  message: z.string(),
  response: z.string(),
});

export type LogResponseBodyError = z.infer<typeof LogResponseBodyError>;

export const AIProviderRequestLog = z.object({
  provider: z.enum(AIProvider),
  function_name: z.enum(FunctionName),
  method: z.enum(HttpMethod),
  request_url: z.string(),
  status: z.number(),
  request_body: z.record(z.string(), z.unknown()),
  response_body: z.record(z.string(), z.unknown()).nullable(), // Allow null for streaming responses
  raw_request_body: z.string(),
  raw_response_body: z.string(),
  cache_mode: z.enum(CacheMode),
  cache_status: z.enum(CacheStatus),
  /**
   * When the provider was asked, and when it had finished answering, for the
   * attempt whose answer this log records. The log row's own `start_time` and
   * `end_time` span the whole request -- choosing the skill, embedding the
   * request, the hooks, a reviewer -- which is the gateway's time rather than
   * the model's; a measure of the model reads this pair instead. Absent on a
   * cache hit, which asked no provider, and on a row written before the
   * gateway recorded it.
   */
  start_time: z.number().optional(),
  end_time: z.number().optional(),
});

export type AIProviderRequestLog = z.infer<typeof AIProviderRequestLog>;

export const HookLog = z.object({
  trace_id: z.string(),
  hook: Hook,
  result: HookResult,
  request_body: z.record(z.string(), z.unknown()).optional(),
  response_body: z.record(z.string(), z.unknown()).optional(),
  start_time: z.number(),
  end_time: z.number(),
  duration: z.number(),
  cache_status: z.enum(CacheStatus),
});

export type HookLog = z.infer<typeof HookLog>;

export const Log = z.object({
  // Base info
  id: z.uuid(),
  agent_id: z.uuid(),
  /**
   * Null until routing has picked the skill, and for a request that failed
   * before it did: the row is written when the request reaches its agent,
   * which is before the skill is known.
   */
  skill_id: z.uuid().nullable(),
  cluster_id: z.uuid().nullable(),
  method: z.enum(HttpMethod),
  endpoint: z.string(),
  function_name: z.enum(FunctionName),
  start_time: z.number(),
  first_token_time: z.number().nullable(),
  base_sa_config: z.record(z.string(), z.unknown()),

  /**
   * Everything below is null while the request is still running.
   *
   * A row is written when the request arrives, not when it finishes, so that
   * the dashboard can show work in progress and so that a request which fails
   * before reaching a provider -- or never finishes at all -- still leaves a
   * trace. `end_time === null` is what "still running" means; use
   * `isCompletedLog` rather than testing the fields one at a time.
   */
  status: z.number().nullable(),
  end_time: z.number().nullable(),
  duration: z.number().nullable(),

  // Maybe redundant. Used for indexing.
  ai_provider: z.enum(AIProvider).nullable(),
  model: z.string().nullable(),

  // Main data
  ai_provider_request_log: AIProviderRequestLog.nullable(),
  hook_logs: z.array(HookLog),
  metadata: z.record(z.string(), z.unknown()),
  embedding: z.array(z.number()).nullable(),
  /** The system prompt (or Responses `instructions`) the caller sent, as
   * received. `ai_provider_request_log` holds the body that reached the
   * provider, in which an optimized skill has substituted its own prompt. */
  original_system_prompt: z.string().nullable(),

  // Cache info
  cache_status: z.enum(CacheStatus).nullable(),

  /**
   * Why the request failed, when it failed before a provider answered -- an
   * unknown agent, a routing error, a provider that could not be reached. A
   * failure the provider itself reported is in `ai_provider_request_log`
   * alongside its status, and leaves this null.
   */
  error: z.string().nullable(),

  // Tracing info
  trace_id: z.string().nullable(),
  parent_span_id: z.string().nullable(),
  span_id: z.string().nullable(),
  span_name: z.string().nullable(),

  // User metadata
  app_id: z.string().nullable(),
  external_user_id: z.string().nullable(),
  external_user_human_name: z.string().nullable(),
  user_metadata: z.record(z.string(), z.unknown()).nullable(),

  // Computed fields from logs_with_eval_scores view (optional)
  avg_eval_score: z.number().nullable().optional(),
  eval_run_count: z.number().int().nullable().optional(),
});

export type Log = z.infer<typeof Log>;

/**
 * A log whose request finished, and which therefore carries everything that
 * only exists once a provider has answered.
 *
 * Most things that read logs -- the optimizer's contrastive examples, the
 * judge, anything rendering a request and its response -- have no use for a
 * row that is still running, and their queries already exclude one (by
 * `status`, or by requiring an embedding). This is how that assumption is
 * stated in the types rather than assumed.
 */
export const CompletedLog = Log.extend({
  skill_id: z.uuid(),
  status: z.number(),
  end_time: z.number(),
  duration: z.number(),
  ai_provider: z.enum(AIProvider),
  model: z.string(),
  ai_provider_request_log: AIProviderRequestLog,
  cache_status: z.enum(CacheStatus),
});

export type CompletedLog = z.infer<typeof CompletedLog>;

/** Whether the request this log describes has finished. */
export const isCompletedLog = (log: Log): log is CompletedLog =>
  log.skill_id !== null &&
  log.end_time !== null &&
  log.duration !== null &&
  log.status !== null &&
  log.ai_provider !== null &&
  log.model !== null &&
  log.ai_provider_request_log !== null &&
  log.cache_status !== null;

export type LogMessage = {
  data: string;
  event: string;
  id: string;
};

export interface LogsClient {
  sendLog: (logMessage: LogMessage) => Promise<void>;
}

export const LogsQueryParams = z.object({
  id: z.uuid().optional(),
  ids: z.array(z.uuid()).optional(),
  agent_id: z.uuid().optional(),
  skill_id: z.uuid().optional(),
  cluster_id: z.uuid().optional(),
  /** Matched against `metadata.served_configuration`, since the row keeps
   * the partition an arm belongs to but not the arm itself. */
  arm_id: z.uuid().optional(),
  app_id: z.uuid().optional(),
  /** The trace -- for a client that names its session, the session. */
  trace_id: z.string().optional(),
  after: z
    .string()
    .transform((val) => (val ? Number(val) : undefined))
    .optional(),
  before: z
    .string()
    .transform((val) => (val ? Number(val) : undefined))
    .optional(),
  method: z.enum(HttpMethod).optional(),
  endpoint: z.string().optional(),
  function_name: z.string().optional(),
  status: z
    .string()
    .transform((val) => (val ? Number(val) : undefined))
    .optional(),
  cache_status: z.enum(CacheStatus).optional(),
  embedding_not_null: z.coerce.boolean().optional(),
  /** Only logs with no evaluation run yet. */
  unjudged: z.coerce.boolean().optional(),
  /** By `start_time`; newest first unless asked for `asc`. */
  order: z.enum(['asc', 'desc']).optional(),
  limit: z.string().default('50').transform(Number).optional(),
  offset: z.string().default('0').transform(Number).optional(),
});

export type LogsQueryParams = z.infer<typeof LogsQueryParams>;

/**
 * The row written when a request arrives, before anything is known about how
 * it went. Completed by `LogCreateParams` under the same `id`.
 */
export const LogStartParams = z.object({
  id: z.uuid(),
  agent_id: z.uuid(),
  /** Null when the row opens before routing; written again once it is known. */
  skill_id: z.uuid().nullable(),
  method: z.enum(HttpMethod),
  endpoint: z.string(),
  function_name: z.enum(FunctionName),
  start_time: z.number(),
  base_sa_config: z.record(z.string(), z.unknown()),
  /** What the caller asked for; the arm may resolve something else. */
  model: z.string().optional(),
  trace_id: z.string().optional(),
});

export type LogStartParams = z.infer<typeof LogStartParams>;

/**
 * Closes a row opened at arrival for a request that failed before a provider
 * answered -- an unknown agent, a routing error, a provider that could not be
 * reached. There is nothing to record about a call that never happened, so
 * this carries only the outcome.
 */
export const LogFailParams = z.object({
  id: z.uuid(),
  status: z.number(),
  end_time: z.number(),
  duration: z.number(),
  error: z.string(),
});

export type LogFailParams = z.infer<typeof LogFailParams>;

export const LogCreateParams = z.object({
  /**
   * The id of the row opened at arrival, so the write completes that row
   * instead of adding a second one. Absent for a log created outright.
   */
  id: z.uuid().optional(),
  /** Set only when the request failed before a provider answered. */
  error: z.string().optional(),
  agent_id: z.uuid(),
  skill_id: z.uuid(),
  cluster_id: z.uuid().optional(),
  method: z.enum(HttpMethod),
  endpoint: z.string(),
  function_name: z.enum(FunctionName),
  status: z.int(),
  start_time: z.number(),
  first_token_time: z.number().optional(),
  end_time: z.number(),
  duration: z.number(),
  base_sa_config: z.record(z.string(), z.unknown()),

  // Maybe redundant. Used for indexing.
  ai_provider: z.enum(AIProvider),
  model: z.string(),

  // Main data
  ai_provider_request_log: AIProviderRequestLog,
  hook_logs: z.array(HookLog),
  metadata: z.record(z.string(), z.unknown()),
  embedding: z.array(z.number()).optional(),
  original_system_prompt: z.string().optional(),

  // Cache info
  cache_status: z.enum(CacheStatus),

  // Tracing info
  trace_id: z.string().optional(),
  parent_span_id: z.string().optional(),
  span_id: z.string().optional(),
  span_name: z.string().optional(),

  // User metadata
  app_id: z.string().optional(),
  external_user_id: z.string().optional(),
  external_user_human_name: z.string().optional(),
  user_metadata: z.record(z.string(), z.unknown()).optional(),
});
export type LogCreateParams = z.infer<typeof LogCreateParams>;
