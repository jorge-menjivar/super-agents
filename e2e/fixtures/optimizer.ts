import type { APIRequestContext } from '@playwright/test';
import { createAgent, uniqueAgentName } from './agents';
import { STUB_URL, uniqueModelName } from './gateway';
import { createSkill, SKILLS_PATH } from './skills';

const PROVIDERS_PATH = '/v1/super-agents/ai-providers';
export const MODELS_PATH = '/v1/super-agents/models';
const SETTINGS_PATH = '/v1/super-agents/system-settings';

/** What the stub answers with for a `string` field named `system_prompt`. */
export const STUB_SYSTEM_PROMPT = 'stub: system_prompt';

export interface OptimizedSkill {
  agentId: string;
  agentName: string;
  skillId: string;
  skillName: string;
  textModel: string;
  embeddingModel: string;
}

const post = async <T>(
  request: APIRequestContext,
  path: string,
  data: unknown,
  expected = 201,
): Promise<T> => {
  const response = await request.post(path, { data });
  if (response.status() !== expected) {
    throw new Error(
      `POST ${path} -> ${response.status()} ${await response.text()}`,
    );
  }
  return response.json() as Promise<T>;
};

/**
 * Stands up everything the optimizer needs before it will do anything at all:
 * a provider pointed at the stub, a text and an embedding model, the four
 * system-settings slots that the internal skills resolve through, an agent, an
 * optimizing skill, and the models attached to that skill.
 *
 * Attaching the models is what triggers arm generation, so by the time this
 * returns the internal seeding skill has already run and the skill has its
 * clusters and arms.
 *
 * `scope` separates one caller's stub traffic from another's: the model name is
 * how the stub buckets requests, and one stub process serves every project.
 */
export interface StubModels {
  providerId: string;
  textId: string;
  embeddingId: string;
  textModel: string;
  embeddingModel: string;
}

/**
 * A provider pointed at the stub, a text and an embedding model on it, and the
 * four system-settings slots the internal skills resolve through.
 *
 * `scope` separates one caller's stub traffic from another's: the model name is
 * how the stub buckets requests, and one stub process serves every project.
 * System settings are a single global row, so callers run serially.
 */
export const setUpStubModels = async (
  request: APIRequestContext,
  scope: string,
): Promise<StubModels> => {
  const textModel = uniqueModelName(`${scope}-text`);
  const embeddingModel = uniqueModelName(`${scope}-embed`);

  const provider = await post<{ id: string }>(request, PROVIDERS_PATH, {
    ai_provider: 'ollama',
    name: uniqueModelName(`${scope}-provider`),
    // The stub ignores it, but the resolver refuses a provider without one.
    api_key: 'unused-by-the-stub',
    // How the internal skills find the stub instead of Ollama's default host.
    custom_fields: { custom_host: STUB_URL },
  });

  const text = await post<{ id: string }>(request, MODELS_PATH, {
    ai_provider_id: provider.id,
    model_name: textModel,
    model_type: 'text',
  });

  const embedding = await post<{ id: string }>(request, MODELS_PATH, {
    ai_provider_id: provider.id,
    model_name: embeddingModel,
    model_type: 'embed',
    embedding_dimensions: 8,
  });

  const settings = await request.patch(SETTINGS_PATH, {
    data: {
      judge_model_id: text.id,
      embedding_model_id: embedding.id,
      system_prompt_reflection_model_id: text.id,
      evaluation_generation_model_id: text.id,
    },
  });
  if (settings.status() !== 200) {
    throw new Error(`PATCH ${SETTINGS_PATH} -> ${settings.status()}`);
  }

  return {
    providerId: provider.id,
    textId: text.id,
    embeddingId: embedding.id,
    textModel,
    embeddingModel,
  };
};

export const setUpOptimizedSkill = async (
  request: APIRequestContext,
  scope: string,
): Promise<OptimizedSkill> => {
  const { textId, textModel, embeddingModel } = await setUpStubModels(
    request,
    scope,
  );

  const agent = await createAgent(request, uniqueAgentName(scope));
  const skill = await createSkill(request, agent.id, 'optimized_skill', {
    optimize: true,
    configuration_count: 3,
  });

  // Attaching a model is what generates the clusters and arms.
  await post(
    request,
    `${SKILLS_PATH}/${skill.id}/models`,
    { modelIds: [textId] },
    201,
  );

  return {
    agentId: agent.id,
    agentName: agent.name,
    skillId: skill.id,
    skillName: skill.name,
    textModel,
    embeddingModel,
  };
};

export interface Arm {
  id: string;
  cluster_id: string;
  name: string;
  params: { system_prompt: string | null };
}

export const getArms = async (
  request: APIRequestContext,
  skillId: string,
): Promise<Arm[]> => {
  const response = await request.get(`${SKILLS_PATH}/${skillId}/arms`);
  return response.json() as Promise<Arm[]>;
};

export const getClusters = async (
  request: APIRequestContext,
  skillId: string,
): Promise<{ id: string }[]> => {
  const response = await request.get(`${SKILLS_PATH}/${skillId}/clusters`);
  return response.json() as Promise<{ id: string }[]>;
};

/** An `sa-config` header asking for the optimized configuration. */
export const optimizedConfig = (agentName: string, skillName: string): string =>
  JSON.stringify({
    agent_name: agentName,
    skill_name: skillName,
    targets: [{ optimization: 'auto' }],
  });
