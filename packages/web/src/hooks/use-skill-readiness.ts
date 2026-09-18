import type { SkillReadiness } from '@shared/types/data';
import { useQuery } from '@tanstack/react-query';
import { getAgentSkillReadiness } from '@web/api/v1/super-agents/agents';
import { useMemo } from 'react';

/** How long a readiness answer is reused before it is asked for again. */
const READINESS_STALE_MS = 30 * 1000;

/**
 * What every skill of an agent has -- its models and its evaluations -- in
 * one answer, keyed by skill.
 *
 * One query per agent rather than per skill. A dashboard draws a readiness
 * mark in three places at once: on each skill card, on the skill's own
 * dashboard, and on every agent in the sidebar, which marks an agent whose
 * skills are not all ready. Answering per skill meant two requests each, so
 * a page listing fifteen skills opened a hundred connections to draw a
 * warning triangle.
 *
 * Every surface reads this one key, so they share a single answer and each
 * other's cache.
 */
export function useAgentSkillReadiness(agentId: string | null | undefined): {
  readiness: Map<string, SkillReadiness>;
  isLoading: boolean;
} {
  const { data, isLoading } = useQuery({
    queryKey: ['skill-readiness', agentId],
    queryFn: async () => {
      if (!agentId) return [];
      return await getAgentSkillReadiness(agentId);
    },
    enabled: !!agentId,
    staleTime: READINESS_STALE_MS,
  });

  // Memoised: a fresh Map each render would be a new dependency for
  // everything that reads it.
  const readiness = useMemo(() => {
    const bySkill = new Map<string, SkillReadiness>();
    for (const row of data ?? []) {
      bySkill.set(row.skill_id, row);
    }
    return bySkill;
  }, [data]);

  return { readiness, isLoading };
}
