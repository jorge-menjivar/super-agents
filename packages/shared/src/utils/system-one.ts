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
 */
export function systemOneInstructionsText(
  body: Pick<SystemOneRequestBody, 'questions'>,
): string | null {
  const texts: string[] = [];
  for (const question of Object.values(body.questions ?? {})) {
    if (typeof question?.instructions === 'string' && question.instructions) {
      texts.push(question.instructions);
    }
  }
  return texts.length > 0 ? texts.join('\n\n') : null;
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
