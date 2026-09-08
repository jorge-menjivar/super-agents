'use client';

import { type Log, LogsQueryParams } from '@shared/types/data/log';
import { HookProvider } from '@shared/types/middleware/hooks';
import { useQuery } from '@tanstack/react-query';
import { queryLogs } from '@web/api/v1/super-agents/observability/logs';
import { logsQueryKeys } from '@web/providers/logs';
import { reviewsAmong } from '@web/utils/reviews';

/** More reviews than a request has hooks to ask for. */
const REVIEWS_WINDOW = 50;

/**
 * The reviews of a log: the requests its reviewer hooks sent, which are
 * logs of their own under the reviewers' agents. They share the reviewed
 * request's trace and start within its span, so that is what is asked
 * for -- across agents, since the reviewer is never the reviewed agent --
 * and only for a log that had a reviewer hook at all.
 */
export function useReviewsOf(log: Log | undefined): Log[] {
  const reviewed =
    !!log?.trace_id &&
    log.hook_logs.some(
      (hookLog) => hookLog.hook.hook_provider === HookProvider.AGENT,
    );
  const { data = [] } = useQuery({
    queryKey: [
      ...logsQueryKeys.all,
      'reviews',
      log?.trace_id,
      log?.id,
      log?.end_time,
    ] as const,
    queryFn: async () => {
      if (!log?.trace_id) return [];
      const rows = await queryLogs(
        LogsQueryParams.parse({
          trace_id: log.trace_id,
          after: String(log.start_time),
          ...(log.end_time !== null ? { before: String(log.end_time) } : {}),
          order: 'asc',
          limit: String(REVIEWS_WINDOW),
        }),
      );
      return reviewsAmong(rows);
    },
    enabled: reviewed,
  });
  return data;
}
