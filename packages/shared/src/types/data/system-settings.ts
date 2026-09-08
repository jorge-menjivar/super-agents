import { ReasoningEffort } from '@shared/types/api/routes/shared/thinking';
import { z } from 'zod';

/**
 * Bounds on how long one attempt at an internal skill call may take.
 *
 * Every internal skill -- judging, embedding, prompt generation, routing --
 * is an ordinary gateway request this server sends to its own `/v1`, and each
 * one has a timeout of its own beside the model it asks. They share bounds
 * because the thing being bounded is the same: one call to a model, retried
 * once by the client. The ceiling is generous for slow self-hosted models but
 * not unbounded, and the floor keeps a mistyped value from disabling a
 * feature outright.
 *
 * A timeout that is too short is not a small problem. Compaction, the arbiter
 * and skill naming all answer on the request path, so the caller waits out
 * every attempt before the fallback; the rest hold an optimizer lock while
 * they run. That is why these are settings rather than constants: the right
 * value depends on the model, and a self-hosted one can be an order of
 * magnitude slower than a hosted one at the same job.
 */
export const MIN_INTERNAL_TIMEOUT_MS = 1_000;
export const MAX_INTERNAL_TIMEOUT_MS = 600_000;

/**
 * Defaults, one per setting, chosen from what the call actually does rather
 * than from one number for everything.
 *
 * The two on the request path are short, because a caller waits for them. The
 * generation calls are long, because they write a system prompt or a set of
 * evaluations from scratch. Embedding is the shortest: it is one forward pass,
 * and it is on the request path too.
 */
export const DEFAULT_SKILL_ARBITER_TIMEOUT_MS = 15_000;
export const DEFAULT_INTENT_COMPACTION_TIMEOUT_MS = 60_000;
export const DEFAULT_SYSTEM_PROMPT_REFLECTION_TIMEOUT_MS = 120_000;
export const DEFAULT_EVALUATION_GENERATION_TIMEOUT_MS = 120_000;
export const DEFAULT_JUDGE_TIMEOUT_MS = 60_000;
export const DEFAULT_EMBEDDING_TIMEOUT_MS = 30_000;

/**
 * How many completion tokens one judging call may spend.
 *
 * The judge's own answer is a few hundred tokens of JSON, but a reasoning
 * model spends its budget thinking before it writes a word, and a budget it
 * exhausts on reasoning returns an empty completion rather than a short one.
 * glm-5.3-flash was measured burning 1100-2700 tokens on reasoning for a
 * short prompt and all of 4000 for a transcript-sized one, so the right value
 * depends on the model -- which is why it is a setting beside the judge model
 * rather than a constant, or a parameter hidden on every evaluation.
 *
 * The floor leaves room for the answer itself; the ceiling only keeps a
 * mistyped value from asking for the impossible.
 */
export const MIN_JUDGE_MAX_TOKENS = 256;
export const MAX_JUDGE_MAX_TOKENS = 1_000_000;
export const DEFAULT_JUDGE_MAX_TOKENS = 4_000;

/**
 * The internal roles that have a model slot of their own in system settings,
 * each with a `<role>_model_id` column and an `options.<role>` object.
 */
export const INTERNAL_ROLES = [
  'system_prompt_reflection',
  'evaluation_generation',
  'embedding',
  'judge',
  'skill_arbiter',
  'intent_compaction',
] as const;
export type InternalRole = (typeof INTERNAL_ROLES)[number];

/**
 * The roles served by a text model, which is every role but embedding.
 *
 * Only these carry a reasoning effort: an embedding is one forward pass with
 * nothing to think about, and its slot takes an embed model anyway.
 */
export const TEXT_ROLES = INTERNAL_ROLES.filter(
  (role): role is Exclude<InternalRole, 'embedding'> => role !== 'embedding',
);
export type TextRole = (typeof TEXT_ROLES)[number];

const timeout = (defaultMs: number) =>
  z.number().int().positive().default(defaultMs);

