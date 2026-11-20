import { z } from 'zod';

/**
 * A decision model's answers, one per question asked.
 *
 * The vendors add fields of their own -- Drex a `request_id` and timings, and
 * a `confidence` on every answer -- and a response that lost them on its way
 * through the gateway would be one the caller could no longer check against
 * the vendor's records. So the answers and the usage are loose, and the
 * top-level fields the vendors document are named. The top level itself is
 * not loose: an index signature there would make every `'choices' in body`
 * narrowing of `SuperAgentsResponseBody` read `choices` as unknown.
 */

/** Option label, or scale level, to its probability. */
const Probabilities = z.record(z.string(), z.number());

export const SystemOneNoulAnswer = z.looseObject({
  type: z.literal('noul'),
  /** The probability that the answer is yes, from 0 to 1. */
  noul: z.number(),
  confidence: z.number().optional(),
});

export const SystemOneChoiceAnswer = z.looseObject({
  type: z.literal('choice'),
  /** The most probable option. */
  choice: z.string(),
  confidence: z.number().optional(),
  probabilities: Probabilities.optional(),
});

export const SystemOneScoreAnswer = z.looseObject({
  type: z.literal('score'),
  /** The expected level, lowest first from 0, and so possibly fractional. */
  score: z.number(),
  confidence: z.number().optional(),
  /** Each level's description, as an array or keyed by its index. */
  legend: z
    .union([z.array(z.string()), z.record(z.string(), z.string())])
    .optional(),
  probabilities: Probabilities.optional(),
});

export const SystemOneAnswer = z.discriminatedUnion('type', [
  SystemOneNoulAnswer,
  SystemOneChoiceAnswer,
  SystemOneScoreAnswer,
]);

export type SystemOneAnswer = z.infer<typeof SystemOneAnswer>;

export const SystemOneResponseBody = z.object({
  /** The pinned version that answered, which an alias like `-latest` hides. */
  model: z.string(),
  /** Keyed by the ids the questions were asked under. */
  answers: z.record(z.string(), SystemOneAnswer),
  usage: z
    .looseObject({
      input_tokens: z.number(),
      output_tokens: z.number(),
    })
    .optional(),
  /** Drex's id for the request, which its support asks for. */
  request_id: z.string().optional(),
  /** How long Drex's hosted API took to evaluate it. */
  evaluation_time_ms: z.number().optional(),
  /** The same, as Drex's self-hosted server reports it. */
  latency_ms: z.number().optional(),
  /** Stamped by the gateway: which provider answered. */
  provider: z.string().optional(),
});

export type SystemOneResponseBody = z.infer<typeof SystemOneResponseBody>;
