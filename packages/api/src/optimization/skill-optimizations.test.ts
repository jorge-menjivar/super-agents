import { handleGenerateArms } from '@api/optimization/skill-optimizations';
import { regenerateEvaluationsWithExamples } from '@api/optimization/utils/evaluations';
import { generateSeedSystemPromptWithContext } from '@api/optimization/utils/system-prompt';
import type {
  LogsStorageConnector,
  UserDataStorageConnector,
} from '@api/types/connector';
import type { AppContext } from '@api/types/hono';
import type { Skill } from '@shared/types/data';
import type { SkillOptimizationEvaluationCreateParams } from '@shared/types/data/skill-optimization-evaluation';
import { EvaluationMethodName } from '@shared/types/evaluations';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Rebuilding a skill's arms -- which every change to its models does --
 * regenerates its evaluations from real examples once it has five logs.
 * That used to delete the evaluations and insert new ones, which orphaned
 * every judge result the skill's logs had: a log's weighted score joins its
 * results back to the evaluation rows, so removing a model from a skill
 * blanked the scores of every log judged so far. The evaluations are
 * updated in place now and keep their ids.
 */

vi.mock('@api/middlewares/optimizer/system-prompt', () => ({
  generateExampleConversations: vi.fn(() => ['User: hi\nAssistant: hello']),
}));
vi.mock('@api/optimization/utils/evaluations', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@api/optimization/utils/evaluations')
  >()),
  regenerateEvaluationsWithExamples: vi.fn(),
}));
vi.mock('@api/optimization/utils/system-prompt', () => ({
  generateSeedSystemPromptForSkill: vi.fn(() => Promise.resolve('seed')),
  generateSeedSystemPromptWithContext: vi.fn(() =>
    Promise.resolve('seed, from examples'),
  ),
}));

const skill = {
  id: 'skill-1',
  agent_id: 'agent-1',
  description: 'Answers questions about candles.',
  seed_system_prompt: null,
} as unknown as Skill;

const existingEvaluations = [
  {
    id: 'eval-latency',
    evaluation_method: 'latency',
    params: { max_ms: 1_000 },
    weight: 1,
  },
  {
    id: 'eval-task',
    evaluation_method: 'task_completion',
    params: { criteria: 'answers' },
    weight: 1,
  },
];

const regenerated: SkillOptimizationEvaluationCreateParams[] = [
  {
    skill_id: 'skill-1',
    agent_id: 'agent-1',
    evaluation_method: EvaluationMethodName.TASK_COMPLETION,
    params: { criteria: 'answers the question about the candle' },
    weight: 2,
  },
  {
    skill_id: 'skill-1',
    agent_id: 'agent-1',
    evaluation_method: EvaluationMethodName.LATENCY,
    params: { max_ms: 5_000 },
    weight: 1,
  },
];

const setup = (
  logCount: number,
): { userData: UserDataStorageConnector; c: AppContext } => {
  const userData = {
    getSkills: vi.fn().mockResolvedValue([skill]),
    getAgents: vi
      .fn()
      .mockResolvedValue([{ id: 'agent-1', description: 'A support agent' }]),
    getSkillOptimizationEvaluations: vi
      .fn()
      .mockResolvedValue(existingEvaluations),
    updateSkillOptimizationEvaluation: vi.fn().mockResolvedValue(undefined),
    deleteSkillOptimizationEvaluationsForSkill: vi
      .fn()
      .mockResolvedValue(undefined),
    createSkillOptimizationEvaluations: vi.fn().mockResolvedValue([]),
    getSkillOptimizationArms: vi.fn().mockResolvedValue([]),
    getSkillOptimizationClusters: vi.fn().mockResolvedValue([]),
    updateSkillOptimizationCluster: vi.fn().mockResolvedValue(undefined),
    // No models: the rebuild stops after the evaluation step, the one under test
    getSkillModels: vi.fn().mockResolvedValue([]),
    getSkillReadiness: vi.fn(),
    getRecentSkills: vi.fn(),
    getSkillSummaries: vi.fn(),
  } as unknown as UserDataStorageConnector;
  const logsStore = {
    getLogs: vi
      .fn()
      .mockResolvedValue(
        Array.from({ length: logCount }, (_, i) => ({ id: `log-${i}` })),
      ),
  } as unknown as LogsStorageConnector;
  const variables: Record<string, unknown> = {
    logs_storage_connector: logsStore,
    evaluation_connectors_map: { latency: {}, task_completion: {} },
  };
  const c = {
    get: (key: string) => variables[key],
    json: vi.fn((body: unknown, status?: number) => ({ body, status })),
  } as unknown as AppContext;
  return { userData, c };
};

