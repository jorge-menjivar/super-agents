import type { UserDataStorageConnector } from '@api/types/connector';
import type { AppContext } from '@api/types/hono';
import { decryptAPIKey, encryptAPIKey } from '@api/utils/api-key-encryption';
import { emitSSEEvent } from '@api/utils/sse-event-manager';
import {
  type AgentOptions,
  type AgentOptionsUpdate,
  Agent as AgentSchema,
  type Feedback,
  type FeedbackCreateParams,
  type FeedbackQueryParams,
  Feedback as FeedbackSchema,
  type ImprovedResponse,
  type ImprovedResponseQueryParams,
  ImprovedResponse as ImprovedResponseSchema,
  type ImprovedResponseUpdateParams,
  type Model,
  type ModelCreateParams,
  type ModelQueryParams,
  Model as ModelSchema,
  type ModelUpdateParams,
  mergeAgentOptions,
  mergeSystemSettingsOptions,
  type Skill,
  type SkillCreateParams,
  type SkillEvent,
  type SkillEventCreateParams,
  type SkillEventQueryParams,
  SkillEvent as SkillEventSchema,
  type SkillOptimizationArm,
  type SkillOptimizationArmCreateParams,
  type SkillOptimizationArmQueryParams,
  SkillOptimizationArm as SkillOptimizationArmSchema,
  type SkillOptimizationArmUpdateParams,
  type SkillOptimizationCluster,
  type SkillOptimizationClusterCreateParams,
  type SkillOptimizationClusterQueryParams,
  SkillOptimizationCluster as SkillOptimizationClusterSchema,
  type SkillOptimizationClusterUpdateParams,
  type SkillOptimizationEvaluation,
  type SkillOptimizationEvaluationCreateParams,
  type SkillOptimizationEvaluationQueryParams,
  type SkillOptimizationEvaluationRun,
  type SkillOptimizationEvaluationRunCreateParams,
  type SkillOptimizationEvaluationRunQueryParams,
  SkillOptimizationEvaluationRun as SkillOptimizationEvaluationRunSchema,
  SkillOptimizationEvaluation as SkillOptimizationEvaluationSchema,
  type SkillOptimizationEvaluationUpdateParams,
  type SkillQueryParams,
  type SkillRouting,
  type SkillRoutingQueryParams,
  SkillRouting as SkillRoutingSchema,
  type SkillRoutingUpsertParams,
  Skill as SkillSchema,
  type SkillUpdateParams,
  type SystemSettings,
  SystemSettings as SystemSettingsSchema,
  type SystemSettingsUpdateParams,
  type Tool,
  type ToolCreateParams,
  type ToolQueryParams,
  Tool as ToolSchema,
} from '@shared/types/data';
import type {
  Agent,
  AgentCreateParams,
  AgentQueryParams,
  AgentUpdateParams,
} from '@shared/types/data/agent';
import type {
  AIProviderConfig,
  AIProviderConfigCreateParams,
  AIProviderConfigQueryParams,
  AIProviderConfigUpdateParams,
} from '@shared/types/data/ai-provider';
import { AIProviderConfig as AIProviderConfigSchema } from '@shared/types/data/ai-provider';
import type { EvaluationScoresByTimeBucketParams } from '@shared/types/data/evaluation-runs-with-scores';
import type {
  SkillOptimizationArmStat,
  SkillOptimizationArmStatQueryParams,
} from '@shared/types/data/skill-optimization-arm-stats';
import { SkillOptimizationArmStat as SkillOptimizationArmStatSchema } from '@shared/types/data/skill-optimization-arm-stats';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { getLibsqlClient } from './client';
import {
  deleteFrom,
  insertInto,
  parseRows,
  selectFrom,
  updateIn,
} from './query';
import { asColumns, toJsonColumn } from './rows';
import { aggregateScoresByTimeBucket } from './time-bucket';

/**
 * libSQL implementation of `UserDataStorageConnector`.
 *
 * Deliberately shaped like `connectors/supabase/supabase.ts` method for method,
 * so the two can be diffed when behaviour is in question. The differences are
 * confined to three places:
 *
 * 1. **Ids.** Postgres defaults `id` to `uuid_generate_v4()`. SQLite has no
 *    uuid function, so creates that do not carry an id generate one here.
 * 2. **JSON columns.** Objects and arrays are stringified going in; `query.ts`
 *    decodes them coming out.
 * 3. **Stored procedures.** The five RPCs the API calls become explicit
 *    transactions at the bottom of this file.
 */

/** Postgres generates ids column-side; SQLite needs them supplied. */
const withId = <T extends { id?: string }>(row: T): T & { id: string } => ({
  ...row,
  id: row.id ?? uuidv4(),
});

