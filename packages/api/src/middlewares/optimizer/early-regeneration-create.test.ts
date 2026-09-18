import { checkAndRegenerateEvaluationsEarly } from '@api/middlewares/optimizer/evaluations';
import { repairSkillNaming } from '@api/optimization/utils/describe-skill';
import { regenerateEvaluationsWithExamples } from '@api/optimization/utils/evaluations';
import { generateSeedSystemPromptWithContext } from '@api/optimization/utils/system-prompt';
import { createMockContext } from '@api/test-utils/mock-context';
import type {
  EvaluationMethodConnector,
  LogsStorageConnector,
  UserDataStorageConnector,
} from '@api/types/connector';
import { judgeLogsWithoutRuns } from '@api/utils/super-agents/judge-backlog';
import { FunctionName } from '@shared/types/api/request';
import type { Skill } from '@shared/types/data';
import type { Log } from '@shared/types/data/log';
import { SkillEventType } from '@shared/types/data/skill-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * What the early pass *writes* once the guards let it through -- the
 * counterpart of `early-regeneration.test.ts`, which exercises only the
 * early returns. The model calls are mocked out here.
 *
 * The case that matters most: a skill the gateway created can reach this
 * pass with no evaluations at all, because creation generates them in the
 * background and that can fail -- system settings without an evaluation
 * model yet, a provider down -- with nothing else retrying. The pass is the
 * retry: an auto-created skill with none gets every method the server has,
 * rather than burning its one regeneration on an empty list.
 */

vi.mock('@api/optimization/utils/system-prompt', () => ({
  generateSeedSystemPromptWithContext: vi.fn(() =>
    Promise.resolve('a prompt improved from real examples'),
  ),
}));
vi.mock('@api/optimization/utils/evaluations', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@api/optimization/utils/evaluations')
  >()),
  regenerateEvaluationsWithExamples: vi.fn(),
}));
vi.mock('@api/utils/sse-event-manager', () => ({ emitSSEEvent: vi.fn() }));
vi.mock('@api/utils/super-agents/judge-backlog', () => ({
  judgeLogsWithoutRuns: vi.fn().mockResolvedValue(0),
}));
vi.mock('@api/optimization/utils/describe-skill', () => ({
  repairSkillNaming: vi.fn().mockResolvedValue(null),
}));

const mockContext = createMockContext();

const uuid = (n: number): string =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const skillOf = (overrides: Partial<Skill> = {}): Skill =>
  ({
    id: uuid(1),
    agent_id: uuid(2),
    description: 'Writes SQL queries for the analytics database.',
    auto_created: true,
    evaluations_regenerated_at: null,
    evaluation_lock_acquired_at: null,
    ...overrides,
  }) as Skill;

/** A log that extracts cleanly into one example conversation. */
const usableLog = (): Log =>
  ({
    id: uuid(4),
    ai_provider_request_log: {
      method: 'POST',
      request_url: 'https://api.openai.com/v1/chat/completions',
      request_body: {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'How many users signed up?' }],
      },
      response_body: {
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: 1677652288,
        model: 'gpt-4',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'SELECT count(*) ...' },
            finish_reason: 'stop',
          },
        ],
      },
    },
  }) as unknown as Log;

const connectorsMap = {
  latency: {} as EvaluationMethodConnector,
  task_completion: {} as EvaluationMethodConnector,
};

type Evaluation = { id: string; evaluation_method: string };

const connectors = (
  skill: Skill,
  existingEvaluations: Evaluation[],
): { userData: UserDataStorageConnector; logsStore: LogsStorageConnector } => {
  // First read passes the guards; the read-back after taking the lock has to
  // show the very lock this run wrote, which fake timers pin down.
  const lockTime = new Date().toISOString();
  const getSkills = vi
    .fn()
    .mockResolvedValueOnce([skill])
    .mockResolvedValue([{ ...skill, evaluation_lock_acquired_at: lockTime }]);

  return {
    userData: {
      getSkills,
      updateSkill: vi.fn().mockResolvedValue(undefined),
      getSkillOptimizationEvaluations: vi
        .fn()
        .mockResolvedValue(existingEvaluations),
      createSkillOptimizationEvaluations: vi
        .fn()
        .mockImplementation((_c, list: { evaluation_method: string }[]) =>
          Promise.resolve(
            list.map((params, index) => ({ ...params, id: `made-${index}` })),
          ),
        ),
      updateSkillOptimizationEvaluation: vi.fn().mockResolvedValue(undefined),
      createSkillEvent: vi.fn().mockResolvedValue(undefined),
      getSkillOptimizationArms: vi.fn().mockResolvedValue([]),
      getSkillOptimizationClusters: vi.fn().mockResolvedValue([]),
    } as unknown as UserDataStorageConnector,
    logsStore: {
      getLogs: vi.fn().mockResolvedValue(Array.from({ length: 5 }, usableLog)),
      getLogSummaries: vi.fn(),
    } as unknown as LogsStorageConnector,
  };
};