/**
 * How hard a reasoning model may think before it answers.
 *
 * Null sends nothing and leaves the model to its own default, which is where
 * every role starts. It is per role because the roles ask for different work:
 * the judge answers a score and a sentence and the arbiter names a skill,
 * while reflection writes a system prompt and may be worth the thinking. A
 * model that takes no such parameter is unaffected -- the gateway drops it
 * from the request.
 */
const reasoningEffort = () => z.enum(ReasoningEffort).nullable().default(null);
const timeoutUpdate = () =>
  z
    .number()
    .int()
    .min(MIN_INTERNAL_TIMEOUT_MS)
    .max(MAX_INTERNAL_TIMEOUT_MS)
    .optional();

/**
 * The settings that need no column of their own.
 *
 * The model ids are columns because the database does real work for them: a
 * model a setting names cannot be deleted, and an embedding model cannot be
 * put in a text slot. Nothing in the database interprets a timeout, a token
 * budget or a flag, so those live together in one JSON column and are typed
 * here instead. Every field has a default, so a row written before a field
 * existed reads as if it had been set to the default, and adding a setting
 * is a change to this schema and the form -- not to either backend's schema.
 *
 * `prefault` rather than `default` on the objects: a missing role object has
 * to be parsed into its defaults, not returned as the empty object.
 */
export const SystemSettingsOptions = z.object({
  /**
   * How long one attempt may take at the calls this model serves: seeding a
   * new skill's system prompt, reflecting on an existing one, and naming a
   * skill the gateway creates.
   */
  system_prompt_reflection: z
    .object({
      timeout_ms: timeout(DEFAULT_SYSTEM_PROMPT_REFLECTION_TIMEOUT_MS),
      reasoning_effort: reasoningEffort(),
    })
    .prefault({}),
  /** How long one attempt at generating a skill's evaluations may take. */
  evaluation_generation: z
    .object({
      timeout_ms: timeout(DEFAULT_EVALUATION_GENERATION_TIMEOUT_MS),
      reasoning_effort: reasoningEffort(),
    })
    .prefault({}),
  /**
   * How long one embedding call may take. On the request path -- routing
   * embeds every request's intent -- so this is the shortest of them.
   */
  embedding: z
    .object({ timeout_ms: timeout(DEFAULT_EMBEDDING_TIMEOUT_MS) })
    .prefault({}),
  judge: z
    .object({
      /** How long one judging attempt may take, task extraction included. */
      timeout_ms: timeout(DEFAULT_JUDGE_TIMEOUT_MS),
      /**
       * How many completion tokens one judging attempt may spend. A thinking
       * model spends these before it writes a word, and one that runs out
       * answers nothing at all -- which is why this sits beside the effort.
       */
      max_tokens: z.number().int().positive().default(DEFAULT_JUDGE_MAX_TOKENS),
      reasoning_effort: reasoningEffort(),
    })
    .prefault({}),
  /** How long one arbiter attempt may take, in milliseconds. */
  skill_arbiter: z
    .object({
      timeout_ms: timeout(DEFAULT_SKILL_ARBITER_TIMEOUT_MS),
      reasoning_effort: reasoningEffort(),
    })
    .prefault({}),
  /** How long one compaction attempt may take, in milliseconds. */
  intent_compaction: z
    .object({
      timeout_ms: timeout(DEFAULT_INTENT_COMPACTION_TIMEOUT_MS),
      reasoning_effort: reasoningEffort(),
    })
    .prefault({}),
  /** Shows the `super-agents` internal agent and its skills in the dashboard. */
  developer_mode: z.boolean().default(false),
});
export type SystemSettingsOptions = z.infer<typeof SystemSettingsOptions>;

