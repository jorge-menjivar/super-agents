import type { SuperAgentsRoute } from '@api/v1';
import { Log, LogSummary, type LogsQueryParams } from '@shared/types/data/log';
import { API_URL } from '@web/constants';
import { hc } from 'hono/client';

const client = hc<SuperAgentsRoute>(API_URL, {
  init: {
    credentials: 'include',
  },
});

/** The query as the wire carries it: every filter a string. */
const asQuery = (params: LogsQueryParams) => ({
  agent_id: params.agent_id,
  skill_id: params.skill_id,
  cluster_id: params.cluster_id,
  trace_id: params.trace_id,
  id: params.id,
  ids: params.ids,
  app_id: params.app_id,
  function_name: params.function_name,
  before: params.before?.toString(),
  after: params.after?.toString(),
  method: params.method,
  endpoint: params.endpoint,
  status: params.status?.toString(),
  cache_status: params.cache_status,
  embedding_not_null: params.embedding_not_null?.toString(),
  order: params.order,
  limit: params.limit?.toString(),
  offset: params.offset?.toString(),
});

/**
 * Whole log rows, conversations and all.
 *
 * One at a time: this is what the log detail reads. A list wants
 * `queryLogSummaries`, which is the same rows without the bodies -- a page of
 * these is tens of megabytes.
 */
export async function queryLogs(params: LogsQueryParams): Promise<Log[]> {
  const response = await client.v1['super-agents'].observability.logs.$get({
    query: asQuery(params),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch logs`);
  }

  return Log.array().parse(await response.json());
}

/**
 * The same rows as `queryLogs`, carrying what a table of requests draws and
 * none of the conversation.
 */
export async function queryLogSummaries(
  params: LogsQueryParams,
): Promise<LogSummary[]> {
  const response = await client.v1[
    'super-agents'
  ].observability.logs.summaries.$get({
    query: asQuery(params),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch log summaries`);
  }

  return LogSummary.array().parse(await response.json());
}