export const libsqlUserDataStorageConnector: UserDataStorageConnector = {
  // ------------------------------------------------------------- Feedback
  getFeedback: async (
    c: AppContext,
    queryParams: FeedbackQueryParams,
  ): Promise<Feedback[]> =>
    selectFrom(
      getLibsqlClient(c),
      'feedbacks',
      { id: queryParams.id, log_id: queryParams.log_id },
      z.array(FeedbackSchema),
      { limit: queryParams.limit, offset: queryParams.offset },
    ),

  createFeedback: async (
    c: AppContext,
    feedback: FeedbackCreateParams,
  ): Promise<Feedback> => {
    const rows = await insertInto(
      getLibsqlClient(c),
      'feedbacks',
      withId(feedback),
      z.array(FeedbackSchema),
    );
    return rows[0];
  },

  deleteFeedback: async (c: AppContext, id: string): Promise<void> => {
    await deleteFrom(getLibsqlClient(c), 'feedbacks', { id });
  },

  // ----------------------------------------------------- Improved Response
  getImprovedResponse: async (
    c: AppContext,
    params: ImprovedResponseQueryParams,
  ): Promise<ImprovedResponse[]> =>
    selectFrom(
      getLibsqlClient(c),
      'improved_responses',
      {
        id: params.id,
        agent_id: params.agent_id,
        skill_id: params.skill_id,
        log_id: params.log_id,
      },
      z.array(ImprovedResponseSchema),
    ),

  createImprovedResponse: async (
    c: AppContext,
    improvedResponse: ImprovedResponse,
  ): Promise<ImprovedResponse> => {
    const rows = await insertInto(
      getLibsqlClient(c),
      'improved_responses',
      {
        ...withId(improvedResponse),
        original_response_body: toJsonColumn(
          improvedResponse.original_response_body,
        ),
        improved_response_body: toJsonColumn(
          improvedResponse.improved_response_body,
        ),
      },
      z.array(ImprovedResponseSchema),
    );
    return rows[0];
  },

  updateImprovedResponse: async (
    c: AppContext,
    id: string,
    update: ImprovedResponseUpdateParams,
  ): Promise<ImprovedResponse> => {
    const rows = await updateIn(
      getLibsqlClient(c),
      'improved_responses',
      { id },
      {
        improved_response_body:
          update.improved_response_body === undefined
            ? undefined
            : toJsonColumn(update.improved_response_body),
      },
      z.array(ImprovedResponseSchema),
    );
    return rows[0];
  },

  deleteImprovedResponse: async (c: AppContext, id: string): Promise<void> => {
    await deleteFrom(getLibsqlClient(c), 'improved_responses', { id });
  },

  // --------------------------------------------------------------- Agents
  getAgents: async (
    c: AppContext,
    queryParams: AgentQueryParams,
  ): Promise<Agent[]> =>
    selectFrom(
      getLibsqlClient(c),
      'agents',
      { id: queryParams.id, name: queryParams.name },
      z.array(AgentSchema),
      { limit: queryParams.limit, offset: queryParams.offset },
    ),

  createAgent: async (
    c: AppContext,
    agent: AgentCreateParams,
  ): Promise<Agent> => {
    const { metadata, ...rest } = agent as AgentCreateParams &
      Record<string, unknown>;

    const rows = await insertInto(
      getLibsqlClient(c),
      'agents',
      {
        ...asColumns(rest),
        id: uuidv4(),
        metadata: toJsonColumn(metadata ?? {}),
      },
      z.array(AgentSchema),
    );
    return rows[0];
  },

  updateAgent: async (
    c: AppContext,
    id: string,
    update: AgentUpdateParams,
  ): Promise<Agent> => {
    const client = getLibsqlClient(c);
    const { description, metadata, options, ...rest } =
      update as AgentUpdateParams & Record<string, unknown>;

    // The options patch is merged over what is stored, so a caller that
    // changes one role's timeout does not have to send the rest.
    let merged: AgentOptions | undefined;
    if (options !== undefined) {
      const current = await selectFrom(
        client,
        'agents',
        { id },
        z.array(AgentSchema),
      );
      if (current.length === 0) {
        throw new Error(`Agent ${id} not found`);
      }
      merged = mergeAgentOptions(
        current[0].options,
        options as AgentOptionsUpdate,
      );
    }

    const rows = await updateIn(
      client,
      'agents',
      { id },
      {
        ...asColumns(rest),
        // Nullable in the params but NOT NULL in the table: null means "leave it".
        description: description ?? undefined,
        metadata: metadata === undefined ? undefined : toJsonColumn(metadata),
        options: merged === undefined ? undefined : toJsonColumn(merged),
      },
      z.array(AgentSchema),
    );
    return rows[0];
  },

  deleteAgent: async (c: AppContext, id: string): Promise<void> => {
    await deleteFrom(getLibsqlClient(c), 'agents', { id });
  },

  // --------------------------------------------------------------- Skills
  getSkills: async (
    c: AppContext,
    queryParams: SkillQueryParams,
  ): Promise<Skill[]> =>
    selectFrom(
      getLibsqlClient(c),
      'skills',
      {
        id: queryParams.id,
        agent_id: queryParams.agent_id,
        name: queryParams.name,
      },
      z.array(SkillSchema),
      { limit: queryParams.limit, offset: queryParams.offset },
    ),

  createSkill: async (
    c: AppContext,
    skill: SkillCreateParams,
  ): Promise<Skill> => {
    const { metadata, allowed_template_variables, optimize, ...rest } =
      skill as SkillCreateParams & Record<string, unknown>;

    const rows = await insertInto(
      getLibsqlClient(c),
      'skills',
      {
        ...asColumns(rest),
        id: uuidv4(),
        metadata: toJsonColumn(metadata ?? {}),
        allowed_template_variables: toJsonColumn(
          allowed_template_variables ?? [],
        ),
        optimize: optimize === undefined ? undefined : optimize ? 1 : 0,
      },
      z.array(SkillSchema),
    );
    return rows[0];
  },

  updateSkill: async (
    c: AppContext,
    id: string,
    update: SkillUpdateParams,
  ): Promise<Skill> => {
    const { metadata, allowed_template_variables, optimize, ...rest } =
      update as SkillUpdateParams & Record<string, unknown>;

    const rows = await updateIn(
      getLibsqlClient(c),
      'skills',
      { id },
      {
        ...asColumns(rest),
        metadata: metadata === undefined ? undefined : toJsonColumn(metadata),
        allowed_template_variables:
          allowed_template_variables === undefined
            ? undefined
            : toJsonColumn(allowed_template_variables),
        optimize: optimize === undefined ? undefined : optimize ? 1 : 0,
      },
      z.array(SkillSchema),
    );
    return rows[0];
  },

  deleteSkill: async (c: AppContext, id: string): Promise<void> => {
    await deleteFrom(getLibsqlClient(c), 'skills', { id });
  },

  /** Replaces the `increment_skill_total_requests` RPC. */
  incrementSkillTotalRequests: async (
    c: AppContext,
    skillId: string,
  ): Promise<Skill> => {
    const client = getLibsqlClient(c);
    await client.execute({
      sql: 'UPDATE skills SET total_requests = total_requests + 1 WHERE id = ?',
      args: [skillId],
    });
    const rows = await selectFrom(
      client,
      'skills',
      { id: skillId },
      z.array(SkillSchema),
    );
    return rows[0];
  },

  /**
   * Replaces the `try_acquire_reclustering_lock` RPC.
   *
   * The conditional UPDATE is what makes this a lock: two callers racing both
   * issue it, SQLite serialises them, and only the one that finds
   * `last_clustering_at` still stale changes a row.
   */
  tryAcquireReclusteringLock: async (
    c: AppContext,
    skillId: string,
    lockThresholdMs: number,
  ): Promise<Skill | null> => {
    const client = getLibsqlClient(c);
    const now = new Date();
    const cutoff = new Date(now.getTime() - lockThresholdMs).toISOString();

    const result = await client.execute({
      sql: `UPDATE skills SET last_clustering_at = ?
            WHERE id = ?
              AND (last_clustering_at IS NULL OR last_clustering_at < ?)`,
      args: [now.toISOString(), skillId, cutoff],
    });

    if (result.rowsAffected === 0) {
      return null;
    }

    const rows = await selectFrom(
      client,
      'skills',
      { id: skillId },
      z.array(SkillSchema),
    );
    return rows[0] ?? null;
  },

  // ---------------------------------------------------------------- Tools
  getTools: async (
    c: AppContext,
    queryParams: ToolQueryParams,
  ): Promise<Tool[]> =>
    selectFrom(
      getLibsqlClient(c),
      'tools',
      {
        id: queryParams.id,
        agent_id: queryParams.agent_id,
        hash: queryParams.hash,
        type: queryParams.type,
        name: queryParams.name,
      },
      z.array(ToolSchema),
      { limit: queryParams.limit, offset: queryParams.offset },
    ),

  createTool: async (c: AppContext, tool: ToolCreateParams): Promise<Tool> => {
    const rows = await insertInto(
      getLibsqlClient(c),
      'tools',
      {
        ...withId(tool as ToolCreateParams & { id?: string }),
        raw_data: toJsonColumn(tool.raw_data),
      },
      z.array(ToolSchema),
    );
    return rows[0];
  },

  deleteTool: async (c: AppContext, id: string): Promise<void> => {
    await deleteFrom(getLibsqlClient(c), 'tools', { id });
  },

  // ------------------------------------------------- AI Provider API Keys
  getAIProviderAPIKeys: async (
    c: AppContext,
    queryParams: AIProviderConfigQueryParams,
  ): Promise<AIProviderConfig[]> => {
    const rows = await selectFrom(
      getLibsqlClient(c),
      'ai_providers',
      {
        id: queryParams.id,
        ai_provider: queryParams.ai_provider,
        name: queryParams.name,
      },
      z.array(AIProviderConfigSchema),
      { limit: queryParams.limit, offset: queryParams.offset },
    );

    return rows.map((row) => ({
      ...row,
      api_key: row.api_key ? decryptAPIKey(c, row.api_key) : null,
    }));
  },

  getAIProviderAPIKeyById: async (
    c: AppContext,
    id: string,
  ): Promise<AIProviderConfig | null> => {
    const rows = await selectFrom(
      getLibsqlClient(c),
      'ai_providers',
      { id },
      z.array(AIProviderConfigSchema),
    );

    if (rows.length === 0) {
      return null;
    }

    return {
      ...rows[0],
      api_key: rows[0].api_key ? decryptAPIKey(c, rows[0].api_key) : null,
    };
  },

  createAIProvider: async (
    c: AppContext,
    apiKey: AIProviderConfigCreateParams,
  ): Promise<AIProviderConfig> => {
    const rows = await insertInto(
      getLibsqlClient(c),
      'ai_providers',
      {
        id: uuidv4(),
        ai_provider: apiKey.ai_provider,
        name: apiKey.name,
        api_key: apiKey.api_key ? encryptAPIKey(c, apiKey.api_key) : null,
        custom_fields: toJsonColumn(apiKey.custom_fields ?? {}),
      },
      z.array(AIProviderConfigSchema),
    );

    return {
      ...rows[0],
      api_key: rows[0].api_key ? decryptAPIKey(c, rows[0].api_key) : null,
    };
  },

  updateAIProvider: async (
    c: AppContext,
    id: string,
    update: AIProviderConfigUpdateParams,
  ): Promise<AIProviderConfig> => {
    const rows = await updateIn(
      getLibsqlClient(c),
      'ai_providers',
      { id },
      {
        ai_provider: update.ai_provider,
        name: update.name,
        api_key:
          update.api_key === undefined
            ? undefined
            : update.api_key
              ? encryptAPIKey(c, update.api_key)
              : null,
        custom_fields:
          update.custom_fields === undefined
            ? undefined
            : toJsonColumn(update.custom_fields),
      },
      z.array(AIProviderConfigSchema),
    );

    return {
      ...rows[0],
      api_key: rows[0].api_key ? decryptAPIKey(c, rows[0].api_key) : null,
    };
  },

  deleteAIProvider: async (c: AppContext, id: string): Promise<void> => {
    await deleteFrom(getLibsqlClient(c), 'ai_providers', { id });
  },

  // --------------------------------------------------------------- Models
  getModels: async (
    c: AppContext,
    queryParams: ModelQueryParams,
  ): Promise<Model[]> =>
    selectFrom(
      getLibsqlClient(c),
      'models',
      {
        id: queryParams.id,
        ai_provider_id: queryParams.ai_provider_id,
        model_name: queryParams.model_name,
      },
      z.array(ModelSchema),
      { limit: queryParams.limit, offset: queryParams.offset },
    ),

  createModel: async (
    c: AppContext,
    model: ModelCreateParams,
  ): Promise<Model> => {
    const rows = await insertInto(
      getLibsqlClient(c),
      'models',
      withId(model as ModelCreateParams & { id?: string }),
      z.array(ModelSchema),
    );
    return rows[0];
  },

  updateModel: async (
    c: AppContext,
    id: string,
    update: ModelUpdateParams,
  ): Promise<Model> => {
    const rows = await updateIn(
      getLibsqlClient(c),
      'models',
      { id },
      asColumns(update),
      z.array(ModelSchema),
    );
    return rows[0];
  },

  deleteModel: async (c: AppContext, id: string): Promise<void> => {
    await deleteFrom(getLibsqlClient(c), 'models', { id });
  },

  // --------------------------------------------- Skill-Model Relationships
  /** PostgREST expresses this as an embedded select; here it is a plain join. */
  getSkillModels: async (c: AppContext, skillId: string): Promise<Model[]> => {
    const result = await getLibsqlClient(c).execute({
      sql: `SELECT m.* FROM skill_models sm
            JOIN models m ON m.id = sm.model_id
            WHERE sm.skill_id = ?`,
      args: [skillId],
    });
    return parseRows('models', result.rows, z.array(ModelSchema));
  },

  getSkillsByModelId: async (
    c: AppContext,
    modelId: string,
  ): Promise<Skill[]> => {
    const result = await getLibsqlClient(c).execute({
      sql: `SELECT s.* FROM skill_models sm
            JOIN skills s ON s.id = sm.skill_id
            WHERE sm.model_id = ?`,
      args: [modelId],
    });
    return parseRows('skills', result.rows, z.array(SkillSchema));
  },

  addModelsToSkill: async (
    c: AppContext,
    skillId: string,
    modelIds: string[],
  ): Promise<void> => {
    if (modelIds.length === 0) {
      return;
    }

    await getLibsqlClient(c).batch(
      modelIds.map((modelId) => ({
        sql: 'INSERT OR IGNORE INTO skill_models (skill_id, model_id) VALUES (?, ?)',
        args: [skillId, modelId],
      })),
      'write',
    );
  },

  removeModelsFromSkill: async (
    c: AppContext,
    skillId: string,
    modelIds: string[],
  ): Promise<void> => {
    if (modelIds.length === 0) {
      return;
    }

    await getLibsqlClient(c).batch(
      modelIds.map((modelId) => ({
        sql: 'DELETE FROM skill_models WHERE skill_id = ? AND model_id = ?',
        args: [skillId, modelId],
      })),
      'write',
    );
  },

  // ---------------------------------------------------------- Agent models
  getAgentModels: async (c: AppContext, agentId: string): Promise<Model[]> => {
    const result = await getLibsqlClient(c).execute({
      sql: `SELECT m.* FROM agent_models am
            JOIN models m ON m.id = am.model_id
            WHERE am.agent_id = ?`,
      args: [agentId],
    });
    return parseRows('models', result.rows, z.array(ModelSchema));
  },

  addModelsToAgent: async (
    c: AppContext,
    agentId: string,
    modelIds: string[],
  ): Promise<void> => {
    if (modelIds.length === 0) {
      return;
    }

    await getLibsqlClient(c).batch(
      modelIds.map((modelId) => ({
        sql: 'INSERT OR IGNORE INTO agent_models (agent_id, model_id) VALUES (?, ?)',
        args: [agentId, modelId],
      })),
      'write',
    );
  },

  removeModelsFromAgent: async (
    c: AppContext,
    agentId: string,
    modelIds: string[],
  ): Promise<void> => {
    if (modelIds.length === 0) {
      return;
    }

    await getLibsqlClient(c).batch(
      modelIds.map((modelId) => ({
        sql: 'DELETE FROM agent_models WHERE agent_id = ? AND model_id = ?',
        args: [agentId, modelId],
      })),
      'write',
    );
  },

  // ------------------------------------------ Skill Optimization Clusters
  getSkillOptimizationClusters: async (
    c: AppContext,
    queryParams: SkillOptimizationClusterQueryParams,
  ): Promise<SkillOptimizationCluster[]> =>
    selectFrom(
      getLibsqlClient(c),
      'skill_optimization_clusters',
      {
        id: queryParams.id,
        agent_id: queryParams.agent_id,
        skill_id: queryParams.skill_id,
      },
      z.array(SkillOptimizationClusterSchema),
      {
        orderBy: 'name asc',
        limit: queryParams.limit,
        offset: queryParams.offset,
      },
    ),

  createSkillOptimizationClusters: async (
    c: AppContext,
    params_list: SkillOptimizationClusterCreateParams[],
  ): Promise<SkillOptimizationCluster[]> => {
    const client = getLibsqlClient(c);
    const created: SkillOptimizationCluster[] = [];

    for (const params of params_list) {
      const rows = await insertInto(
        client,
        'skill_optimization_clusters',
        {
          ...withId(
            params as SkillOptimizationClusterCreateParams & {
              id?: string;
            },
          ),
          centroid: toJsonColumn(params.centroid),
        },
        z.array(SkillOptimizationClusterSchema),
      );
      created.push(rows[0]);
    }

    return created;
  },

  updateSkillOptimizationCluster: async (
    c: AppContext,
    id: string,
    update: SkillOptimizationClusterUpdateParams,
  ): Promise<SkillOptimizationCluster> => {
    const { centroid, ...rest } =
      update as SkillOptimizationClusterUpdateParams & Record<string, unknown>;

    const rows = await updateIn(
      getLibsqlClient(c),
      'skill_optimization_clusters',
      { id },
      {
        ...asColumns(rest),
        centroid: centroid === undefined ? undefined : toJsonColumn(centroid),
      },
      z.array(SkillOptimizationClusterSchema),
    );
    return rows[0];
  },

  deleteSkillOptimizationCluster: async (
    c: AppContext,
    id: string,
  ): Promise<void> => {
    await deleteFrom(getLibsqlClient(c), 'skill_optimization_clusters', { id });
  },

  // -------------------------------------------------------- Skill routing
  getSkillRoutings: async (
    c: AppContext,
    queryParams: SkillRoutingQueryParams,
  ): Promise<SkillRouting[]> =>
    selectFrom(
      getLibsqlClient(c),
      'skill_routing',
      { agent_id: queryParams.agent_id, skill_id: queryParams.skill_id },
      z.array(SkillRoutingSchema),
    ),

  upsertSkillRouting: async (
    c: AppContext,
    params: SkillRoutingUpsertParams,
  ): Promise<SkillRouting> => {
    const client = getLibsqlClient(c);
    // ON CONFLICT rather than read-then-write: two requests can seed the same
    // skill at once, and the later mean simply wins. `updated_at` is left to
    // the trigger, which fires for the DO UPDATE branch as well.
    await client.execute({
      sql: `INSERT INTO skill_routing
              (skill_id, agent_id, centroid, conversation_centroid,
               embedding_model_id, sample_count, conversation_sample_count)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(skill_id) DO UPDATE SET
              agent_id = excluded.agent_id,
              centroid = excluded.centroid,
              conversation_centroid = excluded.conversation_centroid,
              embedding_model_id = excluded.embedding_model_id,
              sample_count = excluded.sample_count,
              conversation_sample_count = excluded.conversation_sample_count`,
      args: [
        params.skill_id,
        params.agent_id,
        toJsonColumn(params.centroid),
        params.conversation_centroid === null
          ? null
          : toJsonColumn(params.conversation_centroid),
        params.embedding_model_id,
        params.sample_count,
        params.conversation_sample_count,
      ],
    });
    const rows = await selectFrom(
      client,
      'skill_routing',
      { skill_id: params.skill_id },
      z.array(SkillRoutingSchema),
    );
    return rows[0];
  },

  /** Replaces the `increment_cluster_counters` RPC. */
  claimSkillCreationLease: async (
    c: AppContext,
    agentId: string,
    holder: string,
    now: string,
    until: string,
  ): Promise<boolean> => {
    const client = getLibsqlClient(c);
    // Make sure the row exists, then take it only while nobody holds it. The
    // conditional UPDATE is what makes this a lock: two claimants racing both
    // issue it, SQLite serialises them, and only the one that still finds the
    // lease free changes a row.
    await client.execute({
      sql: `INSERT OR IGNORE INTO skill_creation_leases (agent_id, holder, lease_until)
            VALUES (?, NULL, NULL)`,
      args: [agentId],
    });
    const result = await client.execute({
      sql: `UPDATE skill_creation_leases SET holder = ?, lease_until = ?
            WHERE agent_id = ?
              AND (lease_until IS NULL OR lease_until < ?)`,
      args: [holder, until, agentId, now],
    });
    return result.rowsAffected === 1;
  },

  releaseSkillCreationLease: async (
    c: AppContext,
    agentId: string,
    holder: string,
  ): Promise<void> => {
    await getLibsqlClient(c).execute({
      sql: `UPDATE skill_creation_leases SET holder = NULL, lease_until = NULL
            WHERE agent_id = ? AND holder = ?`,
      args: [agentId, holder],
    });
  },

  incrementClusterCounters: async (
    c: AppContext,
    clusterId: string,
  ): Promise<SkillOptimizationCluster> => {
    const client = getLibsqlClient(c);
    await client.execute({
      sql: `UPDATE skill_optimization_clusters
            SET total_steps = total_steps + 1,
                observability_total_requests = observability_total_requests + 1
            WHERE id = ?`,
      args: [clusterId],
    });
    const rows = await selectFrom(
      client,
      'skill_optimization_clusters',
      { id: clusterId },
      z.array(SkillOptimizationClusterSchema),
    );
    return rows[0];
  },

  // ---------------------------------------------- Skill Optimization Arms
  getSkillOptimizationArms: async (
    c: AppContext,
    queryParams: SkillOptimizationArmQueryParams,
  ): Promise<SkillOptimizationArm[]> =>
    selectFrom(
      getLibsqlClient(c),
      'skill_optimization_arms',
      {
        id: queryParams.id,
        agent_id: queryParams.agent_id,
        skill_id: queryParams.skill_id,
        cluster_id: queryParams.cluster_id,
      },
      z.array(SkillOptimizationArmSchema),
      {
        orderBy: 'created_at desc',
        limit: queryParams.limit,
        offset: queryParams.offset,
      },
    ),

  createSkillOptimizationArms: async (
    c: AppContext,
    params_list: SkillOptimizationArmCreateParams[],
  ): Promise<SkillOptimizationArm[]> => {
    const client = getLibsqlClient(c);
    const created: SkillOptimizationArm[] = [];

    for (const params of params_list) {
      const rows = await insertInto(
        client,
        'skill_optimization_arms',
        {
          ...withId(
            params as SkillOptimizationArmCreateParams & {
              id?: string;
            },
          ),
          params: toJsonColumn(params.params),
        },
        z.array(SkillOptimizationArmSchema),
      );
      created.push(rows[0]);
    }

    return created;
  },

  updateSkillOptimizationArm: async (
    c: AppContext,
    id: string,
    update: SkillOptimizationArmUpdateParams,
  ): Promise<SkillOptimizationArm> => {
    const { params, ...rest } = update as SkillOptimizationArmUpdateParams &
      Record<string, unknown>;

    const rows = await updateIn(
      getLibsqlClient(c),
      'skill_optimization_arms',
      { id },
      {
        ...asColumns(rest),
        params: params === undefined ? undefined : toJsonColumn(params),
      },
      z.array(SkillOptimizationArmSchema),
    );
    return rows[0];
  },

  /**
   * Replaces the `update_arm_and_increment_counters` RPC.
   *
   * This is the one operation that genuinely needs a transaction rather than a
   * batch: the arm stats, the cluster counters and the skill counter have to
   * move together, and the stat update is read-modify-write per evaluation.
   */
  updateArmAndIncrementCounters: async (
    c: AppContext,
    armId: string,
    evaluationResults: Array<{ evaluation_id: string; score: number }>,
  ): Promise<{
    arm: SkillOptimizationArm;
    cluster: SkillOptimizationCluster;
    skill: Skill;
  }> => {
    const client = getLibsqlClient(c);
    const tx = await client.transaction('write');

    try {
      const armRow = await tx.execute({
        sql: 'SELECT agent_id, skill_id, cluster_id FROM skill_optimization_arms WHERE id = ?',
        args: [armId],
      });

      if (armRow.rows.length === 0) {
        throw new Error(`Arm with id ${armId} not found`);
      }

      const agentId = String(armRow.rows[0].agent_id);
      const skillId = String(armRow.rows[0].skill_id);
      const clusterId = String(armRow.rows[0].cluster_id);

      for (const { evaluation_id, score } of evaluationResults) {
        const existing = await tx.execute({
          sql: 'SELECT n, total_reward, n2 FROM skill_optimization_arm_stats WHERE arm_id = ? AND evaluation_id = ?',
          args: [armId, evaluation_id],
        });

        const oldN = Number(existing.rows[0]?.n ?? 0);
        const oldTotal = Number(existing.rows[0]?.total_reward ?? 0);
        const oldN2 = Number(existing.rows[0]?.n2 ?? 0);

        // Incremental update formulas used by Thompson Sampling, matching the
        // plpgsql version exactly.
        const newN = oldN + 1;
        const newTotal = oldTotal + score;
        const newMean = newTotal / newN;
        const newN2 = oldN2 + score * score;

        await tx.execute({
          sql: `INSERT INTO skill_optimization_arm_stats
                  (arm_id, evaluation_id, agent_id, skill_id, cluster_id, n, mean, n2, total_reward)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (arm_id, evaluation_id) DO UPDATE SET
                  n = excluded.n,
                  mean = excluded.mean,
                  n2 = excluded.n2,
                  total_reward = excluded.total_reward,
                  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
          args: [
            armId,
            evaluation_id,
            agentId,
            skillId,
            clusterId,
            newN,
            newMean,
            newN2,
            newTotal,
          ],
        });
      }

      const clusterUpdate = await tx.execute({
        sql: `UPDATE skill_optimization_clusters
              SET total_steps = total_steps + 1,
                  observability_total_requests = observability_total_requests + 1
              WHERE id = ?`,
        args: [clusterId],
      });
      if (clusterUpdate.rowsAffected === 0) {
        throw new Error(`Cluster with id ${clusterId} not found`);
      }

      const skillUpdate = await tx.execute({
        sql: 'UPDATE skills SET total_requests = total_requests + 1 WHERE id = ?',
        args: [skillId],
      });
      if (skillUpdate.rowsAffected === 0) {
        throw new Error(`Skill with id ${skillId} not found`);
      }

      const [arm, cluster, skill] = await Promise.all([
        selectFrom(
          tx,
          'skill_optimization_arms',
          { id: armId },
          z.array(SkillOptimizationArmSchema),
        ),
        selectFrom(
          tx,
          'skill_optimization_clusters',
          { id: clusterId },
          z.array(SkillOptimizationClusterSchema),
        ),
        selectFrom(tx, 'skills', { id: skillId }, z.array(SkillSchema)),
      ]);

      await tx.commit();

      return { arm: arm[0], cluster: cluster[0], skill: skill[0] };
    } catch (e) {
      await tx.rollback();
      throw e;
    }
  },

  deleteSkillOptimizationArm: async (
    c: AppContext,
    id: string,
  ): Promise<void> => {
    await deleteFrom(getLibsqlClient(c), 'skill_optimization_arms', { id });
  },

  deleteSkillOptimizationArmsForSkill: async (
    c: AppContext,
    skillId: string,
  ): Promise<void> => {
    await deleteFrom(getLibsqlClient(c), 'skill_optimization_arms', {
      skill_id: skillId,
    });
  },

  deleteSkillOptimizationArmsForCluster: async (
    c: AppContext,
    clusterId: string,
  ): Promise<void> => {
    await deleteFrom(getLibsqlClient(c), 'skill_optimization_arms', {
      cluster_id: clusterId,
    });
  },

  // ----------------------------------------- Skill Optimization Arm Stats
  getSkillOptimizationArmStats: async (
    c: AppContext,
    queryParams: SkillOptimizationArmStatQueryParams,
  ): Promise<SkillOptimizationArmStat[]> =>
    selectFrom(
      getLibsqlClient(c),
      'skill_optimization_arm_stats',
      {
        arm_id: queryParams.arm_id,
        evaluation_id: queryParams.evaluation_id,
        agent_id: queryParams.agent_id,
        skill_id: queryParams.skill_id,
        cluster_id: queryParams.cluster_id,
      },
      z.array(SkillOptimizationArmStatSchema),
      {
        orderBy: 'created_at desc',
        limit: queryParams.limit,
        offset: queryParams.offset,
      },
    ),

  deleteSkillOptimizationArmStats: async (
    c: AppContext,
    queryParams: SkillOptimizationArmStatQueryParams,
  ): Promise<void> => {
    await deleteFrom(getLibsqlClient(c), 'skill_optimization_arm_stats', {
      arm_id: queryParams.arm_id,
      evaluation_id: queryParams.evaluation_id,
      agent_id: queryParams.agent_id,
      skill_id: queryParams.skill_id,
      cluster_id: queryParams.cluster_id,
    });
  },

  // --------------------------------------- Skill Optimization Evaluations
  getSkillOptimizationEvaluations: async (
    c: AppContext,
    queryParams: SkillOptimizationEvaluationQueryParams,
  ): Promise<SkillOptimizationEvaluation[]> =>
    selectFrom(
      getLibsqlClient(c),
      'skill_optimization_evaluations',
      {
        id: queryParams.id,
        agent_id: queryParams.agent_id,
        skill_id: queryParams.skill_id,
        evaluation_method: queryParams.evaluation_method,
      },
      z.array(SkillOptimizationEvaluationSchema),
      {
        orderBy: 'created_at desc',
        limit: queryParams.limit,
        offset: queryParams.offset,
      },
    ),

  createSkillOptimizationEvaluations: async (
    c: AppContext,
    params_list: SkillOptimizationEvaluationCreateParams[],
  ): Promise<SkillOptimizationEvaluation[]> => {
    const client = getLibsqlClient(c);
    const created: SkillOptimizationEvaluation[] = [];

    for (const params of params_list) {
      const rows = await insertInto(
        client,
        'skill_optimization_evaluations',
        {
          ...withId(
            params as SkillOptimizationEvaluationCreateParams & {
              id?: string;
            },
          ),
          params: toJsonColumn(params.params ?? {}),
        },
        z.array(SkillOptimizationEvaluationSchema),
      );
      created.push(rows[0]);
    }

    return created;
  },

  updateSkillOptimizationEvaluation: async (
    c: AppContext,
    id: string,
    update: SkillOptimizationEvaluationUpdateParams,
  ): Promise<SkillOptimizationEvaluation> => {
    const { params, ...rest } =
      update as SkillOptimizationEvaluationUpdateParams &
        Record<string, unknown>;

    const rows = await updateIn(
      getLibsqlClient(c),
      'skill_optimization_evaluations',
      { id },
      {
        ...asColumns(rest),
        params: params === undefined ? undefined : toJsonColumn(params),
      },
      z.array(SkillOptimizationEvaluationSchema),
    );

    if (rows.length === 0) {
      throw new Error('Evaluation not found');
    }

    return rows[0];
  },

  deleteSkillOptimizationEvaluation: async (
    c: AppContext,
    id: string,
  ): Promise<void> => {
    await deleteFrom(getLibsqlClient(c), 'skill_optimization_evaluations', {
      id,
    });
  },

  deleteSkillOptimizationEvaluationsForSkill: async (
    c: AppContext,
    skillId: string,
  ): Promise<void> => {
    await deleteFrom(getLibsqlClient(c), 'skill_optimization_evaluations', {
      skill_id: skillId,
    });
  },

  // ----------------------------------- Skill Optimization Evaluation Runs
  getSkillOptimizationEvaluationRuns: async (
    c: AppContext,
    queryParams: SkillOptimizationEvaluationRunQueryParams,
  ): Promise<SkillOptimizationEvaluationRun[]> =>
    selectFrom(
      getLibsqlClient(c),
      'skill_optimization_evaluation_runs',
      {
        id: queryParams.id,
        agent_id: queryParams.agent_id,
        skill_id: queryParams.skill_id,
        log_id: queryParams.log_id,
      },
      z.array(SkillOptimizationEvaluationRunSchema),
      {
        orderBy: 'created_at desc',
        limit: queryParams.limit,
        offset: queryParams.offset,
      },
    ),

  createSkillOptimizationEvaluationRun: async (
    c: AppContext,
    params: SkillOptimizationEvaluationRunCreateParams,
  ): Promise<SkillOptimizationEvaluationRun> => {
    const rows = await insertInto(
      getLibsqlClient(c),
      'skill_optimization_evaluation_runs',
      {
        ...withId(
          params as SkillOptimizationEvaluationRunCreateParams & {
            id?: string;
          },
        ),
        results: toJsonColumn(params.results),
      },
      z.array(SkillOptimizationEvaluationRunSchema),
    );
    return rows[0];
  },

  deleteSkillOptimizationEvaluationRun: async (
    c: AppContext,
    id: string,
  ): Promise<void> => {
    await deleteFrom(getLibsqlClient(c), 'skill_optimization_evaluation_runs', {
      id,
    });
  },

  getEvaluationScoresByTimeBucket: async (
    c: AppContext,
    params: EvaluationScoresByTimeBucketParams,
  ) => aggregateScoresByTimeBucket(getLibsqlClient(c), params),

  // --------------------------------------------------------- Skill Events
  getSkillEvents: async (
    c: AppContext,
    queryParams: SkillEventQueryParams,
  ): Promise<SkillEvent[]> =>
    selectFrom(
      getLibsqlClient(c),
      'skill_events',
      {
        id: queryParams.id,
        agent_id: queryParams.agent_id,
        skill_id: queryParams.skill_id,
        cluster_id: queryParams.cluster_id,
        event_type: queryParams.event_type,
      },
      z.array(SkillEventSchema),
      {
        orderBy: 'created_at desc',
        limit: queryParams.limit,
        offset: queryParams.offset,
      },
    ),

  createSkillEvent: async (
    c: AppContext,
    params: SkillEventCreateParams,
  ): Promise<SkillEvent> => {
    const rows = await insertInto(
      getLibsqlClient(c),
      'skill_events',
      {
        ...withId(params as SkillEventCreateParams & { id?: string }),
        metadata: toJsonColumn(params.metadata ?? {}),
      },
      z.array(SkillEventSchema),
    );

    emitSSEEvent('skill-optimization:event-created', {
      eventId: rows[0].id,
      skillId: rows[0].skill_id,
      clusterId: rows[0].cluster_id,
      eventType: rows[0].event_type,
    });

    return rows[0];
  },

  // ------------------------------------------------------- System Settings
  getSystemSettings: async (c: AppContext): Promise<SystemSettings> => {
    const rows = await selectFrom(
      getLibsqlClient(c),
      'system_settings',
      {},
      z.array(SystemSettingsSchema),
      { limit: 1 },
    );
    // Seeded by migration 0003, so there is always exactly one row.
    return rows[0];
  },

  updateSystemSettings: async (
    c: AppContext,
    update: SystemSettingsUpdateParams,
  ): Promise<SystemSettings> => {
    const client = getLibsqlClient(c);
    const current = await selectFrom(
      client,
      'system_settings',
      {},
      z.array(SystemSettingsSchema),
      { limit: 1 },
    );

    // The options patch is merged over what is stored, so a caller that
    // changes one timeout does not have to send the rest.
    const { options, ...rest } = update;
    const rows = await updateIn(
      client,
      'system_settings',
      { id: current[0].id },
      asColumns({
        ...rest,
        options:
          options === undefined
            ? undefined
            : mergeSystemSettingsOptions(current[0].options, options),
      }),
      z.array(SystemSettingsSchema),
    );
    return rows[0];
  },
};
