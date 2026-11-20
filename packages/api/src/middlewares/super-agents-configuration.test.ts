import { saConfigurationInjectorMiddleware } from '@api/middlewares/super-agents-configuration';
import { handleGenerateArms } from '@api/optimization/skill-optimizations';
import type { AppContext } from '@api/types/hono';
import { generateEmbeddingForRequest } from '@api/utils/embeddings';
import { resolveEmbeddingModelConfig } from '@api/utils/evaluation-model-resolver';
import { FunctionName } from '@shared/types/api/request';
import type { SuperAgentsRequestData } from '@shared/types/api/request/body';
import {
  type SuperAgentsConfig,
  SuperAgentsConfigPreProcessed,
} from '@shared/types/api/request/headers';
import { AgentOptions, type Skill } from '@shared/types/data';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@api/utils/embeddings', () => ({
  generateEmbeddingForRequest: vi.fn(),
}));
vi.mock('@api/utils/evaluation-model-resolver', () => ({
  agentById: vi.fn().mockResolvedValue(null),
  resolveEmbeddingModelConfig: vi.fn(),
}));
vi.mock('@api/optimization/skill-optimizations', () => ({
  handleGenerateArms: vi.fn(),
}));

const skill = {
  id: 'skill-1',
  agent_id: 'agent-1',
  name: 'routed-skill',
  configuration_count: 1,
  exploration_temperature: 1,
  allowed_template_variables: [],
} as unknown as Skill;

const requestData = {
  functionName: FunctionName.CHAT_COMPLETE,
  requestBody: {
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'hi' }],
  },
} as unknown as SuperAgentsRequestData;

/** A context carrying what the earlier middlewares would have set. */
const context = (
  preProcessed: SuperAgentsConfigPreProcessed,
  connector: Record<string, unknown>,
) => {
  const vars = new Map<string, unknown>([
    ['sa_config_pre_processed', preProcessed],
    ['sa_request_data', requestData],
    ['user_data_storage_connector', connector],
    ['skill', skill],
  ]);
  return {
    req: { url: 'http://localhost/v1/chat/completions' },
    get: (key: string) => vars.get(key),
    set: vi.fn((key: string, value: unknown) => vars.set(key, value)),
    json: vi.fn(
      (body: unknown, status: number) =>
        new Response(JSON.stringify(body), { status }),
    ),
  } as unknown as AppContext;
};

/** The last value the middleware stored under `key`. */
const setValue = (c: AppContext, key: string): unknown =>
  (vi.mocked(c.set).mock.calls as unknown as [string, unknown][])
    .filter(([name]) => name === key)
    .at(-1)?.[1];

describe('saConfigurationInjectorMiddleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(generateEmbeddingForRequest).mockResolvedValue([1, 0]);
  });

  it('fills the routed skill name into the resolved config', async () => {
    // The caller named only the agent; `agentAndSkillMiddleware` put the
    // skill it picked on the context, and the header never carried its name.
    const preProcessed = SuperAgentsConfigPreProcessed.parse({
      agent_name: 'helper',
      targets: [{ provider: 'openai', model: 'gpt-4o' }],
    });
    const c = context(preProcessed, {});
    const next = vi.fn();

    await saConfigurationInjectorMiddleware(c, next);

    expect(next).toHaveBeenCalled();
    const saConfig = setValue(c, 'sa_config') as SuperAgentsConfig;
    expect(saConfig.agent_name).toBe('helper');
    expect(saConfig.skill_name).toBe('routed-skill');
    expect(saConfig.targets[0].configuration.model).toBe('gpt-4o');
  });

  it('keeps a skill name the caller did give', async () => {
    const preProcessed = SuperAgentsConfigPreProcessed.parse({
      agent_name: 'helper',
      skill_name: 'named-skill',
      targets: [{ provider: 'openai', model: 'gpt-4o' }],
    });
    const c = context(preProcessed, {});

    await saConfigurationInjectorMiddleware(c, vi.fn());

    const saConfig = setValue(c, 'sa_config') as SuperAgentsConfig;
    expect(saConfig.skill_name).toBe('named-skill');
  });

  it('serves a request whose embedding failed, from the first cluster', async () => {
    // The embedding call can fail -- an input past the model's context
    // window, the provider down. The request cannot be matched to its
    // cluster, but refusing it with "No configuration_name or provider
    // defined" helps nobody: any cluster's arm serves it.
    vi.mocked(generateEmbeddingForRequest).mockRejectedValue(
      new Error('Embedding API returned 400'),
    );
    const preProcessed = SuperAgentsConfigPreProcessed.parse({
      agent_name: 'helper',
      skill_name: 'routed-skill',
    });
    const getSkillOptimizationArms = vi.fn().mockResolvedValue([
      {
        id: 'arm-1',
        cluster_id: 'cluster-1',
        params: {
          system_prompt: 'serve the request',
          model_id: 'model-1',
          temperature_min: 0.2,
          temperature_max: 0.4,
          top_p_min: 1,
          top_p_max: 1,
          frequency_penalty_min: 0,
          frequency_penalty_max: 0,
          presence_penalty_min: 0,
          presence_penalty_max: 0,
          thinking_min: null,
          thinking_max: null,
        },
      },
    ]);
    const c = context(preProcessed, {
      getSkillOptimizationClusters: vi.fn().mockResolvedValue([
        { id: 'cluster-1', centroid: [1, 0] },
        { id: 'cluster-2', centroid: [0, 1] },
      ]),
      getSkillOptimizationArms,
      getSkillOptimizationEvaluations: vi.fn().mockResolvedValue([]),
      getSkillOptimizationArmStats: vi.fn().mockResolvedValue([]),
      getModels: vi
        .fn()
        .mockResolvedValue([
          { id: 'model-1', model_name: 'qwen-test', ai_provider_id: 'prov-1' },
        ]),
      getAIProviderAPIKeyById: vi.fn().mockResolvedValue({
        ai_provider: 'ollama',
        api_key: null,
        custom_fields: {},
      }),
    });
    const next = vi.fn();

    await saConfigurationInjectorMiddleware(c, next);

    expect(next).toHaveBeenCalled();
    // Matched to the first cluster, since there is nothing to match with.
    expect(getSkillOptimizationArms).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ cluster_id: 'cluster-1' }),
    );
    const saConfig = setValue(c, 'sa_config') as SuperAgentsConfig;
    expect(saConfig.targets[0].configuration.model).toBe('qwen-test');
    expect(saConfig.targets[0].configuration.system_prompt).toBe(
      'serve the request',
    );
  });

  // A decision skill the gateway created has no policy yet: its arms carry
  // an empty prompt, and the request goes through as the caller sent it.
  it('serves an arm with an empty prompt as no system prompt', async () => {
    const preProcessed = SuperAgentsConfigPreProcessed.parse({
      agent_name: 'helper',
      skill_name: 'routed-skill',
    });
    const c = context(preProcessed, {
      getSkillOptimizationClusters: vi
        .fn()
        .mockResolvedValue([{ id: 'cluster-1', centroid: [1, 0] }]),
      getSkillOptimizationArms: vi.fn().mockResolvedValue([
        {
          id: 'arm-1',
          cluster_id: 'cluster-1',
          params: {
            system_prompt: '',
            model_id: 'model-1',
            temperature_min: 0,
            temperature_max: 0,
            top_p_min: 1,
            top_p_max: 1,
            frequency_penalty_min: 0,
            frequency_penalty_max: 0,
            presence_penalty_min: 0,
            presence_penalty_max: 0,
            thinking_min: null,
            thinking_max: null,
          },
        },
      ]),
      getSkillOptimizationEvaluations: vi.fn().mockResolvedValue([]),
      getSkillOptimizationArmStats: vi.fn().mockResolvedValue([]),
      getModels: vi.fn().mockResolvedValue([
        {
          id: 'model-1',
          model_name: 'drex-latest',
          ai_provider_id: 'prov-1',
        },
      ]),
      getAIProviderAPIKeyById: vi.fn().mockResolvedValue({
        ai_provider: 'nace',
        api_key: 'nace_sk_x',
        custom_fields: {},
      }),
    });
    const next = vi.fn();

    await saConfigurationInjectorMiddleware(c, next);

    expect(next).toHaveBeenCalled();
    const saConfig = setValue(c, 'sa_config') as SuperAgentsConfig;
    expect(saConfig.targets[0].configuration.system_prompt).toBeNull();
  });

  it('answers 422 when the optimized skill has no arms to serve with', async () => {
    // A skill without models has clusters but no arms -- a skill the gateway
    // created for an agent without default models, for instance.
    const preProcessed = SuperAgentsConfigPreProcessed.parse({
      agent_name: 'helper',
      skill_name: 'routed-skill',
    });
    vi.mocked(resolveEmbeddingModelConfig).mockResolvedValue({
      modelId: 'embed-model',
      dimensions: 2,
    } as never);
    const c = context(preProcessed, {
      getSkillOptimizationClusters: vi
        .fn()
        .mockResolvedValue([{ id: 'cluster-1', centroid: [1, 0] }]),
      getSkillOptimizationArms: vi.fn().mockResolvedValue([]),
      getSkillModels: vi.fn().mockResolvedValue([]),
      getSkillReadiness: vi.fn(),
      getRecentSkills: vi.fn(),
      getSkillSummaries: vi.fn(),
    });
    const next = vi.fn();

    const response = (await saConfigurationInjectorMiddleware(
      c,
      next,
    )) as Response;

    expect(next).not.toHaveBeenCalled();
    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain('routed-skill');
    expect(body.error).toContain('no configurations');
  });

  it('names the missing default models for a skill the gateway created', async () => {
    const preProcessed = SuperAgentsConfigPreProcessed.parse({
      agent_name: 'helper',
      skill_name: 'routed-skill',
    });
    vi.mocked(resolveEmbeddingModelConfig).mockResolvedValue({
      modelId: 'embed-model',
      dimensions: 2,
    } as never);
    const c = context(preProcessed, {
      getSkillOptimizationClusters: vi
        .fn()
        .mockResolvedValue([{ id: 'cluster-1', centroid: [1, 0] }]),
      getSkillOptimizationArms: vi.fn().mockResolvedValue([]),
      getSkillModels: vi.fn().mockResolvedValue([]),
    });
    (c.set as unknown as (k: string, v: unknown) => void)('skill', {
      ...skill,
      auto_created: true,
    });
    (c.set as unknown as (k: string, v: unknown) => void)('agent', {
      id: 'agent-1',
      name: 'helper',
    });

    const response = (await saConfigurationInjectorMiddleware(
      c,
      vi.fn(),
    )) as Response;

    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain('created automatically');
    expect(body.error).toContain('agent helper had no default models');
  });
});

