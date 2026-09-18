import { z } from 'zod';

export const SkillMetadata = z
  .object({
    // Empty for now - reserved for user-defined custom data
    // State management fields have been moved to proper columns
  })
  .strict();

export const Skill = z.object({
  id: z.uuid(),
  agent_id: z.uuid(),

  /** Name of the skill. Unique within the agent. */
  name: z.string(),

  /** Description of the skill. This will be used by Super Agents to automatically optimize the skill. */
  description: z.string(),

  /** Internal metadata for the skill. Reserved for user-defined custom data. */
  metadata: SkillMetadata,

  /** Whether to optimize the skill. */
  optimize: z.boolean(),

  /** Number of configurations for the skill. */
  configuration_count: z.int(),

  /** Recompute the centroid of the cluster every N requests
   *  so that they can better represent the last N requests.
   */
  clustering_interval: z.int(),

  /** Minimum number of requests per arm in a configuration (cluster)
   * to trigger reflection.
   * This is to ensure that the arms for the cluster have convergence. */
  reflection_min_requests_per_arm: z.int(),

  /** Temperature parameter for Thompson Sampling exploration.
   * Controls the exploration/exploitation tradeoff:
   * - 1.0: Standard Thompson Sampling (balanced)
   * - > 1.0: More exploration (takes more risks, tries suboptimal arms more often)
   * - < 1.0: More exploitation (sticks to known good arms)
   * Recommended range: 0.5 to 3.0 */
  exploration_temperature: z.number().min(0.1).max(10.0),

  /** Timestamp when clustering was last performed for this skill */
  last_clustering_at: z.iso.datetime({ offset: true }).nullable(),

  /** Unix timestamp of the most recent log used in the last clustering batch.
   * We will query the logs from this timestamp to the current time to find the most recent logs. */
  last_clustering_log_start_time: z.number().nullable(),

  /** The timestamp when evaluations were first regenerated with real examples.
   * This happens after the first 5 requests to ensure evaluations align with actual usage. */
  evaluations_regenerated_at: z.iso.datetime({ offset: true }).nullable(),

  /** Lock timestamp to prevent concurrent evaluation regeneration across edge workers.
   * If set and recent (< 5 minutes old), regeneration is in progress. */
  evaluation_lock_acquired_at: z.iso.datetime({ offset: true }).nullable(),

  /** Total number of requests for this skill (never resets, for lifetime observability) */
  total_requests: z.number().min(0),

  /** List of allowed Jinja-style template variables that can be used in system prompts.
   * These variables will be auto-populated at runtime and shown to the reflector AI.
   * Example: ['datetime', 'user_timezone'] */
  allowed_template_variables: z.array(z.string()),

  /** True when the gateway created the skill for a request that named only
   * the agent. Counts against the agent's `max_auto_created_skills`. */
  auto_created: z.boolean(),

  /** The caller's system prompt when the gateway created the skill. The
   * first arms use it verbatim, so the skill starts as a pass-through, and
   * later regenerations improve on it rather than starting over. */
  seed_system_prompt: z.string().nullable(),

  created_at: z.iso.datetime({ offset: true }),
  updated_at: z.iso.datetime({ offset: true }),
});
export type Skill = z.infer<typeof Skill>;

/** Every column of a skill but the one the dashboard never draws. */
const SkillWithoutSeed = Skill.omit({ seed_system_prompt: true });

/**
 * The columns a summary is read with, taken from the schema rather than
 * written out, so a column added to `Skill` is in the summary by default and
 * the two backends cannot drift from each other or from the type.
 */
export const SKILL_SUMMARY_COLUMNS = Object.keys(
  SkillWithoutSeed.shape,
) as (keyof z.infer<typeof SkillWithoutSeed>)[];

/**
 * A skill read as a list row: everything but `seed_system_prompt`.
 *
 * That one column is the caller's whole system prompt, kept so that a skill
 * the gateway created starts as a pass-through -- tens of kilobytes each, and
 * 96% of what listing an agent's skills transfers. Nothing in the dashboard
 * renders it: the lists want a name, an id and the counts.
 *
 * It is declared here as optional rather than left out, so a whole `Skill` is
 * still a `SkillSummary` and one type serves both the lists and the pages
 * that hold a single skill. The gateway keeps reading whole skills --
 * `routeRequestToSkill` seeds a skill's identity centroid from this prompt --
 * which is why this is a second way to read them rather than a narrowing of
 * the first.
 */
export const SkillSummary = SkillWithoutSeed.extend({
  seed_system_prompt: z.string().nullable().optional(),
});

export type SkillSummary = z.infer<typeof SkillSummary>;

/**
 * What a skill needs before it can serve, counted: `isSkillReady` decides
 * from these two numbers and the skill's own `optimize`.
 *
 * Counted for a whole agent at once, because that is the question every
 * surface actually asks. The sidebar draws a warning on an agent whose skills
 * are not all ready, a card draws one per skill, and answering those one
 * skill at a time meant two requests per skill on every page that listed any.
 */
