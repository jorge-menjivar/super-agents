import type {
  EvaluationMethodConnector,
  LogsStorageConnector,
  UserDataStorageConnector,
} from '@api/types/connector';
import type { AppContext } from '@api/types/hono';
import { runEvaluationsForLog } from '@api/utils/realtime-evaluations';
import { emitSSEEvent } from '@api/utils/sse-event-manager';
import { judgeLogsWithoutRuns } from '@api/utils/super-agents/judge-backlog';
import type {
  Log,
  Skill,
  SkillOptimizationEvaluation,
} from '@shared/types/data';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@api/utils/realtime-evaluations', () => ({
  runEvaluationsForLog: vi.fn(),
}));
vi.mock('@api/utils/sse-event-manager', () => ({ emitSSEEvent: vi.fn() }));

const c = {} as AppContext;
const skill = { id: 'skill-1', name: 'answer-questions' } as Skill;
const connectorsMap = { latency: {} as EvaluationMethodConnector };

// The evaluations landed at 12:00:10
const evaluations = [
  { id: 'e1', created_at: '2026-03-01T12:00:10.000Z' },
  { id: 'e2', created_at: '2026-03-01T12:00:10.050Z' },
] as SkillOptimizationEvaluation[];

const at = (iso: string): number => Date.parse(iso);
const log = (id: string, start: string, duration: number): Log =>
  ({
    id,
    agent_id: 'agent-1',
    skill_id: 'skill-1',
    cluster_id: 'cluster-1',
    status: 200,
    start_time: at(start),
    duration,
  }) as Log;

// Answered before the evaluations existed; answered before, but judged by
// its own path in the meantime; still running when they landed
const skipped = log('skipped', '2026-03-01T11:59:50.000Z', 10_000);
const raced = log('raced', '2026-03-01T11:59:55.000Z', 1_000);
const later = log('later', '2026-03-01T12:00:09.900Z', 500);

const result = { evaluation_id: 'e1', method: 'latency', score: 1 };

const setup = (): {
  userData: UserDataStorageConnector;
  logsStore: LogsStorageConnector;
} => ({
  userData: {
    getSkillOptimizationEvaluationRuns: vi
      .fn()
      .mockImplementation((_c, { log_id }: { log_id: string }) =>
        Promise.resolve(log_id === 'raced' ? [{ id: 'run-raced' }] : []),
      ),
    createSkillOptimizationEvaluationRun: vi
      .fn()
      .mockImplementation((_c, params) =>
        Promise.resolve({ id: 'run-new', ...params }),
      ),
  } as unknown as UserDataStorageConnector,
  logsStore: {
    getLogs: vi.fn().mockResolvedValue([skipped, raced, later]),
    getLogSummaries: vi.fn(),
  } as unknown as LogsStorageConnector,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(runEvaluationsForLog).mockResolvedValue([result] as never);
});

describe('judgeLogsWithoutRuns', () => {
  it('judges the requests answered before the evaluations existed, storing a run once', async () => {
    const { userData, logsStore } = setup();

    const judged = await judgeLogsWithoutRuns(
      c,
      userData,
      logsStore,
      connectorsMap,
      skill,
      evaluations,
    );

    expect(logsStore.getLogs).toHaveBeenCalledWith(c, {
      skill_id: 'skill-1',
      status: 200,
      unjudged: true,
      order: 'asc',
      limit: 50,
    });
    // The request still running when they landed finds them on its own
    const judgedIds = vi
      .mocked(runEvaluationsForLog)
      .mock.calls.map(([, judgedLog]) => judgedLog.id);
    expect(judgedIds).toEqual(['skipped', 'raced']);
    // The one its own path judged meanwhile is not stored twice
    expect(userData.createSkillOptimizationEvaluationRun).toHaveBeenCalledTimes(
      1,
    );
    expect(userData.createSkillOptimizationEvaluationRun).toHaveBeenCalledWith(
      c,
      {
        agent_id: 'agent-1',
        skill_id: 'skill-1',
        cluster_id: 'cluster-1',
        log_id: 'skipped',
        results: [result],
      },
    );
    expect(emitSSEEvent).toHaveBeenCalledWith(
      'skill-optimization:evaluation-run-created',
      expect.objectContaining({ logId: 'skipped', skillId: 'skill-1' }),
    );
    expect(judged).toBe(1);
  });

  it('stores nothing for a log the judges produced no result for', async () => {
    const { userData, logsStore } = setup();
    vi.mocked(runEvaluationsForLog).mockResolvedValue([]);

    const judged = await judgeLogsWithoutRuns(
      c,
      userData,
      logsStore,
      connectorsMap,
      skill,
      evaluations,
    );

    expect(
      userData.createSkillOptimizationEvaluationRun,
    ).not.toHaveBeenCalled();
    expect(judged).toBe(0);
  });

  it('does nothing without a logs store, judges, or evaluations', async () => {
    const { userData, logsStore } = setup();

    expect(
      await judgeLogsWithoutRuns(
        c,
        userData,
        undefined,
        connectorsMap,
        skill,
        evaluations,
      ),
    ).toBe(0);
    expect(
      await judgeLogsWithoutRuns(
        c,
        userData,
        logsStore,
        undefined,
        skill,
        evaluations,
      ),
    ).toBe(0);
    expect(
      await judgeLogsWithoutRuns(
        c,
        userData,
        logsStore,
        connectorsMap,
        skill,
        [],
      ),
    ).toBe(0);
    expect(logsStore.getLogs).not.toHaveBeenCalled();
  });
});
