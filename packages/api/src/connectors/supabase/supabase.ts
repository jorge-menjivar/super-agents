import { CACHE_TTL_SECONDS } from '@api/constants';
import type {
  CacheStorageConnector,
  LogsStorageConnector,
  UserDataStorageConnector,
} from '@api/types/connector';
import type { AppContext } from '@api/types/hono';
import { decryptAPIKey, encryptAPIKey } from '@api/utils/api-key-encryption';
import { emitSSEEvent } from '@api/utils/sse-event-manager';
import {
  Agent,
  type AgentCreateParams,
  type AgentOptions,
  type AgentQueryParams,
  type AgentUpdateParams,
  mergeAgentOptions,
} from '@shared/types/data/agent';
import {
  AIProviderConfig,
  type AIProviderConfigCreateParams,
  type AIProviderConfigQueryParams,
  type AIProviderConfigUpdateParams,
} from '@shared/types/data/ai-provider';
import {
  Feedback,
  type FeedbackQueryParams,
} from '@shared/types/data/feedback';
import {
  ImprovedResponse,
  type ImprovedResponseQueryParams,
  type ImprovedResponseUpdateParams,
} from '@shared/types/data/improved-response';
import {
  Log,
  type LogCreateParams,
  type LogFailParams,
  type LogStartParams,
  type LogsQueryParams,
} from '@shared/types/data/log';
import {
  Model,
  type ModelCreateParams,
  type ModelQueryParams,
  type ModelUpdateParams,
} from '@shared/types/data/model';
import type { SkillQueryParams } from '@shared/types/data/skill';
import {
  Skill,
  type SkillCreateParams,
  type SkillUpdateParams,
} from '@shared/types/data/skill';
import {
  SkillEvent,
  SkillEventCreateParams,
  type SkillEventQueryParams,
} from '@shared/types/data/skill-event';
import {
  SkillOptimizationArm,
  type SkillOptimizationArmCreateParams,
  type SkillOptimizationArmQueryParams,
  type SkillOptimizationArmUpdateParams,
} from '@shared/types/data/skill-optimization-arm';
import {
  SkillOptimizationCluster,
  type SkillOptimizationClusterCreateParams,
  type SkillOptimizationClusterQueryParams,
  type SkillOptimizationClusterUpdateParams,
} from '@shared/types/data/skill-optimization-cluster';
import {
  SkillOptimizationEvaluation,
  type SkillOptimizationEvaluationQueryParams,
} from '@shared/types/data/skill-optimization-evaluation';
import {
  SkillOptimizationEvaluationRun,
  type SkillOptimizationEvaluationRunCreateParams,
  type SkillOptimizationEvaluationRunQueryParams,
} from '@shared/types/data/skill-optimization-evaluation-run';
import {
  SkillRouting,
  type SkillRoutingQueryParams,
  type SkillRoutingUpsertParams,
} from '@shared/types/data/skill-routing';
import {
  mergeSystemSettingsOptions,
  SystemSettings,
  type SystemSettingsUpdateParams,
} from '@shared/types/data/system-settings';
import {
  Tool,
  type ToolCreateParams,
  type ToolQueryParams,
} from '@shared/types/data/tool';
import { CachedValue } from '@shared/types/middleware/cache';
import { z } from 'zod';
import {
  deleteFromSupabase,
  insertIntoSupabase,
  patchInSupabase,
  rpcFunctionWithResponse,
  selectFromSupabase,
  updateInSupabase,
} from './base';

