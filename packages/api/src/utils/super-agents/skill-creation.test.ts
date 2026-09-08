import { handleGenerateArms } from '@api/optimization/skill-optimizations';
import { describeSkillForRequest } from '@api/optimization/utils/describe-skill';
import { generateEvaluationCreateParams } from '@api/optimization/utils/evaluations';
import type { UserDataStorageConnector } from '@api/types/connector';
import type { AppContext } from '@api/types/hono';
import { resolveEmbeddingModelConfig } from '@api/utils/evaluation-model-resolver';
import { judgeLogsWithoutRuns } from '@api/utils/super-agents/judge-backlog';
import {
  adoptDefaultModels,
  createSkillForRequest,
} from '@api/utils/super-agents/skill-creation';
import { FunctionName } from '@shared/types/api/request';
import type { SuperAgentsRequestData } from '@shared/types/api/request/body';
import type { Agent, Skill } from '@shared/types/data';
import { SkillEventType } from '@shared/types/data/skill-event';
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

vi.mock('@api/optimization/skill-optimizations', () => ({
  handleGenerateArms: vi.fn(),
}));
vi.mock('@api/optimization/utils/evaluations', () => ({
  generateEvaluationCreateParams: vi.fn(),
}));
vi.mock('@api/optimization/utils/describe-skill', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@api/optimization/utils/describe-skill')
  >()),
  describeSkillForRequest: vi.fn(),
}));
vi.mock('@api/utils/evaluation-model-resolver', () => ({
  agentById: vi.fn().mockResolvedValue(null),
  resolveRoleModel: vi.fn(),
  resolveEmbeddingModelConfig: vi.fn(),
}));
vi.mock('@api/utils/sse-event-manager', () => ({ emitSSEEvent: vi.fn() }));
vi.mock('@api/utils/super-agents/judge-backlog', () => ({
  judgeLogsWithoutRuns: vi.fn().mockResolvedValue(0),
}));

const c = {
  get: (key: string) => (key === 'evaluation_connectors_map' ? {} : undefined),
} as unknown as AppContext;
const agent = {
  id: '123e4567-e89b-12d3-a456-426614174000',
  name: 'helper',
  description: 'Helps guests of the restaurant with anything they need.',
} as Agent;
const request = {
  functionName: FunctionName.CHAT_COMPLETE,
  requestBody: {
    messages: [
      { role: 'system', content: 'You are a concierge.' },
      { role: 'user', content: 'a table for two' },
    ],
  },
} as unknown as SuperAgentsRequestData;
const cached = (embedding: number[]) => ({
  embedding,
  modelId: 'embed-model',
  absorbedBy: new Set<string>(),
});
const embedding = {
  identity: cached([1, 0, 0]),
  conversation: cached([0, 1, 0]),
  modelId: 'embed-model',
};