describe('handleGenerateArms', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(regenerateEvaluationsWithExamples).mockResolvedValue(regenerated);
  });

  it('regenerates the evaluations in place once the skill has five logs, keeping their ids', async () => {
    const { userData, c } = setup(5);

    await handleGenerateArms(c, userData, skill.id);

    expect(regenerateEvaluationsWithExamples).toHaveBeenCalledWith(
      c,
      skill,
      'A support agent',
      ['User: hi\nAssistant: hello'],
      expect.anything(),
      ['latency', 'task_completion'],
      userData,
    );
    expect(userData.updateSkillOptimizationEvaluation).toHaveBeenCalledTimes(2);
    expect(userData.updateSkillOptimizationEvaluation).toHaveBeenCalledWith(
      c,
      'eval-latency',
      { params: { max_ms: 5_000 } },
    );
    expect(userData.updateSkillOptimizationEvaluation).toHaveBeenCalledWith(
      c,
      'eval-task',
      // The regenerated criteria replace the old; the weight is the user's.
      { params: { criteria: 'answers the question about the candle' } },
    );
    // Deleting would orphan every score recorded against these evaluations
    expect(
      userData.deleteSkillOptimizationEvaluationsForSkill,
    ).not.toHaveBeenCalled();
    expect(userData.createSkillOptimizationEvaluations).not.toHaveBeenCalled();
  });

  it('leaves the evaluations alone before the skill has five logs', async () => {
    const { userData, c } = setup(3);

    await handleGenerateArms(c, userData, skill.id);

    expect(regenerateEvaluationsWithExamples).not.toHaveBeenCalled();
    expect(userData.updateSkillOptimizationEvaluation).not.toHaveBeenCalled();
    expect(
      userData.deleteSkillOptimizationEvaluationsForSkill,
    ).not.toHaveBeenCalled();
  });
});

// A prompt written from a skill's own requests has to keep what they rely
// on: the template variables its callers send, and the output schema they
// ask for. This path dropped both.
describe('handleGenerateArms, writing from real requests', () => {
  it('tells the writer the template variables and the response format', async () => {
    const schema = { type: 'json_schema', json_schema: { name: 'answer' } };
    const completed = (i: number) => ({
      id: `log-${i}`,
      skill_id: 'skill-1',
      end_time: 2,
      duration: 1,
      status: 200,
      ai_provider: 'openai',
      model: 'gpt-4o',
      cache_status: 'MISS',
      ai_provider_request_log: {
        request_body: i === 2 ? { response_format: schema } : {},
      },
    });
    const userData = {
      getSkills: vi
        .fn()
        .mockResolvedValue([
          { ...skill, allowed_template_variables: ['customer_tier'] },
        ]),
      getAgents: vi
        .fn()
        .mockResolvedValue([{ id: 'agent-1', description: 'A support agent' }]),
      getSkillOptimizationEvaluations: vi.fn().mockResolvedValue([]),
      getSkillOptimizationArms: vi.fn().mockResolvedValue([]),
      getSkillOptimizationClusters: vi
        .fn()
        .mockResolvedValue([{ id: 'cluster-1' }]),
      updateSkillOptimizationCluster: vi.fn().mockResolvedValue(undefined),
      getSkillModels: vi.fn().mockResolvedValue([{ id: 'model-1' }]),
      createSkillOptimizationArms: vi.fn().mockResolvedValue([]),
      deleteSkillOptimizationArmStats: vi.fn().mockResolvedValue(undefined),
    } as unknown as UserDataStorageConnector;
    const c = {
      get: (key: string) =>
        ({
          logs_storage_connector: {
            getLogs: vi
              .fn()
              .mockResolvedValue(
                Array.from({ length: 5 }, (_, i) => completed(i)),
              ),
          },
          evaluation_connectors_map: {},
        })[key],
      json: vi.fn((body: unknown, status?: number) => ({ body, status })),
    } as unknown as AppContext;

    await handleGenerateArms(c, userData, skill.id);

    const call = vi.mocked(generateSeedSystemPromptWithContext).mock.calls[0];
    expect(call[5]).toEqual(schema);
    expect(call[6]).toEqual(['customer_tier']);
  });
});
