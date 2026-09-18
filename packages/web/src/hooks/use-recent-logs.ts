'use client';

import { type LogSummary, LogsQueryParams } from '@shared/types/data/log';
import { useQuery } from '@tanstack/react-query';
import { queryLogSummaries } from '@web/api/v1/super-agents/observability/logs';
import { logsQueryKeys } from '@web/providers/logs-query-keys';

/** How many rows a dashboard card has room for. */
export const RECENT_LOGS = 5;

/**
 * The last few requests of an agent, or of one of its skills: what the
 * dashboards' "recent requests" cards read.
 *
 * A card of its own rather than the logs provider's current page, for two
 * reasons. The provider's page is fifty rows, and a card that shows five has
 * no business fetching fifty. And the provider holds the scope the logs page
 * and the log detail's arrows step through, so a card that set it up just by
 * being rendered moved the page the reader would come back to.
 *
 * The key sits under `logsQueryKeys.all`, so the same request events that
 * refresh the logs page refresh these.
 */
export function useRecentLogs(scope: {
  agentId: string | null | undefined;
  skillId?: string | null;
}): { logs: LogSummary[]; isLoading: boolean } {
  const { agentId, skillId = null } = scope;

  const { data = [], isLoading } = useQuery({
    queryKey: [...logsQueryKeys.all, 'recent', agentId, skillId] as const,
    queryFn: async () => {
      if (!agentId) return [];
      return await queryLogSummaries(
        LogsQueryParams.parse({
          agent_id: agentId,
          ...(skillId ? { skill_id: skillId } : {}),
          limit: String(RECENT_LOGS),
        }),
      );
    },
    enabled: !!agentId,
  });

  return { logs: data, isLoading };
}