describe('createSkillForRequest', () => {
  let connector: Record<string, Mock>;

  const create = (existing: Skill[] = [], intentEmbedding = embedding) =>
    createSkillForRequest(
      c,
      connector as unknown as UserDataStorageConnector,
      agent,
      request,
      'You are a concierge.',
      intentEmbedding,
      existing,
    );

  beforeEach(() => {
    vi.clearAllMocks();
    connector = {
      createSkill: vi.fn().mockImplementation(async (_c, params) => ({
        ...params,
        id: 'skill-1',
      })),
      getSkills: vi.fn().mockResolvedValue([]),
      createSkillOptimizationClusters: vi.fn().mockResolvedValue([]),
      upsertSkillRouting: vi.fn(),
      claimSkillCreationLease: vi.fn(),
      releaseSkillCreationLease: vi.fn(),
      getAgentModels: vi.fn().mockResolvedValue([{ id: 'model-1' }]),
      addModelsToSkill: vi.fn(),
      createSkillEvent: vi.fn(),
      createSkillOptimizationEvaluations: vi.fn().mockResolvedValue([]),
    };
    vi.mocked(describeSkillForRequest).mockResolvedValue({
      name: 'concierge',
      description: 'Helps guests book tables and answers questions.',
    });
    vi.mocked(resolveEmbeddingModelConfig).mockResolvedValue({
      modelId: 'embed-model',
      dimensions: 3,
    } as never);
  });

  it('creates the skill from the caller prompt and makes it ready', async () => {
    const skill = await create();

    expect(skill.id).toBe('skill-1');
    expect(connector.createSkill).toHaveBeenCalledWith(
      c,
      expect.objectContaining({
        agent_id: '123e4567-e89b-12d3-a456-426614174000',
        name: 'concierge',
        description: 'Helps guests book tables and answers questions.',
        optimize: true,
        auto_created: true,
        seed_system_prompt: 'You are a concierge.',
      }),
    );
    // Clusters, then the routing row seeded from the request itself.
    expect(connector.createSkillOptimizationClusters).toHaveBeenCalledTimes(1);
    expect(connector.upsertSkillRouting).toHaveBeenCalledWith(c, {
      skill_id: 'skill-1',
      agent_id: '123e4567-e89b-12d3-a456-426614174000',
      centroid: [1, 0, 0],
      conversation_centroid: [0, 1, 0],
      embedding_model_id: 'embed-model',
      sample_count: 1,
      conversation_sample_count: 1,
    });
    // The agent's default models, and arms built from the seed prompt.
    expect(connector.addModelsToSkill).toHaveBeenCalledWith(c, 'skill-1', [
      'model-1',
    ]);
    expect(handleGenerateArms).toHaveBeenCalledWith(c, connector, 'skill-1');
    expect(connector.createSkillEvent).toHaveBeenCalledWith(
      c,
      expect.objectContaining({
        skill_id: 'skill-1',
        event_type: SkillEventType.AUTO_CREATED,
      }),
    );
  });

  it('suffixes the name when the agent already has it', async () => {
    await create([{ name: 'concierge' } as Skill]);

    expect(describeSkillForRequest).toHaveBeenCalledWith(
      c,
      connector,
      agent,
      'You are a concierge.',
      ['concierge'],
    );
    expect(connector.createSkill).toHaveBeenCalledWith(
      c,
      expect.objectContaining({ name: 'concierge-2' }),
    );
  });

  it('takes the winner of a race to the same name', async () => {
    const winner = { id: 'skill-0', name: 'concierge' } as Skill;
    connector.createSkill.mockRejectedValue(new Error('UNIQUE constraint'));
    connector.getSkills.mockResolvedValue([winner]);

    const skill = await create();

    expect(skill).toBe(winner);
    expect(connector.getSkills).toHaveBeenCalledWith(c, {
      agent_id: '123e4567-e89b-12d3-a456-426614174000',
      name: 'concierge',
    });
    expect(connector.createSkillOptimizationClusters).not.toHaveBeenCalled();
    expect(handleGenerateArms).not.toHaveBeenCalled();
  });

  it('leaves models and arms for later when the agent has no defaults', async () => {
    connector.getAgentModels.mockResolvedValue([]);

    await create();

    expect(connector.addModelsToSkill).not.toHaveBeenCalled();
    expect(handleGenerateArms).not.toHaveBeenCalled();
    expect(connector.createSkillEvent).toHaveBeenCalledWith(
      c,
      expect.objectContaining({
        metadata: expect.objectContaining({ model_count: 0 }),
      }),
    );
  });

  it('skips the routing row when the request could not be embedded', async () => {
    await create([], null as never);

    expect(connector.upsertSkillRouting).not.toHaveBeenCalled();
    expect(connector.createSkill).toHaveBeenCalled();
  });
});

