import { z } from 'zod';
import { ReasoningEffort } from '../api/routes/shared/thinking';
import {
  MAX_INTERNAL_TIMEOUT_MS,
  MIN_INTERNAL_TIMEOUT_MS,
} from './system-settings';

/** An agent's own timeout for an internal call, in milliseconds; null means
 * the system setting. */
const TimeoutValue = z
  .int()
  .min(MIN_INTERNAL_TIMEOUT_MS)
  .max(MAX_INTERNAL_TIMEOUT_MS)
  .nullable();
const EffortValue = z.enum(ReasoningEffort).nullable();
const TokenBudgetValue = z.int().positive().nullable();

// On the row every field reads as null when it was never written; in a patch
// it stays absent, so sending one field cannot silently clear another.
const TimeoutOverride = TimeoutValue.default(null);
const EffortOverride = EffortValue.default(null);

/** A text role's overrides: how long it may take, and how hard it may think. */
const textRole = () =>
  z
    .object({ timeout_ms: TimeoutOverride, reasoning_effort: EffortOverride })
    .prefault({});

/**
 * What an agent answers for itself, where the system already has an answer.
 *
 * The models are columns, for the reason the system settings' are: the
 * database does real work for them -- a model an agent names cannot be
 * deleted out from under it, and an embedding model cannot sit in a text
 * slot. A timeout or an effort means nothing to the database, so those live
 * here, typed rather than migrated.
 *
 * Every field is null, and **null means inherit** -- unlike the system's own
 * options, where it means "send nothing". An agent that has never been
 * touched therefore reads exactly as the settings say, a field added later
 * reads as inherit on every row written before it, and an agent keeps
 * following the settings it has no opinion about as they change.
 */
export const AgentOptions = z
  .object({
    system_prompt_reflection: textRole(),
    evaluation_generation: textRole(),
    /** One forward pass with nothing to think about, so time is all it has. */
    embedding: z.object({ timeout_ms: TimeoutOverride }).prefault({}),
    judge: z
      .object({
        timeout_ms: TimeoutOverride,
        /** Completion tokens one judging attempt may spend; null inherits. */
        max_tokens: TokenBudgetValue.default(null),
        reasoning_effort: EffortOverride,
      })
      .prefault({}),
    skill_arbiter: textRole(),
    intent_compaction: textRole(),
    /**
     * How long this agent's reviewer may take, the client waiting throughout.
     * Not a model the agent names -- the reviewer is another agent, with its
     * own skill and its own models -- so time is the only thing to say about
     * it here. Null is `DEFAULT_REVIEW_TIMEOUT_MS`.
     */
    review: z.object({ timeout_ms: TimeoutOverride }).prefault({}),
  })
  .prefault({});
export type AgentOptions = z.infer<typeof AgentOptions>;

const textRoleUpdate = () =>
  z
    .object({
      timeout_ms: TimeoutValue.optional(),
      reasoning_effort: EffortValue.optional(),
    })
    .optional();

/** A patch carries the roles it changes, and the fields it changes in them. */
export const AgentOptionsUpdate = z.object({
  system_prompt_reflection: textRoleUpdate(),
  evaluation_generation: textRoleUpdate(),
  embedding: z.object({ timeout_ms: TimeoutValue.optional() }).optional(),
  judge: z
    .object({
      timeout_ms: TimeoutValue.optional(),
      max_tokens: TokenBudgetValue.optional(),
      reasoning_effort: EffortValue.optional(),
    })
    .optional(),
  skill_arbiter: textRoleUpdate(),
  intent_compaction: textRoleUpdate(),
  review: z.object({ timeout_ms: TimeoutValue.optional() }).optional(),
});
export type AgentOptionsUpdate = z.infer<typeof AgentOptionsUpdate>;

function mergeRole<R extends keyof AgentOptions>(
  current: AgentOptions,
  update: AgentOptionsUpdate,
  role: R,
): AgentOptions[R] {
  const patch = update[role];
  if (!patch) {
    return current[role];
  }
  // Only the fields the patch actually sent, so `undefined` cannot unset one
  // while `null` -- go back to inheriting -- still can.
  const sent = Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  );
  return { ...current[role], ...sent };
}

/** A patch over what the agent has, role by role. */
export function mergeAgentOptions(
  current: AgentOptions,
  update: AgentOptionsUpdate,
): AgentOptions {
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
    review: mergeRole(current, update, 'review'),
  };
}

