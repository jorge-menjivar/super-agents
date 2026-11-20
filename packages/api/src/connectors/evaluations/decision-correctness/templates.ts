import { UNKNOWN_ANSWER } from '@api/connectors/evaluations/decision-correctness/scoring';
import type { JudgePrompt } from '@api/types/evaluations/llm-judge';

export interface DecisionJudgeTemplateData {
  /** What the agent is for, when it says. */
  agentDescription?: string | null;
  /** What the skill is for, when it says. */
  skillDescription?: string | null;
  /** The evaluation's own standard for a right answer, when it has one. */
  guidance?: string;
  /** The state and the questions, as `describeDecisionRequest` writes them. */
  request: string;
  /**
   * Shown only with a human's verdict: the answers the human judged. Without
   * one the judge answers blind, so the model's leaning cannot pull its own.
   */
  reviewedAnswers?: string;
  humanVerdictNote?: string;
}

const SYSTEM_PROMPT = `You are judging a decision model: a model that reads some material and answers questions about it with probabilities, without writing anything. Your answers are the reference its answers are scored against, so answer every question yourself, as a careful expert in the material would, and as the question and its options define it.

For each question, by its id, give:
- for a yes-or-no question: "true" for yes, or "false" for no
- for a question with options: the exact label of the one right option
- for a question on a scale: the number of the right level, the lowest being 0
- "${UNKNOWN_ANSWER}" only when the material shown to you cannot settle the question -- when it turns on an image you are not shown, for instance. Do not use it to avoid a hard call: a hard call is what you are here for.

Give each answer a sentence or two of reasoning that names what in the material decides it.`;

/** The prompts that ask the judge what the right answers were. */
export function decisionJudgePrompt(
  data: DecisionJudgeTemplateData,
): JudgePrompt {
  const sections: string[] = [];
  const context = [
    data.agentDescription ? `Agent: ${data.agentDescription}` : null,
    data.skillDescription ? `Skill: ${data.skillDescription}` : null,
  ].filter((line) => line !== null);
  if (context.length > 0) {
    sections.push(`# Context\n${context.join('\n')}`);
  }
  if (data.guidance?.trim()) {
    sections.push(
      `# The standard\nA right answer to these questions meets this standard:\n${data.guidance.trim()}`,
    );
  }
  sections.push(`# What the model was asked\n\n${data.request}`);
  if (data.reviewedAnswers && data.humanVerdictNote) {
    sections.push(
      `# The model's answers, as a human reviewed them\n${data.reviewedAnswers}\n\n${data.humanVerdictNote}\n\nThe human's verdict is about these answers: where they leaned the right way, your answers should agree with them; where the verdict says they did not, yours should not.`,
    );
  }
  sections.push('Answer every question above, by its id.');
  return { systemPrompt: SYSTEM_PROMPT, userPrompt: sections.join('\n\n') };
}
