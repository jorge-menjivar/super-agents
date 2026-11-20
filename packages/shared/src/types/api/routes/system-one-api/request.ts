import { z } from 'zod';

/**
 * The System One API: what decision models speak.
 *
 * A decision model is asked questions about a piece of material -- the
 * `state` -- and answers each with probabilities, in one forward pass and
 * without writing a word. Jev (TypeSafe AI) and Drex (Nace.AI) serve the same
 * API at the same path, `POST /v1/systemone`, so the gateway takes it as it
 * is rather than translating it into chat completions, which have no place to
 * put a probability and no decision model behind them.
 */

/**
 * What a question's instructions, or one of its criteria, may be: text, or
 * structured data the model is shown alongside the question. Both vendors
 * take any JSON value here, and so does the gateway. Typed `unknown` rather
 * than `z.json()`: the body is parsed JSON whatever the schema says, and the
 * recursive JSON type, carried into `SuperAgentsRequestData`, makes every
 * narrowing of that union too deep for the compiler to instantiate.
 */
export const SystemOneGuidance = z.unknown();

export type SystemOneGuidance = z.infer<typeof SystemOneGuidance>;

/** A yes-or-no question, answered with the probability of yes. */
export const SystemOneNoulQuestion = z.object({
  type: z.literal('noul'),
  instructions: SystemOneGuidance.optional(),
  /** What yes and no each mean, when the question alone leaves it open. */
  criteria: z
    .object({
      true: SystemOneGuidance.optional(),
      false: SystemOneGuidance.optional(),
    })
    .nullable()
    .optional(),
});

/** A choice among named options, answered with a probability for each. */
export const SystemOneChoiceQuestion = z.object({
  type: z.literal('choice'),
  instructions: SystemOneGuidance.optional(),
  /**
   * Option label to its description, in option order. A null description
   * leaves the option to be read by its name alone.
   */
  criteria: z.record(z.string(), SystemOneGuidance).refine(
    (criteria) => {
      const options = Object.keys(criteria).length;
      return options >= 1 && options <= 255;
    },
    { message: 'A choice needs between 1 and 255 options' },
  ),
});

/** An ordered scale, lowest level first, answered with the expected level. */
export const SystemOneScoreQuestion = z.object({
  type: z.literal('score'),
  instructions: SystemOneGuidance.optional(),
  criteria: z.array(SystemOneGuidance).min(1),
});

export const SystemOneQuestion = z.discriminatedUnion('type', [
  SystemOneNoulQuestion,
  SystemOneChoiceQuestion,
  SystemOneScoreQuestion,
]);

export type SystemOneQuestion = z.infer<typeof SystemOneQuestion>;

/**
 * An image a request shows the model, inline. PNG or JPEG: the formats both
 * vendors take. Standard base64, with no `data:` prefix.
 */
export const SystemOneImageAsset = z.object({
  type: z.literal('image').optional(),
  format: z.enum(['png', 'jpg', 'jpeg']),
  data_base64: z.string().min(1),
});

export type SystemOneImageAsset = z.infer<typeof SystemOneImageAsset>;

export const SystemOneRequestBody = z.object({
  /**
   * The decision model to ask. Optional as it is on Drex; through an agent or
   * a skill, the skill's own model answers whatever this says.
   */
  model: z.string().optional(),
  /**
   * The material the questions are about. Any JSON value, `null` included,
   * but the key itself is required: a question about nothing has no answer.
   */
  state: z.unknown().refine((state) => state !== undefined, {
    message: 'Send a state, even if it is null',
  }),
  /**
   * The questions, keyed by ids the caller chooses. The ids key the answers
   * and are never shown to the model, so a question has to say what it asks.
   */
  questions: z
    .record(z.string().min(1), SystemOneQuestion)
    .refine((questions) => Object.keys(questions).length >= 1, {
      message: 'Ask at least one question',
    }),
  /**
   * The images the request shows the model, keyed by a reference that
   * stands for the image wherever it appears as text -- in the state, an
   * instruction or a criterion, mid-sentence or as a whole value. Jev's own
   * form; for Drex the gateway numbers them and writes "Image 1", "Image 2"
   * in place of the references, which is how Drex names them. Every image
   * must be referenced somewhere, and Drex takes at most eight.
   */
  assets: z.record(z.string().min(1).max(1024), SystemOneImageAsset).optional(),
});

export type SystemOneRequestBody = z.infer<typeof SystemOneRequestBody>;