export const supabaseUserDataStorageConnector: UserDataStorageConnector = {
  getFeedback: async (
    c: AppContext,
    queryParams: FeedbackQueryParams,
  ): Promise<Feedback[]> => {
    const postgrestParams: Record<string, string> = {};

    if (queryParams.id) {
      postgrestParams.id = `eq.${queryParams.id}`;
    }

    if (queryParams.log_id) {
      postgrestParams.log_id = `eq.${queryParams.log_id}`;
    }

    if (queryParams.limit) {
      postgrestParams.limit = queryParams.limit.toString();
    }

    if (queryParams.offset) {
      postgrestParams.offset = queryParams.offset.toString();
    }

    const feedbacks = await selectFromSupabase(
      c,
      'feedbacks',
      postgrestParams,
      z.array(Feedback),
    );
    return feedbacks;
  },
  createFeedback: async (
    c: AppContext,
    feedback: Feedback,
  ): Promise<Feedback> => {
    const insertedFeedback = await insertIntoSupabase(
      c,
      'feedbacks',
      feedback,
      z.array(Feedback),
    );
    return insertedFeedback[0];
  },
  deleteFeedback: async (c: AppContext, id: string): Promise<void> => {
    await deleteFromSupabase(c, 'feedbacks', { id: `eq.${id}` });
  },

  getImprovedResponse: async (
    c: AppContext,
    params: ImprovedResponseQueryParams,
  ): Promise<ImprovedResponse[]> => {
    const postgrestParams: Record<string, string> = {};

    if (params.id) {
      postgrestParams.id = `eq.${params.id}`;
    }

    if (params.agent_id) {
      postgrestParams.agent_id = `eq.${params.agent_id}`;
    }

    if (params.skill_id) {
      postgrestParams.skill_id = `eq.${params.skill_id}`;
    }

    if (params.log_id) {
      postgrestParams.log_id = `eq.${params.log_id}`;
    }

    const responses = await selectFromSupabase(
      c,
      'improved_responses',
      postgrestParams,
      z.array(ImprovedResponse),
    );

    return responses;
  },

  createImprovedResponse: async (
    c: AppContext,
    improvedResponse: ImprovedResponse,
  ): Promise<ImprovedResponse> => {
    const insertedResponse = await insertIntoSupabase(
      c,
      'improved_responses',
      improvedResponse,
      z.array(ImprovedResponse),
    );

    return insertedResponse[0];
  },

  updateImprovedResponse: async (
    c: AppContext,
    id: string,
    update: ImprovedResponseUpdateParams,
  ): Promise<ImprovedResponse> => {
    const updatedResponse = await updateInSupabase(
      c,
      'improved_responses',
      id,
      update,
      z.array(ImprovedResponse),
    );

    return updatedResponse[0];
  },

  deleteImprovedResponse: async (c: AppContext, id: string): Promise<void> => {
    await deleteFromSupabase(c, 'improved_responses', { id: `eq.${id}` });
  },

  getAgents: async (
    c: AppContext,
    queryParams: AgentQueryParams,
  ): Promise<Agent[]> => {
    const postgrestParams: Record<string, string> = {};

    if (queryParams.id) {
      postgrestParams.id = `eq.${queryParams.id}`;
    }
    if (queryParams.name) {
      postgrestParams.name = `eq.${queryParams.name}`;
    }
    if (queryParams.limit) {
      postgrestParams.limit = queryParams.limit.toString();
    }
    if (queryParams.offset) {
      postgrestParams.offset = queryParams.offset.toString();
    }

    const agents = await selectFromSupabase(
      c,
      'agents',
      postgrestParams,
      z.array(Agent),
    );

    return agents;
  },

  createAgent: async (c, agent: AgentCreateParams): Promise<Agent> => {
    const insertedAgent = await insertIntoSupabase(
      c,
      'agents',
      agent,
      z.array(Agent),
    );
    return insertedAgent[0];
  },

  updateAgent: async (
    c: AppContext,
    id: string,
    update: AgentUpdateParams,
  ): Promise<Agent> => {
    // The options patch is merged over what is stored, so a caller that
    // changes one role's timeout does not have to send the rest.
    const { options, ...rest } = update;
    let merged: AgentOptions | undefined;
    if (options) {
      const current = await selectFromSupabase(
        c,
        'agents',
        { id: `eq.${id}` },
        z.array(Agent),
      );
      if (current.length === 0) {
        throw new Error(`Agent ${id} not found`);
      }
      merged = mergeAgentOptions(current[0].options, options);
    }

    const updatedAgent = await updateInSupabase(
      c,
      'agents',
      id,
      { ...rest, ...(merged && { options: merged }) },
      z.array(Agent),
    );
    return updatedAgent[0];
  },

  deleteAgent: async (c: AppContext, id: string): Promise<void> => {
    await deleteFromSupabase(c, 'agents', { id: `eq.${id}` });
  },

  getSkills: async (
    c: AppContext,
    queryParams: SkillQueryParams,
  ): Promise<Skill[]> => {
    const postgrestParams: Record<string, string> = {};

    if (queryParams.id) {
      postgrestParams.id = `eq.${queryParams.id}`;
    }
    if (queryParams.agent_id) {
      postgrestParams.agent_id = `eq.${queryParams.agent_id}`;
    }
    if (queryParams.name) {
      postgrestParams.name = `eq.${queryParams.name}`;
    }
    if (queryParams.limit) {
      postgrestParams.limit = queryParams.limit.toString();
    }
    if (queryParams.offset) {
      postgrestParams.offset = queryParams.offset.toString();
    }

    const skills = await selectFromSupabase(
      c,
      'skills',
      postgrestParams,
      z.array(Skill),
    );

    return skills;
  },

  createSkill: async (
    c: AppContext,
    skill: SkillCreateParams,
  ): Promise<Skill> => {
    const insertedSkill = await insertIntoSupabase(
      c,
      'skills',
      skill,
      z.array(Skill),
    );
    return insertedSkill[0];
  },

  updateSkill: async (
    c: AppContext,
    id: string,
    update: SkillUpdateParams,
  ): Promise<Skill> => {
    const updatedSkill = await updateInSupabase(
      c,
      'skills',
      id,
      update,
      z.array(Skill),
    );
    return updatedSkill[0];
  },

  deleteSkill: async (c: AppContext, id: string): Promise<void> => {
    await deleteFromSupabase(c, 'skills', { id: `eq.${id}` });
  },

  incrementSkillTotalRequests: async (
    c: AppContext,
    skillId: string,
  ): Promise<Skill> => {
    const result = await rpcFunctionWithResponse(
      c,
      'increment_skill_total_requests',
      { p_skill_id: skillId },
      z.array(Skill),
    );
    return result[0];
  },

  tryAcquireReclusteringLock: async (
    c: AppContext,
    skillId: string,
    lockThresholdMs: number,
  ): Promise<Skill | null> => {
    const result = await rpcFunctionWithResponse(
      c,
      'try_acquire_reclustering_lock',
      { p_skill_id: skillId, p_lock_timeout_ms: lockThresholdMs },
      z.array(Skill),
    );
    return result.length > 0 ? result[0] : null;
  },

  getTools: async (
    c: AppContext,
    queryParams: ToolQueryParams,
  ): Promise<Tool[]> => {
    const postgrestParams: Record<string, string> = {};

    if (queryParams.id) {
      postgrestParams.id = `eq.${queryParams.id}`;
    }
    if (queryParams.agent_id) {
      postgrestParams.agent_id = `eq.${queryParams.agent_id}`;
    }
    if (queryParams.hash) {
      postgrestParams.hash = `eq.${queryParams.hash}`;
    }
    if (queryParams.type) {
      postgrestParams.type = `eq.${queryParams.type}`;
    }
    if (queryParams.name) {
      postgrestParams.name = `eq.${queryParams.name}`;
    }
    if (queryParams.limit) {
      postgrestParams.limit = queryParams.limit.toString();
    }
    if (queryParams.offset) {
      postgrestParams.offset = queryParams.offset.toString();
    }

    const tools = await selectFromSupabase(
      c,
      'tools',
      postgrestParams,
      z.array(Tool),
    );

    return tools;
  },

  createTool: async (c: AppContext, tool: ToolCreateParams): Promise<Tool> => {
    const insertedTool = await insertIntoSupabase(
      c,
      'tools',
      tool,
      z.array(Tool),
    );
    return insertedTool[0];
  },

  deleteTool: async (c: AppContext, id: string): Promise<void> => {
    await deleteFromSupabase(c, 'tools', { id: `eq.${id}` });
  },

  // AI Provider API Keys
  getAIProviderAPIKeys: async (
    c: AppContext,
    queryParams: AIProviderConfigQueryParams,
  ): Promise<AIProviderConfig[]> => {
    const postgrestParams: Record<string, string> = {};

    if (queryParams.id) {
      postgrestParams.id = `eq.${queryParams.id}`;
    }
    if (queryParams.ai_provider) {
      postgrestParams.ai_provider = `eq.${queryParams.ai_provider}`;
    }
    if (queryParams.name) {
      postgrestParams.name = `eq.${queryParams.name}`;
    }
    if (queryParams.limit) {
      postgrestParams.limit = queryParams.limit.toString();
    }
    if (queryParams.offset) {
      postgrestParams.offset = queryParams.offset.toString();
    }

    const encryptedAPIKeys = await selectFromSupabase(
      c,
      'ai_providers',
      postgrestParams,
      z.array(AIProviderConfig),
    );

    // Decrypt the API keys before returning
    return encryptedAPIKeys.map((key) => ({
      ...key,
      api_key: key.api_key ? decryptAPIKey(c, key.api_key) : null,
    }));
  },

  getAIProviderAPIKeyById: async (
    c: AppContext,
    id: string,
  ): Promise<AIProviderConfig | null> => {
    const encryptedAPIKeys = await selectFromSupabase(
      c,
      'ai_providers',
      { id: `eq.${id}` },
      z.array(AIProviderConfig),
    );

    if (encryptedAPIKeys.length === 0) {
      return null;
    }

    // Decrypt the API key before returning
    const encryptedKey = encryptedAPIKeys[0];
    return {
      ...encryptedKey,
      api_key: encryptedKey.api_key
        ? decryptAPIKey(c, encryptedKey.api_key)
        : null,
    };
  },

  createAIProvider: async (
    c: AppContext,
    apiKey: AIProviderConfigCreateParams,
  ): Promise<AIProviderConfig> => {
    const encryptedAPIKey = {
      ...apiKey,
      api_key: apiKey.api_key ? encryptAPIKey(c, apiKey.api_key) : null,
    };

    const insertedAPIKey = await insertIntoSupabase(
      c,
      'ai_providers',
      encryptedAPIKey,
      z.array(AIProviderConfig),
    );

    // Decrypt before returning
    return {
      ...insertedAPIKey[0],
      api_key: insertedAPIKey[0].api_key
        ? decryptAPIKey(c, insertedAPIKey[0].api_key)
        : null,
    };
  },

  updateAIProvider: async (
    c: AppContext,
    id: string,
    update: AIProviderConfigUpdateParams,
  ): Promise<AIProviderConfig> => {
    const updateData = { ...update };

    // Encrypt the API key if it's being updated
    if (update.api_key !== undefined) {
      updateData.api_key = update.api_key
        ? encryptAPIKey(c, update.api_key)
        : undefined;
    }

    const updatedAPIKey = await updateInSupabase(
      c,
      'ai_providers',
      id,
      updateData,
      z.array(AIProviderConfig),
    );

    // Decrypt before returning
    return {
      ...updatedAPIKey[0],
      api_key: updatedAPIKey[0].api_key
        ? decryptAPIKey(c, updatedAPIKey[0].api_key)
        : null,
    };
  },

  deleteAIProvider: async (c: AppContext, id: string): Promise<void> => {
    await deleteFromSupabase(c, 'ai_providers', { id: `eq.${id}` });
  },

  // Models
  getModels: async (
    c: AppContext,
    queryParams: ModelQueryParams,
  ): Promise<Model[]> => {
    const postgrestParams: Record<string, string> = {};
    if (queryParams.id) {
      postgrestParams.id = `eq.${queryParams.id}`;
    }
    if (queryParams.ai_provider_id) {
      postgrestParams.ai_provider_id = `eq.${queryParams.ai_provider_id}`;
    }
    if (queryParams.model_name) {
      postgrestParams.model_name = `eq.${queryParams.model_name}`;
    }
    if (queryParams.limit) {
      postgrestParams.limit = queryParams.limit.toString();
    }
    if (queryParams.offset) {
      postgrestParams.offset = queryParams.offset.toString();
    }

    return await selectFromSupabase(
      c,
      'models',
      postgrestParams,
      z.array(Model),
    );
  },

  createModel: async (
    c: AppContext,
    model: ModelCreateParams,
  ): Promise<Model> => {
    const newModels = await insertIntoSupabase(
      c,
      'models',
      [model],
      z.array(Model),
    );
    return newModels[0];
  },

  updateModel: async (
    c: AppContext,
    id: string,
    update: ModelUpdateParams,
  ): Promise<Model> => {
    const updatedModels = await updateInSupabase(
      c,
      'models',
      id,
      update,
      z.array(Model),
    );
    return updatedModels[0];
  },

  deleteModel: async (c: AppContext, id: string): Promise<void> => {
    await deleteFromSupabase(c, 'models', { id: `eq.${id}` });
  },

  // Skill-Model Relationships
  getSkillModels: async (c: AppContext, skillId: string): Promise<Model[]> => {
    // Join skill_models bridge table with models table
    const models = await selectFromSupabase(
      c,
      'skill_models',
      { skill_id: `eq.${skillId}`, select: 'models(*)' },
      z.array(z.object({ models: Model })),
    );
    return models.map((item) => item.models);
  },

  getSkillsByModelId: async (
    c: AppContext,
    modelId: string,
  ): Promise<Skill[]> => {
    // Join skill_models bridge table with skills table to find all skills using this model
    const skills = await selectFromSupabase(
      c,
      'skill_models',
      { model_id: `eq.${modelId}`, select: 'skills(*)' },
      z.array(z.object({ skills: Skill })),
    );
    return skills.map((item) => item.skills);
  },

  addModelsToSkill: async (
    c: AppContext,
    skillId: string,
    modelIds: string[],
  ): Promise<void> => {
    const bridgeEntries = modelIds.map((modelId) => ({
      skill_id: skillId,
      model_id: modelId,
    }));
    await insertIntoSupabase(
      c,
      'skill_models',
      bridgeEntries,
      z.array(z.any()),
    );
  },

  removeModelsFromSkill: async (
    c: AppContext,
    skillId: string,
    modelIds: string[],
  ): Promise<void> => {
    for (const modelId of modelIds) {
      await deleteFromSupabase(c, 'skill_models', {
        skill_id: `eq.${skillId}`,
        model_id: `eq.${modelId}`,
      });
    }
  },

  getAgentModels: async (c: AppContext, agentId: string): Promise<Model[]> => {
    const models = await selectFromSupabase(
      c,
      'agent_models',
      { agent_id: `eq.${agentId}`, select: 'models(*)' },
      z.array(z.object({ models: Model })),
    );
    return models.map((item) => item.models);
  },

  addModelsToAgent: async (
    c: AppContext,
    agentId: string,
    modelIds: string[],
  ): Promise<void> => {
    if (modelIds.length === 0) {
      return;
    }
    await insertIntoSupabase(
      c,
      'agent_models',
      modelIds.map((modelId) => ({ agent_id: agentId, model_id: modelId })),
      z.array(z.any()),
      // Re-adding a model an agent already has is not an error.
      true,
    );
  },

  removeModelsFromAgent: async (
    c: AppContext,
    agentId: string,
    modelIds: string[],
  ): Promise<void> => {
    for (const modelId of modelIds) {
      await deleteFromSupabase(c, 'agent_models', {
        agent_id: `eq.${agentId}`,
        model_id: `eq.${modelId}`,
      });
    }
  },

  // SkillOptimizationCluster
  getSkillOptimizationClusters: async (
    c: AppContext,
    queryParams: SkillOptimizationClusterQueryParams,
  ): Promise<SkillOptimizationCluster[]> => {
    const postgRESTParams: Record<string, string> = {
      order: 'name.asc',
    };

    if (queryParams.id) {
      postgRESTParams.id = `eq.${queryParams.id}`;
    }
    if (queryParams.agent_id) {
      postgRESTParams.agent_id = `eq.${queryParams.agent_id}`;
    }
    if (queryParams.skill_id) {
      postgRESTParams.skill_id = `eq.${queryParams.skill_id}`;
    }
    if (queryParams.limit) {
      postgRESTParams.limit = queryParams.limit.toString();
    }
    if (queryParams.offset) {
      postgRESTParams.offset = queryParams.offset.toString();
    }

    const skillConfigurations = await selectFromSupabase(
      c,
      'skill_optimization_clusters',
      postgRESTParams,
      z.array(SkillOptimizationCluster),
    );

    return skillConfigurations;
  },

  createSkillOptimizationClusters: async (
    c: AppContext,
    params_list: SkillOptimizationClusterCreateParams[],
  ): Promise<SkillOptimizationCluster[]> => {
    const insertedSkillConfigurations = await insertIntoSupabase(
      c,
      'skill_optimization_clusters',
      params_list,
      z.array(SkillOptimizationCluster),
    );
    return insertedSkillConfigurations;
  },

  updateSkillOptimizationCluster: async (
    c: AppContext,
    id: string,
    params: SkillOptimizationClusterUpdateParams,
  ): Promise<SkillOptimizationCluster> => {
    const updatedSkillOptimizationClusterStates = await updateInSupabase(
      c,
      'skill_optimization_clusters',
      id,
      params,
      z.array(SkillOptimizationCluster),
    );
    return updatedSkillOptimizationClusterStates[0];
  },

  deleteSkillOptimizationCluster: async (
    c: AppContext,
    id: string,
  ): Promise<void> => {
    await deleteFromSupabase(c, 'skill_optimization_clusters', {
      id: `eq.${id}`,
    });
  },

  getSkillRoutings: async (
    c: AppContext,
    queryParams: SkillRoutingQueryParams,
  ): Promise<SkillRouting[]> => {
    const postgRESTParams: Record<string, string> = {};
    if (queryParams.agent_id) {
      postgRESTParams.agent_id = `eq.${queryParams.agent_id}`;
    }
    if (queryParams.skill_id) {
      postgRESTParams.skill_id = `eq.${queryParams.skill_id}`;
    }
    const routings = await selectFromSupabase(
      c,
      'skill_routing',
      postgRESTParams,
      z.array(SkillRouting),
    );
    return routings;
  },

  upsertSkillRouting: async (
    c: AppContext,
    params: SkillRoutingUpsertParams,
  ): Promise<SkillRouting> => {
    // `skill_id` is the primary key, which is what merge-duplicates resolves on.
    const rows = await insertIntoSupabase(
      c,
      'skill_routing',
      params,
      z.array(SkillRouting),
      true,
    );
    return rows[0];
  },

  claimSkillCreationLease: async (
    c: AppContext,
    agentId: string,
    holder: string,
    now: string,
    until: string,
  ): Promise<boolean> => {
    // Make sure the row exists, then take it only while nobody holds it: a
    // PATCH filtered on the lease being free changes no row when it is held,
    // and Postgres serialises two claimants racing for the same row.
    await insertIntoSupabase(
      c,
      'skill_creation_leases',
      { agent_id: agentId, holder: null, lease_until: null },
      null,
      'ignore',
    );
    await patchInSupabase(
      c,
      'skill_creation_leases',
      {
        agent_id: `eq.${agentId}`,
        or: `(lease_until.is.null,lease_until.lt.${now})`,
      },
      { holder, lease_until: until },
      null,
    );
    // PostgREST applies the filter to the representation as well as to the
    // update, and a lease just taken no longer passes it, so the rows it
    // returns say nothing. The row itself says who holds the lease.
    const rows = await selectFromSupabase(
      c,
      'skill_creation_leases',
      { agent_id: `eq.${agentId}`, select: 'holder' },
      z.array(z.object({ holder: z.string().nullable() })),
    );
    return rows[0]?.holder === holder;
  },

  releaseSkillCreationLease: async (
    c: AppContext,
    agentId: string,
    holder: string,
  ): Promise<void> => {
    await patchInSupabase(
      c,
      'skill_creation_leases',
      { agent_id: `eq.${agentId}`, holder: `eq.${holder}` },
      { holder: null, lease_until: null },
      null,
    );
  },

  incrementClusterCounters: async (
    c: AppContext,
    clusterId: string,
  ): Promise<SkillOptimizationCluster> => {
    const result = await rpcFunctionWithResponse(
      c,
      'increment_cluster_counters',
      { p_cluster_id: clusterId },
      z.array(SkillOptimizationCluster),
    );
    return result[0];
  },

  //SkillOptimizationArm
  getSkillOptimizationArms: async (
    c: AppContext,
    queryParams: SkillOptimizationArmQueryParams,
  ): Promise<SkillOptimizationArm[]> => {
    const postgRESTParams: Record<string, string> = {
      order: 'created_at.desc',
    };

    if (queryParams.id) {
      postgRESTParams.id = `eq.${queryParams.id}`;
    }
    if (queryParams.agent_id) {
      postgRESTParams.agent_id = `eq.${queryParams.agent_id}`;
    }
    if (queryParams.skill_id) {
      postgRESTParams.skill_id = `eq.${queryParams.skill_id}`;
    }
    if (queryParams.cluster_id) {
      postgRESTParams.cluster_id = `eq.${queryParams.cluster_id}`;
    }
    if (queryParams.limit) {
      postgRESTParams.limit = queryParams.limit.toString();
    }
    if (queryParams.offset) {
      postgRESTParams.offset = queryParams.offset.toString();
    }

    const skillConfigurations = await selectFromSupabase(
      c,
      'skill_optimization_arms',
      postgRESTParams,
      z.array(SkillOptimizationArm),
    );

    return skillConfigurations;
  },

  createSkillOptimizationArms: async (
    c: AppContext,
    params_list: SkillOptimizationArmCreateParams[],
  ): Promise<SkillOptimizationArm[]> => {
    const createdSkillOptimizationArms = await insertIntoSupabase(
      c,
      'skill_optimization_arms',
      params_list,
      z.array(SkillOptimizationArm),
    );

    return createdSkillOptimizationArms;
  },

  updateSkillOptimizationArm: async (
    c: AppContext,
    id: string,
    params: SkillOptimizationArmUpdateParams,
  ): Promise<SkillOptimizationArm> => {
    const updatedSkillOptimizationArms = await updateInSupabase(
      c,
      'skill_optimization_arms',
      id,
      params,
      z.array(SkillOptimizationArm),
    );

    return updatedSkillOptimizationArms[0];
  },

  updateArmAndIncrementCounters: async (
    c: AppContext,
    armId: string,
    evaluationResults: Array<{ evaluation_id: string; score: number }>,
  ): Promise<{
    arm: SkillOptimizationArm;
    cluster: SkillOptimizationCluster;
    skill: Skill;
  }> => {
    const result = await rpcFunctionWithResponse(
      c,
      'update_arm_and_increment_counters',
      {
        p_arm_id: armId,
        p_evaluation_results: evaluationResults,
      },
      z.array(
        z.object({
          arm: SkillOptimizationArm,
          cluster: SkillOptimizationCluster,
          skill: Skill,
        }),
      ),
    );
    return result[0];
  },

  deleteSkillOptimizationArm: async (
    c: AppContext,
    id: string,
  ): Promise<void> => {
    await deleteFromSupabase(c, 'skill_optimization_arms', {
      id: `eq.${id}`,
    });
  },

  deleteSkillOptimizationArmsForSkill: async (
    c: AppContext,
    skillId: string,
  ): Promise<void> => {
    await deleteFromSupabase(c, 'skill_optimization_arms', {
      skill_id: `eq.${skillId}`,
    });
  },

  deleteSkillOptimizationArmsForCluster: async (
    c: AppContext,
    clusterId: string,
  ): Promise<void> => {
    await deleteFromSupabase(c, 'skill_optimization_arms', {
      cluster_id: `eq.${clusterId}`,
    });
  },

  // SkillOptimizationArmStats
  getSkillOptimizationArmStats: async (
    c: AppContext,
    queryParams: import('@shared/types/data/skill-optimization-arm-stats').SkillOptimizationArmStatQueryParams,
  ): Promise<
    import('@shared/types/data/skill-optimization-arm-stats').SkillOptimizationArmStat[]
  > => {
    const postgRESTParams: Record<string, string> = {
      order: 'created_at.desc',
    };

    if (queryParams.arm_id) {
      postgRESTParams.arm_id = `eq.${queryParams.arm_id}`;
    }
    if (queryParams.evaluation_id) {
      postgRESTParams.evaluation_id = `eq.${queryParams.evaluation_id}`;
    }
    if (queryParams.agent_id) {
      postgRESTParams.agent_id = `eq.${queryParams.agent_id}`;
    }
    if (queryParams.skill_id) {
      postgRESTParams.skill_id = `eq.${queryParams.skill_id}`;
    }
    if (queryParams.cluster_id) {
      postgRESTParams.cluster_id = `eq.${queryParams.cluster_id}`;
    }
    if (queryParams.limit !== undefined) {
      postgRESTParams.limit = queryParams.limit.toString();
    }
    if (queryParams.offset !== undefined) {
      postgRESTParams.offset = queryParams.offset.toString();
    }

    const { SkillOptimizationArmStat } = await import(
      '@shared/types/data/skill-optimization-arm-stats'
    );
    return await selectFromSupabase(
      c,
      'skill_optimization_arm_stats',
      postgRESTParams,
      z.array(SkillOptimizationArmStat),
    );
  },

  deleteSkillOptimizationArmStats: async (
    c: AppContext,
    queryParams: import('@shared/types/data/skill-optimization-arm-stats').SkillOptimizationArmStatQueryParams,
  ): Promise<void> => {
    const postgRESTParams: Record<string, string> = {};

    if (queryParams.arm_id) {
      postgRESTParams.arm_id = `eq.${queryParams.arm_id}`;
    }
    if (queryParams.evaluation_id) {
      postgRESTParams.evaluation_id = `eq.${queryParams.evaluation_id}`;
    }
    if (queryParams.agent_id) {
      postgRESTParams.agent_id = `eq.${queryParams.agent_id}`;
    }
    if (queryParams.skill_id) {
      postgRESTParams.skill_id = `eq.${queryParams.skill_id}`;
    }
    if (queryParams.cluster_id) {
      postgRESTParams.cluster_id = `eq.${queryParams.cluster_id}`;
    }

    await deleteFromSupabase(
      c,
      'skill_optimization_arm_stats',
      postgRESTParams,
    );
  },

  // SkillOptimizationEvaluation
  getSkillOptimizationEvaluations: async (
    c: AppContext,
    queryParams: SkillOptimizationEvaluationQueryParams,
  ): Promise<SkillOptimizationEvaluation[]> => {
    const postgRESTParams: Record<string, string> = {
      order: 'created_at.desc',
    };

    if (queryParams.id) {
      postgRESTParams.id = `eq.${queryParams.id}`;
    }
    if (queryParams.agent_id) {
      postgRESTParams.agent_id = `eq.${queryParams.agent_id}`;
    }
    if (queryParams.skill_id) {
      postgRESTParams.skill_id = `eq.${queryParams.skill_id}`;
    }
    if (queryParams.evaluation_method) {
      postgRESTParams.evaluation_method = `eq.${queryParams.evaluation_method}`;
    }
    if (queryParams.limit) {
      postgRESTParams.limit = queryParams.limit.toString();
    }
    if (queryParams.offset) {
      postgRESTParams.offset = queryParams.offset.toString();
    }

    const evaluations = await selectFromSupabase(
      c,
      'skill_optimization_evaluations',
      postgRESTParams,
      z.array(SkillOptimizationEvaluation),
    );

    return evaluations;
  },

  async createSkillOptimizationEvaluations(
    c: AppContext,
    params: SkillOptimizationEvaluation[],
  ): Promise<SkillOptimizationEvaluation[]> {
    const createdEvaluations = await insertIntoSupabase(
      c,
      'skill_optimization_evaluations',
      params,
      z.array(SkillOptimizationEvaluation),
    );

    return createdEvaluations;
  },

  async updateSkillOptimizationEvaluation(
    c: AppContext,
    id: string,
    update: import('@shared/types/data').SkillOptimizationEvaluationUpdateParams,
  ): Promise<SkillOptimizationEvaluation> {
    const updatedEvaluations = await updateInSupabase(
      c,
      'skill_optimization_evaluations',
      id,
      update,
      z.array(SkillOptimizationEvaluation),
    );

    if (updatedEvaluations.length === 0) {
      throw new Error('Evaluation not found');
    }

    return updatedEvaluations[0];
  },

  async deleteSkillOptimizationEvaluation(
    c: AppContext,
    id: string,
  ): Promise<void> {
    await deleteFromSupabase(c, 'skill_optimization_evaluations', {
      id: `eq.${id}`,
    });
  },

  async deleteSkillOptimizationEvaluationsForSkill(
    c: AppContext,
    skillId: string,
  ): Promise<void> {
    await deleteFromSupabase(c, 'skill_optimization_evaluations', {
      skill_id: `eq.${skillId}`,
    });
  },

  // SkillOptimizationEvaluationRun
  getSkillOptimizationEvaluationRuns: async (
    c: AppContext,
    queryParams: SkillOptimizationEvaluationRunQueryParams,
  ): Promise<SkillOptimizationEvaluationRun[]> => {
    const postgRESTParams: Record<string, string> = {
      order: 'created_at.desc',
    };

    if (queryParams.id) {
      postgRESTParams.id = `eq.${queryParams.id}`;
    }
    if (queryParams.agent_id) {
      postgRESTParams.agent_id = `eq.${queryParams.agent_id}`;
    }
    if (queryParams.skill_id) {
      postgRESTParams.skill_id = `eq.${queryParams.skill_id}`;
    }
    if (queryParams.log_id) {
      postgRESTParams.log_id = `eq.${queryParams.log_id}`;
    }
    if (queryParams.limit) {
      postgRESTParams.limit = queryParams.limit.toString();
    }
    if (queryParams.offset) {
      postgRESTParams.offset = queryParams.offset.toString();
    }

    const evaluationRuns = await selectFromSupabase(
      c,
      'skill_optimization_evaluation_runs',
      postgRESTParams,
      z.array(SkillOptimizationEvaluationRun),
    );

    return evaluationRuns;
  },

  async createSkillOptimizationEvaluationRun(
    c: AppContext,
    params: SkillOptimizationEvaluationRunCreateParams,
  ): Promise<SkillOptimizationEvaluationRun> {
    const createdEvaluationRuns = await insertIntoSupabase(
      c,
      'skill_optimization_evaluation_runs',
      params,
      z.array(SkillOptimizationEvaluationRun),
    );

    return createdEvaluationRuns[0];
  },

  async deleteSkillOptimizationEvaluationRun(
    c: AppContext,
    id: string,
  ): Promise<void> {
    await deleteFromSupabase(c, 'skill_optimization_evaluation_runs', {
      id: `eq.${id}`,
    });
  },

  async getEvaluationScoresByTimeBucket(
    c: AppContext,
    params: import('@shared/types/data/evaluation-runs-with-scores').EvaluationScoresByTimeBucketParams,
  ): Promise<
    import('@shared/types/data/evaluation-runs-with-scores').EvaluationScoresByTimeBucketResult[]
  > {
    const { EvaluationScoresByTimeBucketResult } = await import(
      '@shared/types/data/evaluation-runs-with-scores'
    );

    // Call PostgreSQL function to get time-bucketed scores
    const interval = `${params.interval_minutes} minutes`;
    const result = await rpcFunctionWithResponse(
      c,
      'get_evaluation_scores_by_time_bucket',
      {
        p_agent_id: params.agent_id || null,
        p_skill_id: params.skill_id || null,
        p_cluster_id: params.cluster_id || null,
        p_interval: interval,
        p_start_time: params.start_time,
        p_end_time: params.end_time,
      },
      z.array(EvaluationScoresByTimeBucketResult),
    );

    return result;
  },

  // Skill Events
  async getSkillEvents(
    c: AppContext,
    queryParams: SkillEventQueryParams,
  ): Promise<SkillEvent[]> {
    const postgRESTParams: Record<string, string> = {
      select: '*',
      order: 'created_at.desc',
    };

    if (queryParams.id) {
      postgRESTParams.id = `eq.${queryParams.id}`;
    }
    if (queryParams.agent_id) {
      postgRESTParams.agent_id = `eq.${queryParams.agent_id}`;
    }
    if (queryParams.skill_id) {
      postgRESTParams.skill_id = `eq.${queryParams.skill_id}`;
    }
    if (queryParams.cluster_id) {
      postgRESTParams.cluster_id = `eq.${queryParams.cluster_id}`;
    }
    if (queryParams.event_type) {
      postgRESTParams.event_type = `eq.${queryParams.event_type}`;
    }
    if (queryParams.limit) {
      postgRESTParams.limit = queryParams.limit.toString();
    }
    if (queryParams.offset) {
      postgRESTParams.offset = queryParams.offset.toString();
    }

    const events = await selectFromSupabase(
      c,
      'skill_events',
      postgRESTParams,
      z.array(SkillEvent),
    );
    return events;
  },

  async createSkillEvent(
    c: AppContext,
    params: SkillEventCreateParams,
  ): Promise<SkillEvent> {
    const validatedParams = SkillEventCreateParams.parse(params);
    const createdEvent = await insertIntoSupabase(
      c,
      'skill_events',
      validatedParams,
      z.array(SkillEvent),
    );

    // Emit SSE event for real-time updates
    emitSSEEvent('skill-optimization:event-created', {
      eventId: createdEvent[0].id,
      skillId: createdEvent[0].skill_id,
      clusterId: createdEvent[0].cluster_id,
      eventType: createdEvent[0].event_type,
    });

    return createdEvent[0];
  },

  // System Settings (singleton - only one row exists)
  async getSystemSettings(c: AppContext): Promise<SystemSettings> {
    const settings = await selectFromSupabase(
      c,
      'system_settings',
      { limit: '1' },
      z.array(SystemSettings),
    );
    // There should always be exactly one row (created by migration)
    return settings[0];
  },

  async updateSystemSettings(
    c: AppContext,
    update: SystemSettingsUpdateParams,
  ): Promise<SystemSettings> {
    // Get the singleton settings row first
    const currentSettings = await selectFromSupabase(
      c,
      'system_settings',
      { limit: '1' },
      z.array(SystemSettings),
    );
    const settingsId = currentSettings[0].id;

    // The options patch is merged over what is stored, so a caller that
    // changes one timeout does not have to send the rest.
    const { options, ...rest } = update;
    const updatedSettings = await updateInSupabase(
      c,
      'system_settings',
      settingsId,
      {
        ...rest,
        ...(options && {
          options: mergeSystemSettingsOptions(
            currentSettings[0].options,
            options,
          ),
        }),
      },
      z.array(SystemSettings),
    );
    return updatedSettings[0];
  },
};

