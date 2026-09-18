import type { Skill } from '@shared/types/data';
import { isSkillReady } from '@shared/utils/skill-validation';
import { useAgentSkillReadiness } from '@web/hooks/use-skill-readiness';

export interface UseSkillValidationResult {
  isReady: boolean;
  modelsCount: number;
  evaluationsCount: number;
  isLoading: boolean;
  missingRequirements: string[];
}

/**
 * Whether a skill is ready: it has a model, and an evaluation if it is being
 * optimized.
 *
 * The counts come from the agent's readiness answer rather than from two
 * requests of this skill's own, so a page of skill cards asks once for all of
 * them. See `useAgentSkillReadiness`.
 */
export function useSkillValidation(
  skill: Skill | null | undefined,
): UseSkillValidationResult {
  const { readiness, isLoading } = useAgentSkillReadiness(skill?.agent_id);

  const counts = skill ? readiness.get(skill.id) : undefined;
  const modelsCount = counts?.model_count ?? 0;
  const evaluationsCount = counts?.evaluation_count ?? 0;
  // The skill's own flag, since the caller holds the row; the readiness
  // answer carries it too, for callers that do not.
  const optimize = skill?.optimize ?? false;
  const ready = isSkillReady(modelsCount, evaluationsCount, optimize);

  const missingRequirements: string[] = [];

  if (modelsCount === 0) {
    missingRequirements.push('At least one model must be configured');
  }

  if (optimize && evaluationsCount === 0) {
    missingRequirements.push('At least one evaluation must be configured');
  }

  return {
    isReady: ready,
    modelsCount,
    evaluationsCount,
    isLoading,
    missingRequirements,
  };
}
