import {
  SkillRoutingDecision,
  type SkillRoutingMethod,
} from '@shared/types/data/skill-routing';

/** The routing decision a log carries, if the gateway chose its skill. */
export function readSkillRouting(
  metadata: Record<string, unknown> | null | undefined,
): SkillRoutingDecision | null {
  const parsed = SkillRoutingDecision.safeParse(metadata?.skill_routing);
  return parsed.success ? parsed.data : null;
}

/**
 * Routing in words a reader who has never read the code would use.
 *
 * The gateway's own terms -- similarity, threshold, candidates -- say what
 * it computed, not what happened, and the number is a cosine distance
 * between embeddings, which is nobody's idea of a plain fact. What the
 * reader is owed is which skill took the request and how sure the gateway
 * was, so the score is a percentage against the bar it had to clear.
 */

const METHOD_LABELS: Record<SkillRoutingMethod, string> = {
  only_skill: 'the agent had one skill',
  embedding: 'sent to the closest match',
  most_used: 'sent to the busiest skill',
  created: 'started a new skill',
  arbitrated: 'a model chose the skill',
};

const METHOD_TITLES: Record<SkillRoutingMethod, string> = {
  only_skill:
    'This request did not name a skill, and the agent had only one, so there was nothing to choose between.',
  embedding:
    'This request did not name a skill, so it went to the skill whose recent work looks most like it: the same kind of instructions and tools, and a conversation going the same way.',
  most_used:
    "This request could not be compared with the agent's skills, so the skill handling the most traffic took it.",
  created:
    'Nothing the agent already does was close enough to this request, so it started a skill of its own.',
  arbitrated:
    'Nothing was close enough to be sure, so a model read the request and picked the skill it belongs to.',
};

export interface SkillRoutingDescription {
  label: string;
  /** Similarity against the threshold, when both were computed. */
  detail: string | null;
  title: string;
}

/** Words for a routing decision, for the log view. */
export function describeSkillRouting(
  decision: SkillRoutingDecision,
): SkillRoutingDescription {
  const { method, similarity, threshold, candidates } = decision;
  const percent = (value: number): string => `${Math.round(value * 100)}%`;
  const parts: string[] = [];
  if (similarity !== null) {
    parts.push(
      threshold !== null
        ? `${percent(similarity)} match, needs ${percent(threshold)}`
        : `${percent(similarity)} match`,
    );
  }
  // How many skills it had to choose between, which says nothing when the
  // label has already said there was only the one.
  if (candidates > 0 && method !== 'only_skill') {
    parts.push(`from ${candidates} skill${candidates === 1 ? '' : 's'}`);
  }
  return {
    label: METHOD_LABELS[method],
    detail: parts.length > 0 ? parts.join(' \u00b7 ') : null,
    title: METHOD_TITLES[method],
  };
}
