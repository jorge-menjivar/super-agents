'use client';

import type { RecentSkill } from '@shared/types/data';
import { useQuery } from '@tanstack/react-query';
import { getAgentRecentSkills } from '@web/api/v1/super-agents/agents';
import { logsQueryKeys } from '@web/providers/logs-query-keys';

/** How many skills the agent dashboard's card has room for. */
export const RECENT_SKILLS = 5;

/**
 * The skills an agent used most recently, newest first.
 *
 * Keyed under `logsQueryKeys.all` because that is where the answer comes
 * from: a skill's last use is the head of its logs, so the request events
 * that refresh the logs cards refresh this one too, and the card follows
 * traffic as it arrives rather than waiting to be reloaded.
 */
export function useRecentSkills(agentId: string | null | undefined): {
  skills: RecentSkill[];
  isLoading: boolean;
} {
  const { data = [], isLoading } = useQuery({
    queryKey: [...logsQueryKeys.all, 'recent-skills', agentId] as const,
    queryFn: async () => {
      if (!agentId) return [];
      return await getAgentRecentSkills(agentId, RECENT_SKILLS);
    },
    enabled: !!agentId,
  });

  return { skills: data, isLoading };
}
