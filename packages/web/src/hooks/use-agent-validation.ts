import type { Agent } from '@shared/types/data';
import { validateAgent } from '@shared/utils/agent-validation';
import { useQuery } from '@tanstack/react-query';
import { getAgentModels } from '@web/api/v1/super-agents/agents';
import { useAgentSkillReadiness } from '@web/hooks/use-skill-readiness';

export interface UseAgentValidationResult {
  isReady: boolean;
  skillsCount: number;
  defaultModelsCount: number;
  isLoading: boolean;
  missingRequirements: string[];
}

/**
 * Hook to check whether an agent can serve requests: it has a skill, or the
 * gateway can create one for it (see `validateAgent`).
 *
 * @param agent - The agent to validate
 * @returns Validation result with readiness status, counts, and loading state
 */
export function useAgentValidation(
  agent: Agent | null | undefined,
): UseAgentValidationResult {
  // How many skills there are is all this needs, and the readiness answer is
  // a row per skill -- so it is counted from the answer the readiness marks
  // already read rather than by fetching the skills themselves, which carry
  // the seed system prompts the gateway created them from.
  const { readiness, isLoading: isLoadingSkills } = useAgentSkillReadiness(
    agent?.id,
  );

  // Only decisive for an agent without skills that creates them.
  const { data: defaultModels = [], isLoading: isLoadingModels } = useQuery({
    queryKey: ['models', 'agent', agent?.id],
    queryFn: async () => {
      if (!agent) return [];
      return await getAgentModels(agent.id);
    },
    enabled: !!agent && agent.auto_create_skills,
    staleTime: 30 * 1000,
  });

  const skillsCount = readiness.size;
  const defaultModelsCount = defaultModels.length;
  const { isReady, missingRequirements } = agent
    ? validateAgent(agent, skillsCount, defaultModelsCount)
    : { isReady: false, missingRequirements: [] };

  return {
    isReady,
    skillsCount,
    defaultModelsCount,
    isLoading: isLoadingSkills || isLoadingModels,
    missingRequirements,
  };
}