/**
 * A skill with models has arms in every cluster, so a cluster without any is
 * a generation cut short -- a crash, or arms that once failed to read back.
 * It is repaired, and the request it would have refused is served.
 */
describe('saConfigurationInjectorMiddleware, a cluster left without arms', () => {
  const arm = (id: string, cluster: string) => ({
    id,
    cluster_id: cluster,
    params: {
      system_prompt: 'Be brief.',
      model_id: 'model-1',
      temperature_min: 0,
      temperature_max: 0,
      top_p_min: 1,
      top_p_max: 1,
      frequency_penalty_min: 0,
      frequency_penalty_max: 0,
      presence_penalty_min: 0,
      presence_penalty_max: 0,
      thinking_min: null,
      thinking_max: null,
    },
  });
  const preProcessed = SuperAgentsConfigPreProcessed.parse({
    agent_name: 'helper',
    skill_name: 'routed-skill',
  });
  /** A connector whose clusters have `arms`, for a skill with one model. */
  const servingConnector = (
    clusters: { id: string; centroid: number[] }[],
    getSkillOptimizationArms: ReturnType<typeof vi.fn>,
  ) => ({
    getSkillOptimizationClusters: vi.fn().mockResolvedValue(clusters),
    getSkillOptimizationArms,
    getSkillModels: vi.fn().mockResolvedValue([{ id: 'model-1' }]),
    getSkillOptimizationEvaluations: vi.fn().mockResolvedValue([]),
    getSkillOptimizationArmStats: vi.fn().mockResolvedValue([]),
    getModels: vi
      .fn()
      .mockResolvedValue([
        { id: 'model-1', model_name: 'gpt-4o', ai_provider_id: 'prov-1' },
      ]),
    getAIProviderAPIKeyById: vi.fn().mockResolvedValue({
      ai_provider: 'openai',
      api_key: 'sk-x',
      custom_fields: {},
    }),
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(generateEmbeddingForRequest).mockResolvedValue([1, 0]);
    vi.mocked(handleGenerateArms).mockResolvedValue(
      new Response(JSON.stringify({ updatedArms: [] }), {
        status: 200,
      }) as never,
    );
  });

  it('serves the request from the nearest cluster that can, and repairs its own', async () => {
    // Matched to the empty one by its embedding; the far one has arms.
    const armsOf: Record<string, unknown[]> = {
      empty: [],
      near: [arm('arm-near', 'near')],
      far: [arm('arm-far', 'far')],
    };
    const c = context(
      preProcessed,
      servingConnector(
        [
          { id: 'far', centroid: [-1, 0] },
          { id: 'empty', centroid: [1, 0] },
          { id: 'near', centroid: [1, 1] },
        ],
        vi.fn(
          async (_c, query: { cluster_id: string }) => armsOf[query.cluster_id],
        ),
      ),
    );
    const next = vi.fn();

    await saConfigurationInjectorMiddleware(c, next);

    expect(next).toHaveBeenCalled();
    expect((setValue(c, 'pulled_arm') as { id: string }).id).toBe('arm-near');
    await vi.waitFor(() =>
      expect(handleGenerateArms).toHaveBeenCalledWith(
        c,
        expect.anything(),
        'skill-1',
        'empty',
      ),
    );
  });

  it('waits for the repair when no cluster can serve the request', async () => {
    const getSkillOptimizationArms = vi
      .fn()
      .mockResolvedValueOnce([]) // the cluster it was matched to
      .mockResolvedValueOnce([]) // the repair's own look before it starts
      .mockResolvedValue([arm('arm-new', 'only')]); // what the repair made
    const c = context(
      preProcessed,
      servingConnector(
        [{ id: 'only', centroid: [1, 0] }],
        getSkillOptimizationArms,
      ),
    );
    const next = vi.fn();

    await saConfigurationInjectorMiddleware(c, next);

    expect(handleGenerateArms).toHaveBeenCalledWith(
      c,
      expect.anything(),
      'skill-1',
      'only',
    );
    expect(next).toHaveBeenCalled();
    expect((setValue(c, 'pulled_arm') as { id: string }).id).toBe('arm-new');
  });

  it('answers 422 when the repair could not make any', async () => {
    vi.mocked(handleGenerateArms).mockResolvedValue(
      new Response(JSON.stringify({ error: 'boom' }), { status: 500 }) as never,
    );
    const c = context(
      preProcessed,
      servingConnector(
        [{ id: 'only', centroid: [1, 0] }],
        vi.fn().mockResolvedValue([]),
      ),
    );

    const response = (await saConfigurationInjectorMiddleware(
      c,
      vi.fn(),
    )) as Response;

    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain(
      'has models, but no configurations could be generated',
    );
  });
});