export const SkillReadiness = z.object({
  skill_id: z.uuid(),
  model_count: z.int().min(0),
  evaluation_count: z.int().min(0),
  /**
   * Whether the skill is being optimized, which is what decides that a
   * missing evaluation matters. It travels with the counts so that deciding
   * readiness needs nothing else: without it every caller had to fetch the
   * agent's skills as well, and a skill row carries the seed system prompt
   * the gateway created it from -- hundreds of kilobytes to read one boolean.
   */
  optimize: z.boolean(),
});

export type SkillReadiness = z.infer<typeof SkillReadiness>;

/**
 * A skill of an agent and when it last served, for the dashboard's "recently
 * used" list.
 *
 * The skill row does not know this: `total_requests` counts them and
 * `updated_at` moves for clustering and edits alike, so the last time a skill
 * actually answered is only in its logs. It is asked for per agent, five rows
 * at a time, so that a card listing the newest few costs one small request
 * rather than a page of skills and a page of logs.
 */
export const RecentSkill = z.object({
  skill_id: z.uuid(),
  name: z.string(),
  /** Unix milliseconds: the `start_time` of the skill's most recent request. */
  last_used_at: z.number(),
});

export type RecentSkill = z.infer<typeof RecentSkill>;

export const SkillQueryParams = z
  .object({
    id: z.uuid().optional(),
    agent_id: z.uuid().optional(),
    name: z
      .string()
      .regex(/^[a-z0-9_-]+$/, {
        message:
          'Name must only contain lowercase letters, numbers, underscores, and hyphens',
      })
      .min(3)
      .max(100)
      .optional(),
    optimize: z.boolean().optional(),
    limit: z.coerce.number().int().positive().optional(),
    offset: z.coerce.number().int().min(0).optional(),
  })
  .strict();

export type SkillQueryParams = z.infer<typeof SkillQueryParams>;

export const SkillCreateParams = z
  .object({
    agent_id: z.uuid(),
    name: z
      .string()
      .min(3)
      .max(100)
      .regex(/^[a-z0-9_-]+$/, {
        message:
          'Name must only contain lowercase letters, numbers, underscores, and hyphens',
      }),
    description: z.string().min(25).max(10000),
    metadata: SkillMetadata,
    optimize: z.boolean(),
    configuration_count: z.int().min(1).max(25).default(3),
    clustering_interval: z.int().min(1).max(1000).default(15),
    reflection_min_requests_per_arm: z.int().min(1).max(1000).default(3),
    exploration_temperature: z.number().min(0.1).max(10.0).default(3.0),
    allowed_template_variables: z.array(z.string()).optional().default([]),
    auto_created: z.boolean().default(false),
    seed_system_prompt: z.string().nullable().optional(),
  })
  .strict();

export type SkillCreateParams = z.infer<typeof SkillCreateParams>;

export const SkillUpdateParams = z
  .object({
    name: z
      .string()
      .min(3)
      .max(100)
      .regex(/^[a-z0-9_-]+$/, {
        message:
          'Name must only contain lowercase letters, numbers, underscores, and hyphens',
      })
      .optional(),
    description: z.string().min(25).max(10000).optional(),
    metadata: SkillMetadata.optional(),
    optimize: z.boolean().optional(),
    configuration_count: z.int().min(1).max(25).optional(),
    clustering_interval: z.int().min(1).max(1000).optional(),
    reflection_min_requests_per_arm: z.int().min(1).max(1000).optional(),
    exploration_temperature: z.number().min(0.1).max(10.0).optional(),
    allowed_template_variables: z.array(z.string()).optional(),
    seed_system_prompt: z.string().nullable().optional(),
    // State management fields (typically updated by system, not user)
    last_clustering_at: z.iso.datetime({ offset: true }).nullable().optional(),
    last_clustering_log_start_time: z.number().nullable().optional(),
    evaluations_regenerated_at: z.iso
      .datetime({ offset: true })
      .nullable()
      .optional(),
    evaluation_lock_acquired_at: z.iso
      .datetime({ offset: true })
      .nullable()
      .optional(),
  })
  .strict()
  .refine(
    (data) => {
      const updateFields = [
        'name',
        'description',
        'metadata',
        'optimize',
        'configuration_count',
        'clustering_interval',
        'reflection_min_requests_per_arm',
        'exploration_temperature',
        'allowed_template_variables',
        'seed_system_prompt',
        'last_clustering_at',
        'last_clustering_log_start_time',
        'evaluations_regenerated_at',
        'evaluation_lock_acquired_at',
      ];
      return updateFields.some(
        (field) => data[field as keyof typeof data] !== undefined,
      );
    },
    {
      message: 'At least one field must be provided for update',
      path: [
        'description',
        'metadata',
        'optimize',
        'configuration_count',
        'clustering_interval',
        'reflection_min_requests_per_arm',
        'exploration_temperature',
        'seed_system_prompt',
        'last_clustering_at',
        'last_clustering_log_start_time',
        'evaluations_regenerated_at',
        'evaluation_lock_acquired_at',
      ],
    },
  );

export type SkillUpdateParams = z.infer<typeof SkillUpdateParams>;
