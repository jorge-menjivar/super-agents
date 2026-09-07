import { z } from 'zod';
import {
  MAX_SKILL_ARBITER_TIMEOUT_MS,
  MIN_SKILL_ARBITER_TIMEOUT_MS,
} from './system-settings';

/** The agent's own arbiter timeout, in milliseconds; null means the system setting. */
const SkillArbiterTimeoutOverride = z
  .int()
  .min(MIN_SKILL_ARBITER_TIMEOUT_MS)
  .max(MAX_SKILL_ARBITER_TIMEOUT_MS)
  .nullable();

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

  /** The model the skill arbiter asks for this agent's requests; null means
   * the system setting. */
  skill_arbiter_model_id: z.uuid().nullable(),

  /** How long one arbiter attempt may take for this agent; null means the
   * system setting. */
  skill_arbiter_timeout_ms: SkillArbiterTimeoutOverride,

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
    skill_arbiter_model_id: z.uuid().nullable().optional(),
    skill_arbiter_timeout_ms: SkillArbiterTimeoutOverride.optional(),
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
    skill_arbiter_model_id: z.uuid().nullable().optional(),
    skill_arbiter_timeout_ms: SkillArbiterTimeoutOverride.optional(),
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
        'skill_arbiter_model_id',
        'skill_arbiter_timeout_ms',
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
