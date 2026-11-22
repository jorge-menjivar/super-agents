import type {
  SystemOneGuidance,
  SystemOneQuestion,
  SystemOneRequestBody,
} from '@shared/types/api/routes/system-one-api';

/**
 * What a System One request has in place of a system prompt.
 *
 * A chat request says who is calling in its system message; a System One
 * request says it in its questions' instructions, which a caller sends
 * unchanged on every request just as a tool does its system prompt. So those
 * instructions are what the gateway reads where it would read a system prompt:
 * to route the request to a skill, and as the prompt the caller sent.
 *
 * Instructions may be structured data as well as text, and a caller who
 * writes them that way is no less sending them on every request, so they are
 * read as their JSON. Leaving them out would give such a caller no prompt to
 * route by and nothing to show as the prompt it sent.
 */
export function systemOneInstructionsText(
  body: Pick<SystemOneRequestBody, 'questions'>,
): string | null {
  const texts: string[] = [];
  for (const question of Object.values(body.questions ?? {})) {
    const text = instructionsText(question?.instructions);
    if (text) {
      texts.push(text);
    }
  }
  return texts.length > 0 ? texts.join('\n\n') : null;
}

/** A question's instructions as text: as written, or as their JSON. */
function instructionsText(
  instructions: SystemOneGuidance | undefined,
): string | null {
  if (instructions === undefined || instructions === null) {
    return null;
  }
  if (typeof instructions === 'string') {
    return instructions || null;
  }
  return JSON.stringify(instructions, null, 2) ?? null;
}

/**
 * What a System One request is about, as text: its state, which is the
 * material that changes request by request while the questions stay the
 * same. A string as it came, anything else as indented JSON, and nothing for
 * an empty state. It is what routes the request (as its conversation) and
 * what places it in its skill's clusters, so the two read the same text.
 */
export function systemOneStateText(
  state: SystemOneRequestBody['state'],
): string | null {
  if (state === null || state === undefined || state === '') {
    return null;
  }
  return typeof state === 'string' ? state : JSON.stringify(state, null, 2);
}

/** A question's instructions with a policy ahead of them. */
function withPolicyAhead(
  policy: string,
  instructions: SystemOneGuidance | undefined,
): SystemOneGuidance {
  if (instructions === undefined || instructions === null) {
    return policy;
  }
  if (typeof instructions === 'string') {
    return instructions ? `${policy}\n\n${instructions}` : policy;
  }
  // Structured instructions keep their structure, with the policy first.
  return Array.isArray(instructions)
    ? [policy, ...instructions]
    : [policy, instructions];
}

/**
 * The questions as a skill asks them: under its system prompt.
 *
 * A decision skill's system prompt is its policy -- what a reviewer withholds,
 * what counts as a refund request -- and the caller's question is asked under
 * it. There is no system message to carry it, so it goes ahead of each
 * question's own instructions. Returns new objects: the caller's request is
 * still read after the provider is asked.
 */
export function withSystemOnePolicy(
  questions: Record<string, SystemOneQuestion>,
  policy: string,
): Record<string, SystemOneQuestion> {
  return Object.fromEntries(
    Object.entries(questions).map(([id, question]) => [
      id,
      {
        ...question,
        instructions: withPolicyAhead(policy, question.instructions),
      },
    ]),
  );
}
