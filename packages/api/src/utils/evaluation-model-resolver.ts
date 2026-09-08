import { isAPIKeyRequiredForProvider } from '@api/ai-providers';
import type { LLMJudgeModelConfig } from '@api/evaluations/llm-judge';
import type { UserDataStorageConnector } from '@api/types/connector';
import type { AppContext } from '@api/types/hono';
import { warn } from '@shared/console-logging';
import type { ReasoningEffort } from '@shared/types/api/routes/shared/thinking';
import type { AIProvider } from '@shared/types/constants';
import type {
  Agent,
  Model,
  SkillOptimizationEvaluation,
  SystemSettings,
} from '@shared/types/data';

/**
 * Model configuration resolved from system settings or evaluation.
 */
export interface ResolvedModelConfig {
  model: string;
  provider: AIProvider;
  /**
   * The provider's API key, where it has one. Self-hosted providers such as
   * Ollama are configured without a key and are called without one.
   */
  apiKey?: string;
  /**
   * The provider's configured base URL, where it has one.
   *
   * Internal skills call back through the gateway with a target naming only a
   * provider and a model, so without this a self-hosted provider is sent to its
   * vendor default -- Ollama to `http://localhost:11434` -- no matter what the
   * user configured. The failure is quiet: the call cannot connect, the error
   * is logged, and optimization simply stops happening.
   */
  customHost?: string;
  /**
   * How long one attempt at this call may take, from the timeout that sits
   * beside the model in system settings.
   *
   * It rides along with the model because every caller that needs one needs
   * the other, and resolving them together is what keeps a new internal skill
   * from quietly inheriting the OpenAI client's ten-minute default. Absent
   * only from a model resolved by id alone, which has no setting of its own.
   */
  timeoutMs?: number;
  /**
   * How hard this role's model may think before it answers, from the effort
   * that sits beside it in system settings. Null or absent sends nothing and
   * leaves the model to its own default. Rides along for the same reason the
   * timeout does: a caller that resolves a model needs the bounds on it.
   */
  reasoningEffort?: ReasoningEffort | null;
}

/**
 * System settings model type for lookup.
 */
export type SystemSettingsModelType =
  | 'judge'
  | 'embedding'
  | 'system_prompt_reflection'
  | 'evaluation_generation'
  | 'skill_arbiter'
  | 'intent_compaction';

/**
 * Resolves a model configuration from a model ID.
 *
 * @param modelId - The model ID to resolve
 * @param connector - The storage connector to look up models
 * @param logPrefix - Prefix for log messages
 * @returns The model configuration or null if not found
 */
export async function resolveModelById(
  c: AppContext,
  modelId: string,
  connector: UserDataStorageConnector,
  logPrefix: string,
): Promise<ResolvedModelConfig | null> {
  // Look up the model
  const models = await connector.getModels(c, { id: modelId });
  if (models.length === 0) {
    warn(`[${logPrefix}] Model not found: ${modelId}`);
    return null;
  }
  const model = models[0];

  // Look up the provider to get the API key
  const providers = await connector.getAIProviderAPIKeys(c, {
    id: model.ai_provider_id,
  });
  if (providers.length === 0) {
    warn(
      `[${logPrefix}] Provider not found for model: ${model.ai_provider_id}`,
    );
    return null;
  }
  const providerConfig = providers[0];

  // Ensure we have an API key, for the providers that need one
  if (
    !providerConfig.api_key &&
    isAPIKeyRequiredForProvider(providerConfig.ai_provider)
  ) {
    warn(
      `[${logPrefix}] No API key configured for provider: ${model.ai_provider_id}`,
    );
    return null;
  }

  return {
    model: model.model_name,
    provider: providerConfig.ai_provider as AIProvider,
    apiKey: providerConfig.api_key ?? undefined,
    customHost: providerConfig.custom_fields?.custom_host as string | undefined,
  };
}

/**
 * Resolves a model configuration from system settings.
 *
 * @param modelType - The type of model to resolve from system settings
 * @param connector - The storage connector to look up models and settings
 * @param settings - The system settings, when the caller already read them
 * @returns The model configuration or null if not configured
 */
export function resolveSystemSettingsModel(
  c: AppContext,
  modelType: SystemSettingsModelType,
  connector: UserDataStorageConnector,
  settings?: SystemSettings,
): Promise<ResolvedModelConfig | null> {
  return resolveRoleModel(c, modelType, connector, null, settings);
}

