import { JudgeOverrideParameters } from '@api/connectors/evaluations/judge-overrides';
import { z } from 'zod';

/**
 * Nothing here is filled in by a model when the evaluation is created: the
 * questions a decision skill is asked already say what a right answer is, so
 * the evaluation starts empty and works from them.
 */
export const DecisionCorrectnessEvaluationParameters = z.object({
  guidance: z
    .string()
    .optional()
    .describe(
      "What a right answer to this skill's questions is, where the questions alone leave it open -- the standard the judge holds the model to. Unset, the judge answers the questions as they are written.",
    ),
  temperature: z.number().min(0).max(1).default(0.1),
  // What this evaluation wants instead of the judge's system settings.
  // Absent means inherit, so an evaluation with no opinion follows the
  // settings as they change.
  ...JudgeOverrideParameters.shape,
});

export type DecisionCorrectnessEvaluationParameters = z.infer<
  typeof DecisionCorrectnessEvaluationParameters
>;

/**
 * What the judge answers: each question, as it would answer it. The answer
 * is text, but a judge on a provider that does not hold it to the schema
 * answers a level as `2` and a yes as `true` -- read as the text they are,
 * rather than failing the whole judgment over it.
 */
export const DecisionJudgment = z.object({
  answers: z.array(
    z.object({
      question_id: z.string(),
      answer: z.union([z.string(), z.number(), z.boolean()]),
      reasoning: z.string(),
    }),
  ),
});

export type DecisionJudgment = z.infer<typeof DecisionJudgment>;
