import { z } from 'zod';

/**
 * Where an agent's requests go when the caller names only the agent.
 *
 * One row per skill: a running mean of the intent embeddings of the requests
 * the skill has served, seeded from its description. A request is routed to
 * the skill whose centroid its own intent embedding is closest to.
 */
export const SkillRouting = z.object({
  skill_id: z.uuid(),
  agent_id: z.uuid(),

  /** The mean identity embedding (system prompt and tools) of the skill's
   * traffic; for a request with no identity, its whole intent. */
  centroid: z.array(z.number()),

  /** The mean conversation embedding of the skill's traffic. Null until a
   * request with a conversation reaches the skill. */
  conversation_centroid: z.array(z.number()).nullable(),

  /** The model the centroids were computed with. A row computed with another
   * model is meaningless under the current one and gets re-seeded. */
  embedding_model_id: z.uuid(),

  /** How many intents the identity mean has absorbed, the seed included. */
  sample_count: z.int().min(0),

  /** How many conversations the conversation mean has absorbed. */
  conversation_sample_count: z.int().min(0),

  created_at: z.iso.datetime({ offset: true }),
  updated_at: z.iso.datetime({ offset: true }),
});
export type SkillRouting = z.infer<typeof SkillRouting>;

export const SkillRoutingQueryParams = z
  .object({
    agent_id: z.uuid().optional(),
    skill_id: z.uuid().optional(),
  })
  .strict();
export type SkillRoutingQueryParams = z.infer<typeof SkillRoutingQueryParams>;

export const SkillRoutingUpsertParams = z
  .object({
    skill_id: z.uuid(),
    agent_id: z.uuid(),
    centroid: z.array(z.number()),
    conversation_centroid: z.array(z.number()).nullable(),
    embedding_model_id: z.uuid(),
    sample_count: z.int().min(0),
    conversation_sample_count: z.int().min(0),
  })
  .strict();
export type SkillRoutingUpsertParams = z.infer<typeof SkillRoutingUpsertParams>;

export const SkillRoutingMethod = z.enum([
  'only_skill',
  'embedding',
  'most_used',
  'created',
  /** The score fell below the threshold and a model chose an existing skill. */
  'arbitrated',
]);
export type SkillRoutingMethod = z.infer<typeof SkillRoutingMethod>;

/** How a request that named only the agent was matched to a skill. Recorded
 * on the log as `metadata.skill_routing`. */
export const SkillRoutingDecision = z.object({
  method: SkillRoutingMethod,
  /** The combined identity-and-conversation score of the closest skill,
   * when one was computed. */
  similarity: z.number().nullable(),
  /** The agent's `skill_match_threshold`, when it was consulted. */
  threshold: z.number().nullable(),
  /** How many of the agent's skills were in the running. */
  candidates: z.int().min(0),
  /** The two halves of the score, when both were computed. */
  identity_similarity: z.number().nullable().optional(),
  conversation_similarity: z.number().nullable().optional(),
  /**
   * How long choosing took, in milliseconds -- the embeddings, and on a miss
   * the arbiter and the skill it created. The client waits for all of it
   * before the provider is even asked, which is why it is worth recording
   * separately from the request's own duration. Absent on a log written
   * before the gateway measured it.
   */
  duration_ms: z.number().min(0).optional(),
});
export type SkillRoutingDecision = z.infer<typeof SkillRoutingDecision>;