/**
 * The agent a call is being made for, loaded from the skill it is about.
 *
 * Every internal call belongs to some agent's work, but most of the callers
 * hold a skill rather than the agent -- so this is where the one becomes the
 * other. Null when the skill or its agent has gone, which leaves the call on
 * the system settings rather than failing it.
 */
export async function agentOfSkill(
  c: AppContext,
  connector: UserDataStorageConnector,
  skillId: string,
): Promise<Agent | null> {
  const skills = await lookUp(() => connector.getSkills(c, { id: skillId }));
  const agentId = skills[0]?.agent_id;
  return agentId ? await agentById(c, connector, agentId) : null;
}

/** The agent, or null where it has been deleted under a running call. */
export async function agentById(
  c: AppContext,
  connector: UserDataStorageConnector,
  agentId: string,
): Promise<Agent | null> {
  const agents = await lookUp(() => connector.getAgents(c, { id: agentId }));
  return agents[0] ?? null;
}

/**
 * A read whose failure means "no agent" rather than a failed call.
 *
 * Every one of these is asking who to resolve a model for, and the answer to
 * not knowing is the system settings -- which is exactly what a null agent
 * gives. A judging run is not worth failing over a lookup.
 */
async function lookUp<T>(read: () => Promise<T[]> | T[]): Promise<T[]> {
  try {
    return (await read()) ?? [];
  } catch (e) {
    warn('[MODEL_RESOLVER] Could not read who this call is for:', e);
    return [];
  }
}

/** The model id an agent names for a role, where it names one. */
export const agentModelId = (
  agent: Agent | null,
  role: SystemSettingsModelType,
): string | null => (agent ? agent[`${role}_model_id`] : null);

/**
 * The model for one internal role, as this agent has it.
 *
 * Every one of these calls is made on some agent's behalf -- routing its
 * requests, judging its answers, writing its skills' prompts -- and what
 * suits the work is a property of the work, not of the deployment. So the
 * agent answers first for each of the three things a call needs: which model,
 * how long it may take, and how hard it may think. Anything it leaves null
 * falls through to the system setting, which is where a deployment with no
 * opinions stays.
 *
 * `agent` is null where the caller genuinely has none -- the internal skills
 * the gateway runs for itself -- and then this is the system's answer alone.
 */
export async function resolveRoleModel(
  c: AppContext,
  role: SystemSettingsModelType,
  connector: UserDataStorageConnector,
  agent: Agent | null,
  settings?: SystemSettings,
): Promise<ResolvedModelConfig | null> {
  const logPrefix = `MODEL_RESOLVER_${role.toUpperCase()}`;
  const systemSettings = settings ?? (await connector.getSystemSettings(c));

  const roleOptions = systemSettings.options[role];
  const agentOptions = agent?.options[role];
  const timeoutMs = agentOptions?.timeout_ms ?? roleOptions.timeout_ms;
  // Every role but embedding has an effort; an embedding has nothing to think
  // about, so neither options object carries one.
  const reasoningEffort =
    'reasoning_effort' in roleOptions
      ? ((agentOptions && 'reasoning_effort' in agentOptions
          ? agentOptions.reasoning_effort
          : null) ?? roleOptions.reasoning_effort)
      : null;

  let modelId = agentModelId(agent, role);
  let configured = `${role}_model_id`;
  if (!modelId) {
    switch (role) {
      case 'judge':
        modelId = systemSettings.judge_model_id;
        break;
      case 'embedding':
        modelId = systemSettings.embedding_model_id;
        break;
      case 'system_prompt_reflection':
        modelId = systemSettings.system_prompt_reflection_model_id;
        break;
      case 'evaluation_generation':
        modelId = systemSettings.evaluation_generation_model_id;
        break;
      case 'skill_arbiter':
        // The arbiter has a model of its own only when one is chosen for it;
        // otherwise it borrows the reflection model, as it always did.
        modelId =
          systemSettings.skill_arbiter_model_id ??
          systemSettings.system_prompt_reflection_model_id;
        configured =
          'skill_arbiter_model_id or system_prompt_reflection_model_id';
        break;
      case 'intent_compaction':
        // As with the arbiter: a model of its own only when one is chosen for
        // it, and the reflection model otherwise.
        modelId =
          systemSettings.intent_compaction_model_id ??
          systemSettings.system_prompt_reflection_model_id;
        configured =
          'intent_compaction_model_id or system_prompt_reflection_model_id';
        break;
    }
  }

  if (!modelId) {
    warn(`[${logPrefix}] No ${configured} configured in system settings`);
    return null;
  }

  const resolved = await resolveModelById(c, modelId, connector, logPrefix);
  return resolved && { ...resolved, timeoutMs, reasoningEffort };
}