const run = (
  userData: UserDataStorageConnector,
  logsStore: LogsStorageConnector,
  skill: Skill,
): Promise<void> =>
  checkAndRegenerateEvaluationsEarly(
    mockContext,
    FunctionName.CHAT_COMPLETE,
    userData,
    logsStore,
    skill,
    'an agent that answers analytics questions',
    connectorsMap,
  );

beforeEach(() => {
  vi.mocked(repairSkillNaming).mockResolvedValue(null);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-03-01T12:00:00.000Z'));
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.mocked(regenerateEvaluationsWithExamples).mockImplementation(
    (_c, skill, _description, _examples, _map, methods) =>
      Promise.resolve(
        methods.map((method) => ({
          agent_id: skill.agent_id,
          skill_id: skill.id,
          evaluation_method: method,
          params: {},
          weight: 1,
        })),
      ),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('checkAndRegenerateEvaluationsEarly, past the guards', () => {
  it('creates every evaluation for an auto-created skill that has none', async () => {
    const skill = skillOf();
    const { userData, logsStore } = connectors(skill, []);

    await run(userData, logsStore, skill);

    expect(regenerateEvaluationsWithExamples).toHaveBeenCalledTimes(1);
    expect(
      vi.mocked(regenerateEvaluationsWithExamples).mock.calls[0][5],
    ).toEqual(['latency', 'task_completion']);
    expect(userData.createSkillOptimizationEvaluations).toHaveBeenCalledWith(
      mockContext,
      [
        expect.objectContaining({ evaluation_method: 'latency' }),
        expect.objectContaining({ evaluation_method: 'task_completion' }),
      ],
    );
    for (const method of ['latency', 'task_completion']) {
      expect(userData.createSkillEvent).toHaveBeenCalledWith(
        mockContext,
        expect.objectContaining({
          skill_id: skill.id,
          event_type: SkillEventType.EVALUATION_ADDED,
          metadata: { evaluation_method: method },
        }),
      );
    }
    // Every request so far was answered against no evaluations: judged now
    expect(judgeLogsWithoutRuns).toHaveBeenCalledWith(
      mockContext,
      userData,
      logsStore,
      connectorsMap,
      skill,
      [
        expect.objectContaining({ id: 'made-0', evaluation_method: 'latency' }),
        expect.objectContaining({
          id: 'made-1',
          evaluation_method: 'task_completion',
        }),
      ],
    );
    // And the pass completed: the one-shot flag is set with the lock released.
    expect(userData.updateSkill).toHaveBeenLastCalledWith(
      mockContext,
      skill.id,
      expect.objectContaining({
        evaluations_regenerated_at: new Date().toISOString(),
        evaluation_lock_acquired_at: null,
      }),
    );
    expect(console.error).not.toHaveBeenCalled();
  });

  it('rewrites existing evaluations in place, creating none', async () => {
    const skill = skillOf();
    const existing = [{ id: 'evaluation-1', evaluation_method: 'latency' }];
    const { userData, logsStore } = connectors(skill, existing);

    await run(userData, logsStore, skill);

    expect(
      vi.mocked(regenerateEvaluationsWithExamples).mock.calls[0][5],
    ).toEqual(['latency']);
    expect(userData.updateSkillOptimizationEvaluation).toHaveBeenCalledWith(
      mockContext,
      'evaluation-1',
      { params: {}, weight: 1 },
    );
    expect(userData.createSkillOptimizationEvaluations).not.toHaveBeenCalled();
    expect(judgeLogsWithoutRuns).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  it('builds the regenerated prompt and evaluations on a repaired naming', async () => {
    // A skill created while system settings had no models kept the
    // heuristic fallback naming; this pass repairs it first, so everything
    // regenerated here describes the job with the real words.
    const skill = skillOf();
    const { userData, logsStore } = connectors(skill, []);
    vi.mocked(repairSkillNaming).mockResolvedValue({
      name: 'answer-analytics-questions',
      description: 'Answers questions about the analytics warehouse.',
    });

    await run(userData, logsStore, skill);

    expect(repairSkillNaming).toHaveBeenCalledWith(
      mockContext,
      userData,
      skill,
      'an agent that answers analytics questions',
      expect.stringContaining('How many users signed up?'),
    );
    expect(
      vi.mocked(generateSeedSystemPromptWithContext).mock.calls[0][2],
    ).toBe('Answers questions about the analytics warehouse.');
    expect(
      vi.mocked(regenerateEvaluationsWithExamples).mock.calls[0][1],
    ).toEqual(
      expect.objectContaining({
        description: 'Answers questions about the analytics warehouse.',
      }),
    );
    expect(console.error).not.toHaveBeenCalled();
  });

  it('creates nothing for a hand-made skill without evaluations', async () => {
    // Evaluations on a hand-made skill are the user's own configuration;
    // absent ones stay absent rather than being invented here.
    const skill = skillOf({ auto_created: false });
    const { userData, logsStore } = connectors(skill, []);

    await run(userData, logsStore, skill);

    expect(
      vi.mocked(regenerateEvaluationsWithExamples).mock.calls[0][5],
    ).toEqual([]);
    expect(userData.createSkillOptimizationEvaluations).not.toHaveBeenCalled();
    expect(userData.updateSkillOptimizationEvaluation).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });
});