describe('adoptDefaultModels', () => {
  let connector: Record<string, Mock>;
  const auto = (id: string, models: string[] = []) =>
    ({
      id,
      name: id,
      agent_id: agent.id,
      auto_created: true,
      models,
    }) as Skill & { models: string[] };
  const byHand = { id: 'manual', name: 'manual', auto_created: false } as Skill;

  beforeEach(() => {
    vi.clearAllMocks();
    connector = {
      getSkills: vi.fn(),
      getSkillModels: vi
        .fn()
        .mockImplementation((_c, skillId: string) =>
          Promise.resolve(skillId === 'equipped' ? [{ id: 'model-0' }] : []),
        ),
      addModelsToSkill: vi.fn(),
      getModels: vi
        .fn()
        .mockImplementation((_c, { id }: { id: string }) =>
          Promise.resolve([{ id, model_name: `name-of-${id}` }]),
        ),
      createSkillEvent: vi.fn(),
      getSkillOptimizationClusters: vi
        .fn()
        .mockResolvedValue([{ id: 'cluster-1' }]),
      createSkillOptimizationClusters: vi.fn().mockResolvedValue([]),
      getSkillOptimizationEvaluations: vi.fn().mockResolvedValue([]),
      createSkillOptimizationEvaluations: vi
        .fn()
        .mockImplementation((_c, list) => Promise.resolve(list)),
    };
    vi.mocked(generateEvaluationCreateParams).mockImplementation(
      (_c, skill, _evaluationConnector, method) =>
        Promise.resolve({
          agent_id: skill.agent_id,
          skill_id: skill.id,
          evaluation_method: method,
          params: {},
          weight: 1,
        }),
    );
  });

  it('gives the models to automatic skills that have none, with arms', async () => {
    connector.getSkills.mockResolvedValue([
      auto('bare'),
      auto('equipped'),
      byHand,
    ]);

    const equipped = await adoptDefaultModels(
      c,
      connector as unknown as UserDataStorageConnector,
      agent,
      ['model-1', 'model-2'],
    );

    expect(equipped.map((skill) => skill.id)).toEqual(['bare']);
    expect(connector.addModelsToSkill).toHaveBeenCalledTimes(1);
    expect(connector.addModelsToSkill).toHaveBeenCalledWith(c, 'bare', [
      'model-1',
      'model-2',
    ]);
    expect(connector.createSkillEvent).toHaveBeenCalledTimes(2);
    expect(connector.createSkillEvent).toHaveBeenCalledWith(
      c,
      expect.objectContaining({
        skill_id: 'bare',
        event_type: SkillEventType.MODEL_ADDED,
        metadata: { model_id: 'model-2', model_name: 'name-of-model-2' },
      }),
    );
    expect(handleGenerateArms).toHaveBeenCalledWith(c, connector, 'bare');
  });

  it('does nothing without models to give', async () => {
    connector.getSkills.mockResolvedValue([auto('bare')]);

    await expect(
      adoptDefaultModels(
        c,
        connector as unknown as UserDataStorageConnector,
        agent,
        [],
      ),
    ).resolves.toEqual([]);
    expect(connector.getSkills).not.toHaveBeenCalled();
  });

  /**
   * A skill created while system settings had no models fails its background
   * evaluation generation too, and nothing retries it on its own. Equipping
   * the skill is the user's repair, so the missing evaluations are generated
   * along with the models.
   */
  const cWithMethods = {
    get: (key: string) =>
      key === 'evaluation_connectors_map'
        ? { latency: {}, task_completion: {} }
        : undefined,
  } as unknown as AppContext;

  it('generates the evaluations an equipped skill is missing', async () => {
    connector.getSkills.mockResolvedValue([
      { ...auto('bare'), optimize: true },
    ]);

    const equipped = await adoptDefaultModels(
      cWithMethods,
      connector as unknown as UserDataStorageConnector,
      agent,
      ['model-1'],
    );

    expect(equipped.map((skill) => skill.id)).toEqual(['bare']);
    // Generation runs in the background, the same as at creation.
    await vi.waitFor(() => {
      expect(
        connector.createSkillOptimizationEvaluations,
      ).toHaveBeenCalledTimes(1);
      expect(connector.createSkillEvent).toHaveBeenCalledWith(
        cWithMethods,
        expect.objectContaining({
          skill_id: 'bare',
          event_type: SkillEventType.EVALUATION_ADDED,
          metadata: { evaluation_method: 'task_completion' },
        }),
      );
    });
    const [, created] =
      connector.createSkillOptimizationEvaluations.mock.calls[0];
    expect(
      (created as { evaluation_method: string }[])
        .map((params) => params.evaluation_method)
        .sort(),
    ).toEqual(['latency', 'task_completion']);
    // The requests answered while that ran are judged against what it made
    await vi.waitFor(() => {
      expect(judgeLogsWithoutRuns).toHaveBeenCalledWith(
        cWithMethods,
        connector,
        undefined,
        { latency: {}, task_completion: {} },
        expect.objectContaining({ id: 'bare' }),
        created,
      );
    });
  });

  it('leaves evaluations alone when the skill already has them', async () => {
    connector.getSkills.mockResolvedValue([
      { ...auto('bare'), optimize: true },
    ]);
    connector.getSkillOptimizationEvaluations.mockResolvedValue([
      { id: 'evaluation-1' },
    ]);

    await adoptDefaultModels(
      cWithMethods,
      connector as unknown as UserDataStorageConnector,
      agent,
      ['model-1'],
    );

    expect(connector.createSkillOptimizationEvaluations).not.toHaveBeenCalled();
  });

  it('creates the clusters an equipped skill is missing', async () => {
    // Created before system settings had an embedding model, so it has no
    // clusters -- and without clusters, no arms can be generated.
    connector.getSkills.mockResolvedValue([
      { ...auto('bare'), configuration_count: 2 },
    ]);
    connector.getSkillOptimizationClusters.mockResolvedValue([]);
    vi.mocked(resolveEmbeddingModelConfig).mockResolvedValue({
      modelId: 'embed-model',
      dimensions: 3,
    } as never);

    await adoptDefaultModels(
      c,
      connector as unknown as UserDataStorageConnector,
      agent,
      ['model-1'],
    );

    expect(connector.createSkillOptimizationClusters).toHaveBeenCalledTimes(1);
    const [, clusterParams] =
      connector.createSkillOptimizationClusters.mock.calls[0];
    expect(clusterParams).toHaveLength(2);
    expect(handleGenerateArms).toHaveBeenCalledWith(c, connector, 'bare');
  });

  it('leaves existing clusters alone', async () => {
    connector.getSkills.mockResolvedValue([auto('bare')]);

    await adoptDefaultModels(
      c,
      connector as unknown as UserDataStorageConnector,
      agent,
      ['model-1'],
    );

    expect(connector.createSkillOptimizationClusters).not.toHaveBeenCalled();
  });

  it('skips evaluations for a skill whose optimization is off', async () => {
    connector.getSkills.mockResolvedValue([
      { ...auto('bare'), optimize: false },
    ]);

    await adoptDefaultModels(
      cWithMethods,
      connector as unknown as UserDataStorageConnector,
      agent,
      ['model-1'],
    );

    expect(connector.getSkillOptimizationEvaluations).not.toHaveBeenCalled();
  });
});
