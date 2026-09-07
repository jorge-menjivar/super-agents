import type { APIRequestContext } from '@playwright/test';

const LOGS_PATH = '/v1/super-agents/observability/logs';

/** The parts of a log these specs read. */
export interface LoggedRequest {
  id: string;
  skill_id: string;
  /** How a review finds the request it reviewed: the same trace, as a span. */
  trace_id: string | null;
  span_id: string | null;
  parent_span_id: string | null;
  span_name: string | null;
  /** What each hook made of the request; a reviewer's verdict lands here. */
  hook_logs?: {
    hook: { id: string };
    result: { deny_request: boolean; reason?: string; error?: string };
  }[];
  end_time: number | null;
  metadata: Record<string, unknown>;
  original_system_prompt: string | null;
  /**
   * Null until the request has answered, and for one that failed before it
   * reached a provider -- the row is written when the request arrives.
   */
  ai_provider_request_log: {
    request_body: { messages?: { role: string; content: string }[] };
  } | null;
}

/**
 * The logs recorded for a skill, newest first.
 *
 * Includes requests that are still running: a row is written when a request
 * arrives, not when it finishes, so a caller wanting the provider exchange
 * has to wait for it -- which is why these are polled rather than read once.
 */
export const getLogs = async (
  request: APIRequestContext,
  skillId: string,
): Promise<LoggedRequest[]> => {
  const response = await request.get(LOGS_PATH, {
    params: { skill_id: skillId },
  });
  return response.json() as Promise<LoggedRequest[]>;
};

/**
 * The logs a configuration served. There is no `arm_id` column: both
 * connectors reach into `metadata.served_configuration`, SQLite with
 * `json_extract` and PostgREST with a `->>` path, which is why this is
 * exercised on both backends.
 */
export const getLogsByArm = async (
  request: APIRequestContext,
  armId: string,
): Promise<LoggedRequest[]> => {
  const response = await request.get(LOGS_PATH, {
    params: { arm_id: armId },
  });
  return response.json() as Promise<LoggedRequest[]>;
};