export const supabaseCacheStorageConnector: CacheStorageConnector = {
  getCache: async (c: AppContext, key: string) => {
    const cachedValues = await selectFromSupabase(
      c,
      'cache',
      { key: `eq.${key}`, expires_at: `gte.${new Date().toISOString()}` },
      z.array(CachedValue),
    );

    if (cachedValues.length === 0) {
      return null;
    }

    return cachedValues[0].value;
  },
  setCache: async (c: AppContext, key: string, value: string) => {
    const cachedValue: CachedValue = {
      key,
      value,
      /**
       * This used to be `new Date()`, which is the same instant `getCache`
       * compares against with `expires_at >= now` -- so every entry was
       * already expired when it was written and the cache never returned a
       * hit. `CacheStorageConnector.setCache` takes no TTL, so the backend
       * picks one; this matches the libSQL connector.
       */
      expires_at: new Date(Date.now() + CACHE_TTL_SECONDS * 1000).toISOString(),
    };
    // We use upsert to replace the existing value if it exists
    await insertIntoSupabase(c, 'cache', cachedValue, null, true);
  },
  deleteCache: async (c: AppContext, key: string) => {
    await deleteFromSupabase(c, 'cache', { key: `eq.${key}` });
  },
};

export const supabaseLogsStorageConnector: LogsStorageConnector = {
  getLogs: async (
    c: AppContext,
    queryParams: LogsQueryParams,
  ): Promise<Log[]> => {
    const postgRESTQuery: Record<string, string> = {
      order: queryParams.order === 'asc' ? 'start_time.asc' : 'start_time.desc',
    };

    if (queryParams.agent_id) {
      postgRESTQuery.agent_id = `eq.${queryParams.agent_id}`;
    }
    if (queryParams.skill_id) {
      postgRESTQuery.skill_id = `eq.${queryParams.skill_id}`;
    }
    if (queryParams.cluster_id) {
      postgRESTQuery.cluster_id = `eq.${queryParams.cluster_id}`;
    }
    if (queryParams.arm_id) {
      // As in the libSQL connector: the arm is not a column, it is recorded
      // on the log as `metadata.served_configuration`.
      postgRESTQuery['metadata->served_configuration->>id'] =
        `eq.${queryParams.arm_id}`;
    }
    if (queryParams.app_id) {
      postgRESTQuery.app_id = `eq.${queryParams.app_id}`;
    }
    if (queryParams.trace_id) {
      postgRESTQuery.trace_id = `eq.${queryParams.trace_id}`;
    }
    if (queryParams.id) {
      postgRESTQuery.id = `eq.${queryParams.id}`;
    }
    if (queryParams.method) {
      postgRESTQuery.method = `eq.${queryParams.method}`;
    }
    if (queryParams.endpoint) {
      postgRESTQuery.endpoint = `eq.${queryParams.endpoint}`;
    }
    if (queryParams.function_name) {
      postgRESTQuery.function_name = `eq.${queryParams.function_name}`;
    }
    if (queryParams.status) {
      postgRESTQuery.status = `eq.${queryParams.status}`;
    }
    if (queryParams.cache_status) {
      postgRESTQuery.cache_status = `eq.${queryParams.cache_status}`;
    }
    if (queryParams.limit) {
      postgRESTQuery.limit = queryParams.limit.toString();
    }
    if (queryParams.offset) {
      postgRESTQuery.offset = queryParams.offset.toString();
    }

    if (queryParams.unjudged) {
      postgRESTQuery.eval_run_count = 'eq.0';
    }
    if (queryParams.embedding_not_null) {
      postgRESTQuery.embedding = 'not.is.null';
    }

    if (queryParams.after) {
      postgRESTQuery.start_time = `gte.${queryParams.after}`;
    }
    if (queryParams.before) {
      // If we already have a start_time filter, we need to combine them
      if (postgRESTQuery.start_time) {
        // For range queries, we'll use PostgREST's and operator syntax
        postgRESTQuery.and = `(start_time.gte.${queryParams.after},start_time.lte.${queryParams.before})`;
        delete postgRESTQuery.start_time;
      } else {
        postgRESTQuery.start_time = `lte.${queryParams.before}`;
      }
    }

    // Use the logs_with_eval_scores view to include computed evaluation scores
    const logs = await selectFromSupabase(
      c,
      'logs_with_eval_scores',
      postgRESTQuery,
      z.array(Log),
    );

    return logs;
  },

  startLog: async (
    c: AppContext,
    startParams: LogStartParams,
  ): Promise<void> => {
    await insertIntoSupabase(
      c,
      'logs',
      {
        ...startParams,
        // NOT NULL, and nothing to put in `hook_logs` until the hooks have
        // run. `metadata` carries whatever the gateway has decided so far.
        hook_logs: [],
        metadata: startParams.metadata ?? {},
      },
      null,
      // A retried request could reuse an id; completing the row beats failing.
      true,
    );
  },

  createLog: async (
    c: AppContext,
    createParams: LogCreateParams,
  ): Promise<Log> => {
    const insertedLog = await insertIntoSupabase(
      c,
      'logs',
      createParams,
      z.array(Log),
      // Completes the row opened when the request arrived, when there is one.
      // `startLog` does not await, so the insert may still be in flight; the
      // upsert makes the order between them not matter.
      true,
    );
    return insertedLog[0];
  },

  failLog: async (c: AppContext, failParams: LogFailParams): Promise<void> => {
    const { id, ...rest } = failParams;

    // An update, not an upsert: a request that failed before its row was
    // opened has nothing to close, and inventing a row here would record a
    // failure with none of the request it belongs to.
    //
    // `end_time=is.null` is what makes this safe to call as a backstop on a
    // path that may already have completed the row: a request that was logged
    // successfully is left exactly as it is.
    await patchInSupabase(
      c,
      'logs',
      { id: `eq.${id}`, end_time: 'is.null' },
      rest,
      null,
    );
  },

  deleteLog: async (c: AppContext, id: string) => {
    await deleteFromSupabase(c, 'logs', { id: `eq.${id}` });
  },
};
