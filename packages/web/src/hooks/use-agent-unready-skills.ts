import type { Agent } from '@shared/types/data';
import { isSkillReady } from '@shared/utils/skill-validation';
import { useAgentSkillReadiness } from '@web/hooks/use-skill-readiness';

export interface UseAgentUnreadySkillsResult {
  hasUnreadySkills: boolean;
  unreadySkillsCount: number;
  isLoading: boolean;
}

/**
 * How many of an agent's skills are not ready -- missing models, or missing
 * evaluations while being optimized.
 *
 * One request for the whole agent. The sidebar draws this for every agent at
 * once, so what it costs is what every page of the dashboard pays: reading
 * the skills themselves to find out which are optimized meant hundreds of
 * kilobytes per agent, most of it the seed system prompts the gateway created
 * them from. `optimize` travels with the counts instead.
 */
export function useAgentUnreadySkills(
  agent: Agent | null | undefined,
): UseAgentUnreadySkillsResult {
  const { readiness, isLoading } = useAgentSkillReadiness(agent?.id);

  const unreadySkillsCount = [...readiness.values()].filter(
    (counts) =>
      !isSkillReady(
        counts.model_count,
        counts.evaluation_count,
        counts.optimize,
      ),
  ).length;

  return {
    hasUnreadySkills: unreadySkillsCount > 0,
    unreadySkillsCount,
    isLoading,
  };
}