describe('saConfigurationInjectorMiddleware reviewer', () => {
  const setAgent = (c: AppContext, agent: Record<string, unknown>) =>
    (c.set as unknown as (k: string, v: unknown) => void)('agent', agent);

  it('adds the agent reviewer as a blocking output hook the header cannot leave out', async () => {
    const preProcessed = SuperAgentsConfigPreProcessed.parse({
      agent_name: 'helper',
      skill_name: 'routed-skill',
      targets: [{ provider: 'openai', model: 'gpt-4o' }],
    });
    const getAgents = vi
      .fn()
      .mockResolvedValue([{ id: 'agent-2', name: 'guard' }]);
    const c = context(preProcessed, { getAgents });
    setAgent(c, {
      id: 'agent-1',
      name: 'helper',
      reviewer_agent_id: 'agent-2',
      review_fail_closed: true,
      review_expose_reason: false,
      options: AgentOptions.parse({ review: { timeout_ms: 120_000 } }),
    });

    await saConfigurationInjectorMiddleware(c, vi.fn());

    expect(getAgents).toHaveBeenCalledWith(c, { id: 'agent-2' });
    const saConfig = setValue(c, 'sa_config') as SuperAgentsConfig;
    expect(saConfig.hooks).toEqual([
      expect.objectContaining({
        id: 'reviewer:guard',
        type: 'output',
        hook_provider: 'agent',
        // The wait the reviewed agent allows, since its client waits it out.
        config: { agent_name: 'guard', timeout_ms: 120_000 },
        await: true,
        fail_closed: true,
      }),
    ]);
  });

  it('adds no hook to the review itself', async () => {
    const preProcessed = SuperAgentsConfigPreProcessed.parse({
      agent_name: 'guard',
      skill_name: 'routed-skill',
      targets: [{ provider: 'openai', model: 'gpt-4o' }],
      reviewing_trace_id: 'trace-1',
    });
    const getAgents = vi.fn();
    const c = context(preProcessed, { getAgents });
    setAgent(c, { id: 'agent-2', name: 'guard', reviewer_agent_id: 'agent-1' });

    await saConfigurationInjectorMiddleware(c, vi.fn());

    expect(getAgents).not.toHaveBeenCalled();
    const saConfig = setValue(c, 'sa_config') as SuperAgentsConfig;
    expect(saConfig.hooks).toEqual([]);
  });

  it('leaves the hooks alone for an agent without a reviewer', async () => {
    const preProcessed = SuperAgentsConfigPreProcessed.parse({
      agent_name: 'helper',
      skill_name: 'routed-skill',
      targets: [{ provider: 'openai', model: 'gpt-4o' }],
    });
    const c = context(preProcessed, {});
    setAgent(c, { id: 'agent-1', name: 'helper', reviewer_agent_id: null });

    await saConfigurationInjectorMiddleware(c, vi.fn());

    const saConfig = setValue(c, 'sa_config') as SuperAgentsConfig;
    expect(saConfig.hooks).toEqual([]);
  });
});