export const SystemSettings = z.object({
  id: z.uuid(),
  system_prompt_reflection_model_id: z.uuid().nullable(),
  evaluation_generation_model_id: z.uuid().nullable(),
  embedding_model_id: z.uuid().nullable(),
  judge_model_id: z.uuid().nullable(),
  /**
   * The model the skill arbiter asks when a request matches no skill closely.
   * Null defers to the system prompt reflection model.
   */
  skill_arbiter_model_id: z.uuid().nullable(),
  /**
   * The model that compacts a system prompt too long to embed whole before
   * routing embeds it. Null defers to the system prompt reflection model.
   */
  intent_compaction_model_id: z.uuid().nullable(),
  options: SystemSettingsOptions,
  created_at: z.iso.datetime({ offset: true }),
  updated_at: z.iso.datetime({ offset: true }),
});
export type SystemSettings = z.infer<typeof SystemSettings>;

/**
 * A partial update to the options: each role object is merged over the stored
 * one, so a caller sends only the fields it changes. Strict throughout, so a
 * misspelled field is refused rather than stored and ignored.
 */
/** Null clears a reasoning effort: back to the model's own default. */
const reasoningEffortUpdate = () =>
  z.enum(ReasoningEffort).nullable().optional();

/** A text role's patch: its timeout, its reasoning effort, or both. */
const textRoleUpdate = () =>
  z
    .object({
      timeout_ms: timeoutUpdate(),
      reasoning_effort: reasoningEffortUpdate(),
    })
    .strict()
    .optional();

export const SystemSettingsOptionsUpdate = z
  .object({
    system_prompt_reflection: textRoleUpdate(),
    evaluation_generation: textRoleUpdate(),
    embedding: z.object({ timeout_ms: timeoutUpdate() }).strict().optional(),
    judge: z
      .object({
        timeout_ms: timeoutUpdate(),
        max_tokens: z
          .number()
          .int()
          .min(MIN_JUDGE_MAX_TOKENS)
          .max(MAX_JUDGE_MAX_TOKENS)
          .optional(),
        reasoning_effort: reasoningEffortUpdate(),
      })
      .strict()
      .optional(),
    skill_arbiter: textRoleUpdate(),
    intent_compaction: textRoleUpdate(),
    developer_mode: z.boolean().optional(),
  })
  .strict();
export type SystemSettingsOptionsUpdate = z.infer<
  typeof SystemSettingsOptionsUpdate
>;

export const SystemSettingsUpdateParams = z
  .object({
    system_prompt_reflection_model_id: z.uuid().nullable().optional(),
    evaluation_generation_model_id: z.uuid().nullable().optional(),
    embedding_model_id: z.uuid().nullable().optional(),
    judge_model_id: z.uuid().nullable().optional(),
    skill_arbiter_model_id: z.uuid().nullable().optional(),
    intent_compaction_model_id: z.uuid().nullable().optional(),
    options: SystemSettingsOptionsUpdate.optional(),
  })
  .strict();

export type SystemSettingsUpdateParams = z.infer<
  typeof SystemSettingsUpdateParams
>;

/**
 * The stored options with an update laid over them: one level deep, so a
 * role's unchanged fields survive a patch that names only one of them.
 * Shared by both storage backends so they cannot drift on what a patch means.
 */
export function mergeSystemSettingsOptions(
  current: SystemSettingsOptions,
  update: SystemSettingsOptionsUpdate,
): SystemSettingsOptions {
  return {
    system_prompt_reflection: mergeRole(
      current,
      update,
      'system_prompt_reflection',
    ),
    evaluation_generation: mergeRole(current, update, 'evaluation_generation'),
    embedding: mergeRole(current, update, 'embedding'),
    judge: mergeRole(current, update, 'judge'),
    skill_arbiter: mergeRole(current, update, 'skill_arbiter'),
    intent_compaction: mergeRole(current, update, 'intent_compaction'),
    developer_mode: update.developer_mode ?? current.developer_mode,
  };
}

function mergeRole<R extends InternalRole>(
  current: SystemSettingsOptions,
  update: SystemSettingsOptionsUpdate,
  role: R,
): SystemSettingsOptions[R] {
  const patch = update[role];
  if (!patch) {
    return current[role];
  }
  // Only the fields the patch actually sent, so `undefined` cannot unset one.
  const sent = Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  );
  return { ...current[role], ...sent };
}