export const Agent = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string(),
  metadata: z.record(z.string(), z.unknown()),

  /** Whether a request that names only the agent may become a new skill when
   * it resembles none of the existing ones. */
  auto_create_skills: z.boolean(),

  /** Cosine similarity to the closest skill below which such a request gets a
   * skill of its own. */
  skill_match_threshold: z.number().min(0).max(1),

  /** How many skills the gateway may create for the agent. Past it, requests
   * go to the closest skill however far it is. */
  max_auto_created_skills: z.int().min(0),

  /**
   * The models asked on this agent's behalf, one per internal role; null
   * means the system setting. Every call the gateway makes for an agent --
   * routing its requests, judging its answers, writing its skills' prompts
   * -- can be a different model from the one another agent uses, because
   * what suits the work is a property of the work.
   */
  system_prompt_reflection_model_id: z.uuid().nullable(),
  evaluation_generation_model_id: z.uuid().nullable(),
  embedding_model_id: z.uuid().nullable(),
  judge_model_id: z.uuid().nullable(),
  skill_arbiter_model_id: z.uuid().nullable(),
  intent_compaction_model_id: z.uuid().nullable(),

  /** How long each of those may take and how hard it may think, plus how
   * long the agent's reviewer may take, where the agent has an opinion.
   * Null inherits. */
  options: AgentOptions,

  /** Another agent that reviews every response before the client receives
   * it, and may withhold or rewrite it; null means responses go unreviewed.
   * Never the agent itself. */
  reviewer_agent_id: z.uuid().nullable(),

  /** Whether a response the reviewer could not judge -- unreachable, or no
   * verdict -- is withheld rather than delivered. */
  review_fail_closed: z.boolean(),

  /** Whether a client whose response the reviewer withheld is told the
   * reviewer's reason, or only that it was withheld. */
  review_expose_reason: z.boolean(),

  created_at: z.iso.datetime({ offset: true }),
  updated_at: z.iso.datetime({ offset: true }),
});
export type Agent = z.infer<typeof Agent>;

export const AgentQueryParams = z
  .object({
    id: z.uuid().optional(),
    name: z
      .string()
      .regex(/^[a-z0-9_-]+$/, {
        message:
          'Name must only contain lowercase letters, numbers, underscores, and hyphens',
      })
      .min(3)
      .max(100)
      .optional(),
    limit: z.coerce.number().int().positive().optional(),
    offset: z.coerce.number().int().min(0).optional(),
  })
  .strict();

export type AgentQueryParams = z.infer<typeof AgentQueryParams>;

export const AgentCreateParams = z
  .object({
    name: z
      .string()
      .regex(/^[a-z0-9_-]+$/, {
        message:
          'Name must only contain lowercase letters, numbers, underscores, and hyphens',
      })
      .min(3)
      .max(100)
      .refine((name) => name !== 'super-agents', {
        message:
          'The name "super-agents" is reserved for internal system use. Please choose a different name.',
      }),
    description: z.string().min(25).max(10000),
    metadata: z.record(z.string(), z.unknown()).default({}),
    auto_create_skills: z.boolean().default(true),
    skill_match_threshold: z.number().min(0).max(1).default(0.8),
    max_auto_created_skills: z.int().min(0).default(10),
    system_prompt_reflection_model_id: z.uuid().nullable().optional(),
    evaluation_generation_model_id: z.uuid().nullable().optional(),
    embedding_model_id: z.uuid().nullable().optional(),
    judge_model_id: z.uuid().nullable().optional(),
    skill_arbiter_model_id: z.uuid().nullable().optional(),
    intent_compaction_model_id: z.uuid().nullable().optional(),
    options: AgentOptionsUpdate.optional(),
    reviewer_agent_id: z.uuid().nullable().optional(),
    review_fail_closed: z.boolean().default(false),
    review_expose_reason: z.boolean().default(false),
  })
  .strict();

export type AgentCreateParams = z.infer<typeof AgentCreateParams>;

export const AgentUpdateParams = z
  .object({
    description: z.string().nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    auto_create_skills: z.boolean().optional(),
    skill_match_threshold: z.number().min(0).max(1).optional(),
    max_auto_created_skills: z.int().min(0).optional(),
    system_prompt_reflection_model_id: z.uuid().nullable().optional(),
    evaluation_generation_model_id: z.uuid().nullable().optional(),
    embedding_model_id: z.uuid().nullable().optional(),
    judge_model_id: z.uuid().nullable().optional(),
    skill_arbiter_model_id: z.uuid().nullable().optional(),
    intent_compaction_model_id: z.uuid().nullable().optional(),
    options: AgentOptionsUpdate.optional(),
    reviewer_agent_id: z.uuid().nullable().optional(),
    review_fail_closed: z.boolean().optional(),
    review_expose_reason: z.boolean().optional(),
  })
  .strict()
  .refine(
    (data) => {
      const updateFields = [
        'description',
        'metadata',
        'auto_create_skills',
        'skill_match_threshold',
        'max_auto_created_skills',
        'system_prompt_reflection_model_id',
        'evaluation_generation_model_id',
        'embedding_model_id',
        'judge_model_id',
        'skill_arbiter_model_id',
        'intent_compaction_model_id',
        'options',
        'reviewer_agent_id',
        'review_fail_closed',
        'review_expose_reason',
      ];
      return updateFields.some(
        (field) => data[field as keyof typeof data] !== undefined,
      );
    },
    {
      message: 'At least one field must be provided for update',
      path: ['description', 'metadata'],
    },
  );

export type AgentUpdateParams = z.infer<typeof AgentUpdateParams>;
