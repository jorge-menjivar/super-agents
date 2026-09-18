'use client';

import {
  type Log,
  type LogSummary,
  LogsQueryParams,
} from '@shared/types/data/log';
import { useQuery } from '@tanstack/react-query';
import { queryLogSummaries } from '@web/api/v1/super-agents/observability/logs';
import { logsQueryKeys } from '@web/providers/logs-query-keys';

/**
 * Requests fetched on each side of the log. A session longer than that is
 * shown as a window around the log, and says so at the cut ends.
 */
export const SESSION_WINDOW = 50;

export interface LogSession {
  /** The session's logs oldest first, the given log among them */
  logs: LogSummary[];
  /** The window was cut on that side: the session goes on past it */
  hasEarlier: boolean;
  hasLater: boolean;
  isLoading: boolean;
}

const NO_SESSION = {
  logs: [] as LogSummary[],
  hasEarlier: false,
  hasLater: false,
};

/**
 * The session a log belongs to: every log of the same agent sharing its
 * trace, which for a client that names its session (`x-session-id`) is that
 * session. Fetched as summaries and as a window around the log rather than
 * whole: the rail draws a status, a score and a duration per request, and a
 * hundred rows carrying their conversations was tens of megabytes to draw
 * that. Stepping to one fetches that row whole, by id.
 */
export function useLogSession(log: Log | undefined): LogSession {
  const { data = NO_SESSION, isLoading } = useQuery({
    queryKey: [
      ...logsQueryKeys.all,
      'session',
      log?.agent_id,
      log?.trace_id,
      log?.id,
    ] as const,
    queryFn: async () => {
      if (!log?.trace_id) return NO_SESSION;
      const scope = {
        agent_id: log.agent_id,
        trace_id: log.trace_id,
        limit: String(SESSION_WINDOW),
      };
      const [earlier, later] = await Promise.all([
        queryLogSummaries(
          LogsQueryParams.parse({ ...scope, before: String(log.start_time) }),
        ),
        queryLogSummaries(
          LogsQueryParams.parse({
            ...scope,
            after: String(log.start_time),
            order: 'asc',
          }),
        ),
      ]);
      // Both bounds are inclusive, so the log itself -- and anything sharing
      // its start time -- comes back on both sides.
      const byId = new Map<string, LogSummary>();
      for (const row of [...earlier, ...later, log]) byId.set(row.id, row);
      const logs = [...byId.values()].sort(
        (a, b) => a.start_time - b.start_time || a.id.localeCompare(b.id),
      );
      return {
        logs,
        hasEarlier: earlier.length >= SESSION_WINDOW,
        hasLater: later.length >= SESSION_WINDOW,
      };
    },
    enabled: !!log?.trace_id,
    // Stepping within a session changes the key (the window is centred on
    // the log), which would empty the rail for a moment and unmount it.
    // The previous window is the same session and already holds the new
    // log, so keep it until the re-centred one arrives -- but only within
    // the same session, so another session's rail never shows for a log.
    placeholderData: (previous, previousQuery) => {
      const [, , agentId, traceId] = previousQuery?.queryKey ?? [];
      return agentId === log?.agent_id && traceId === log?.trace_id
        ? previous
        : undefined;
    },
  });
  return { ...data, isLoading };
}
