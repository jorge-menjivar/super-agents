import type {
  LogsStorageConnector,
  UserDataStorageConnector,
} from '@api/types/connector';
import type { AppContext } from '@api/types/hono';
import { runEvaluationsForLog } from '@api/utils/realtime-evaluations';
import { reevaluateLogFromFeedback } from '@api/utils/super-agents/feedback-reevaluation';
import type { Feedback } from '@shared/types/data/feedback';
import type { Log } from '@shared/types/data/log';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Thumbs up/down is the one evaluation with a human in it. What must hold:
 * the verdict reaches the judges as context, and the verdict-informed run
 * REPLACES the log's old runs -- the eval-score view averages every run of
 * a log, and the old scores are exactly what the human just corrected.
 */

vi.mock('@api/utils/realtime-evaluations', () => ({
  runEvaluationsForLog: vi.fn(),
}));
vi.mock('@api/utils/sse-event-manager', () => ({ emitSSEEvent: vi.fn() }));

const log = {
  id: 'log-1',
  agent_id: 'agent-1',
  skill_id: 'skill-1',
  cluster_id: 'cluster-1',
} as unknown as Log;

const feedbackOf = (score: number, feedback?: string | null): Feedback =>
  ({ id: 'feedback-1', log_id: 'log-1', score, feedback }) as Feedback;

const evaluations = [{ id: 'eval-1', evaluation_method: 'task_completion' }];
const newResults = [{ evaluation_id: 'eval-1', score: 0.2 }];

let userData: UserDataStorageConnector;
let logsStore: LogsStorageConnector;
let context: AppContext;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);

  userData = {
    getSkillOptimizationEvaluations: vi.fn().mockResolvedValue(evaluations),
    getSkillOptimizationEvaluationRuns: vi
      .fn()
      .mockResolvedValue([{ id: 'run-old-1' }, { id: 'run-old-2' }]),
    deleteSkillOptimizationEvaluationRun: vi.fn().mockResolvedValue(undefined),
    createSkillOptimizationEvaluationRun: vi
      .fn()
      .mockResolvedValue({ id: 'run-new' }),
  } as unknown as UserDataStorageConnector;
  logsStore = {
    getLogs: vi.fn().mockResolvedValue([log]),
    getLogSummaries: vi.fn(),
  } as unknown as LogsStorageConnector;

  const values: Record<string, unknown> = {
    user_data_storage_connector: userData,
    logs_storage_connector: logsStore,
    evaluation_connectors_map: {},
  };
  context = { get: (key: string) => values[key] } as unknown as AppContext;

  vi.mocked(runEvaluationsForLog).mockResolvedValue(
    newResults as unknown as Awaited<ReturnType<typeof runEvaluationsForLog>>,
  );
});

describe('reevaluateLogFromFeedback', () => {
  it('re-runs the evaluations with the human verdict and replaces the runs', async () => {
    await reevaluateLogFromFeedback(context, feedbackOf(0));

    // The judges are told a human verified the output as bad
    expect(runEvaluationsForLog).toHaveBeenCalledWith(
      context,
      log,
      evaluations,
      {},
      userData,
      { humanVerdict: 'bad' },
    );

    // The old runs are gone and the verdict-informed one stands alone
    expect(userData.deleteSkillOptimizationEvaluationRun).toHaveBeenCalledTimes(
      2,
    );
    expect(userData.createSkillOptimizationEvaluationRun).toHaveBeenCalledWith(
      context,
      {
        agent_id: 'agent-1',
        skill_id: 'skill-1',
        cluster_id: 'cluster-1',
        log_id: 'log-1',
        results: newResults,
      },
    );
  });

  it('maps a thumbs up to a good verdict', async () => {
    await reevaluateLogFromFeedback(context, feedbackOf(1));

    expect(vi.mocked(runEvaluationsForLog).mock.calls[0][5]).toEqual({
      humanVerdict: 'good',
    });
  });

  it("carries the reviewer's typed reason to the judges", async () => {
    await reevaluateLogFromFeedback(
      context,
      feedbackOf(0, 'It invented the citation.'),
    );

    expect(vi.mocked(runEvaluationsForLog).mock.calls[0][5]).toEqual({
      humanVerdict: 'bad',
      humanVerdictReason: 'It invented the citation.',
    });
  });

  it('sends no reason when the thumb came without one', async () => {
    // The column is nullable and both backends answer NULL for a bare
    // thumb; the judges must see an absent reason, not the string "null".
    await reevaluateLogFromFeedback(context, feedbackOf(0, null));

    expect(vi.mocked(runEvaluationsForLog).mock.calls[0][5]).toEqual({
      humanVerdict: 'bad',
      humanVerdictReason: undefined,
    });
  });

  it('keeps the old runs when the re-evaluation produces nothing', async () => {
    // Judges can all fail (provider down). Deleting the old runs first would
    // trade a stale score for no score at all.
    vi.mocked(runEvaluationsForLog).mockResolvedValue([]);

    await reevaluateLogFromFeedback(context, feedbackOf(0));

    expect(
      userData.deleteSkillOptimizationEvaluationRun,
    ).not.toHaveBeenCalled();
    expect(
      userData.createSkillOptimizationEvaluationRun,
    ).not.toHaveBeenCalled();
  });

  it('does nothing for a log that no longer exists', async () => {
    vi.mocked(logsStore.getLogs).mockResolvedValue([]);

    await reevaluateLogFromFeedback(context, feedbackOf(0));

    expect(runEvaluationsForLog).not.toHaveBeenCalled();
  });
});
