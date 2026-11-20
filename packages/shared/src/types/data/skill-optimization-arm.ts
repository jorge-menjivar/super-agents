import { z } from 'zod';

/** Model Configuration parameters
 * These are constants that define the range of values for each parameter.
 * All fields are normalized 0 to 1.
 */
export const SkillOptimizationBaseArmParams = z.object({
  temperature_min: z.number().min(0).max(1),
  temperature_max: z.number().min(0).max(1),
  top_p_min: z.number().min(0).max(1),
  top_p_max: z.number().min(0).max(1),
  top_k_min: z.number().min(0).max(1),
  top_k_max: z.number().min(0).max(1),
  frequency_penalty_min: z.number().min(0).max(1),
  frequency_penalty_max: z.number().min(0).max(1),
  presence_penalty_min: z.number().min(0).max(1),
  presence_penalty_max: z.number().min(0).max(1),
  thinking_min: z.number().min(0).max(1),
  thinking_max: z.number().min(0).max(1),
});
export type SkillOptimizationBaseArmParams = z.infer<
  typeof SkillOptimizationBaseArmParams
>;

export const SkillOptimizationArmParams = SkillOptimizationBaseArmParams.extend(
  {
    model_id: z.uuid(),
    /**
     * The prompt the arm serves its skill with. Empty is no prompt: the arm
     * adds nothing, and the caller's own instructions go through as they
     * came. That is how a decision skill the gateway creates starts -- its
     * system prompt is a policy its questions are asked under, and nobody
     * has written one yet -- so an empty prompt has to be one an arm can be
     * stored with and read back.
     */
    system_prompt: z.string(),
    // stop: z.array(z.string()),
    // seed: z.number().int(),
    // Additional provider-specific parameters can be added here
    // additional_params: z.record(z.string(), z.unknown()),
  },
);
export type SkillOptimizationArmParams = z.infer<
  typeof SkillOptimizationArmParams
>;

export const SkillOptimizationArmStats = z.object({
  /** Number of times the arm was played */
  n: z.number().min(0),
  /** Mean reward */
  mean: z.number().min(0).max(1),
  /** Sum of squares of rewards */
  n2: z.number().min(0),
  /** Total reward */
  total_reward: z.number().min(0),
});
export type SkillOptimizationArmStats = z.infer<
  typeof SkillOptimizationArmStats
>;

export const SkillOptimizationArm = z.object({
  id: z.uuid(),
  agent_id: z.uuid(),
  skill_id: z.uuid(),
  cluster_id: z.uuid(),

  /** An auto-generated name for the arm. */
  name: z.string(),

  /** Complete Skill Optimization Arm Parameters
   * This configuration defines what parameters are sent to the AI provider.
   */
  params: SkillOptimizationArmParams,

  created_at: z.iso.datetime({ offset: true }),
  updated_at: z.iso.datetime({ offset: true }),
});
export type SkillOptimizationArm = z.infer<typeof SkillOptimizationArm>;

export const SkillOptimizationArmQueryParams = z
  .object({
    id: z.uuid().optional(),
    agent_id: z.uuid().optional(),
    skill_id: z.uuid().optional(),
    cluster_id: z.uuid().optional(),
    name: z.string().optional(),
    limit: z.coerce.number().min(1).max(100).default(100).optional(),
    offset: z.coerce.number().min(0).default(0).optional(),
  })
  .strict();
export type SkillOptimizationArmQueryParams = z.infer<
  typeof SkillOptimizationArmQueryParams
>;

export const SkillOptimizationArmCreateParams = z
  .object({
    agent_id: z.uuid(),
    skill_id: z.uuid(),
    cluster_id: z.uuid(),
    name: z.string(),
    params: SkillOptimizationArmParams,
  })
  .strict();
export type SkillOptimizationArmCreateParams = z.infer<
  typeof SkillOptimizationArmCreateParams
>;

// Params can be updated during reflection
// Name is constant defined at creation time
export const SkillOptimizationArmUpdateParams = z
  .object({
    params: SkillOptimizationArmParams.optional(),
  })
  .strict();
export type SkillOptimizationArmUpdateParams = z.infer<
  typeof SkillOptimizationArmUpdateParams
>;

/**
 * The configuration whose system prompt and parameters served a request,
 * recorded on the log as `metadata.served_configuration`: the log row keeps
 * the partition it belongs to, but not which of that partition's
 * configurations was pulled.
 *
 * The name is stored beside the id so a log reads without loading the arms
 * it was written against, and so it still names the configuration if that
 * arm is later deleted with its partition.
 */
export const ServedConfiguration = z.object({
  id: z.uuid(),
  name: z.string(),
});
export type ServedConfiguration = z.infer<typeof ServedConfiguration>;