/**
 * Resolves the judge with everything a judging call needs from settings: the
 * model, its timeout and reasoning effort, and the completion budget that
 * lets a thinking model finish its answer.
 */
export async function resolveJudgeModelConfig(
  c: AppContext,
  connector: UserDataStorageConnector,
  agent: Agent | null = null,
  settings?: SystemSettings,
): Promise<LLMJudgeModelConfig | null> {
  const systemSettings = settings ?? (await connector.getSystemSettings(c));
  const resolved = await resolveRoleModel(
    c,
    'judge',
    connector,
    agent,
    systemSettings,
  );
  // The effort arrives with the model, like every role's; only the budget is
  // the judge's own -- and the agent answers for it on the same terms.
  return (
    resolved && {
      ...resolved,
      maxTokens:
        agent?.options.judge.max_tokens ??
        systemSettings.options.judge.max_tokens,
    }
  );
}

/**
 * Resolves the model configuration for an evaluation.
 *
 * Resolution order:
 * 1. If evaluation.model_id is set, use that model
 * 2. Otherwise, use the judge_model_id from system settings
 *
 * @param evaluation - The evaluation to resolve model for
 * @param connector - The storage connector to look up models and settings
 * @returns The model configuration or null if no model could be resolved
 */
export async function resolveEvaluationModelConfig(
  c: AppContext,
  evaluation: SkillOptimizationEvaluation,
  connector: UserDataStorageConnector,
): Promise<LLMJudgeModelConfig | null> {
  const logPrefix = 'EVAL_MODEL_RESOLVER';
  // Whose answers are being scored: the agent answers for the judge before
  // the system does, and its evaluation before either.
  const agent = await agentOfSkill(c, connector, evaluation.skill_id);

  // If evaluation has a model_id, use it. A model named by an evaluation has
  // no timeout or token budget of its own, so it is judged under the judge's.
  if (evaluation.model_id) {
    const resolved = await resolveModelById(
      c,
      evaluation.model_id,
      connector,
      logPrefix,
    );
    if (!resolved) {
      return null;
    }
    const { options } = await connector.getSystemSettings(c);
    const own = agent?.options.judge;
    return {
      ...resolved,
      timeoutMs: own?.timeout_ms ?? options.judge.timeout_ms,
      maxTokens: own?.max_tokens ?? options.judge.max_tokens,
      reasoningEffort: own?.reasoning_effort ?? options.judge.reasoning_effort,
    };
  }

  // Fall back to the judge model, the agent's or the system's.
  return await resolveJudgeModelConfig(c, connector, agent);
}

/**
 * Embedding model configuration with dimensions.
 */
export interface EmbeddingModelConfig {
  modelId: string;
  model: Model;
  dimensions: number;
  /** How long one embedding call may take, from system settings. */
  timeoutMs: number;
}

/**
 * Resolves the embedding model configuration from system settings.
 *
 * @param connector - The storage connector to look up models and settings
 * @returns The embedding model config or null if not configured
 */
export async function resolveEmbeddingModelConfig(
  c: AppContext,
  connector: UserDataStorageConnector,
  agent: Agent | null = null,
): Promise<EmbeddingModelConfig | null> {
  const logPrefix = 'EMBEDDING_MODEL_RESOLVER';
  const systemSettings = await connector.getSystemSettings(c);

  // An agent embeds with the model it names. Its skills' routing centroids
  // record which model computed them, so a skill whose centroids were built
  // under another model is re-seeded rather than compared across the two --
  // the same thing that happens when the system setting changes.
  const modelId =
    agent?.embedding_model_id ?? systemSettings.embedding_model_id;
  if (!modelId) {
    warn(`[${logPrefix}] No embedding_model_id configured in system settings`);
    return null;
  }

  const models = await connector.getModels(c, { id: modelId });
  if (models.length === 0) {
    warn(`[${logPrefix}] Embedding model not found: ${modelId}`);
    return null;
  }

  const model = models[0];

  if (!model.embedding_dimensions) {
    warn(
      `[${logPrefix}] Embedding model ${model.model_name} has no dimensions configured`,
    );
    return null;
  }

  return {
    modelId: model.id,
    model,
    dimensions: model.embedding_dimensions,
    timeoutMs:
      agent?.options.embedding.timeout_ms ??
      systemSettings.options.embedding.timeout_ms,
  };
}
