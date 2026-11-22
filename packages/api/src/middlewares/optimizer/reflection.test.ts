import {
  acquireReflectionLock,
  autoGenerateSystemPromptsForSkill,
  fetchReflectionExamples,
  performReflection,
} from '@api/middlewares/optimizer/system-prompt';
import { generateReflectiveSystemPromptForSkill } from '@api/optimization/utils/system-prompt';
import { createMockContext } from '@api/test-utils/mock-context';
import type {
  LogsStorageConnector,
  UserDataStorageConnector,
} from '@api/types/connector';
import { FunctionName } from '@shared/types/api/request';
import type {
  Skill,
  SkillOptimizationArm,
  SkillOptimizationCluster,
} from '@shared/types/data';
import { SkillEventType } from '@shared/types/data/skill-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The prompt writer is a model call; what reflection does around it is what
// is tested here.
vi.mock('@api/optimization/utils/system-prompt', () => ({
  generateReflectiveSystemPromptForSkill: vi
    .fn()
    .mockResolvedValue('a freshly written prompt'),
}));

/**
 * Reflection: the step that rewrites a cluster's arms once enough requests have
 * been served.
 *
 * Two things here are load-bearing and silent. The update is deliberately
 * conservative -- the best-performing arm is left completely intact, so a
 * regeneration can never destroy the configuration that is currently winning --
 * and the whole cycle is guarded by a lock, because two concurrent requests
 * regenerating the same cluster would each overwrite the other's work. Break
 * either and the system still answers every request; it just stops improving.
 */

const mockContext = createMockContext();

const uuid = (n: number): string =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const skill = {
  id: uuid(1),
  agent_id: uuid(2),
} as Skill;

const cluster = (
  overrides: Partial<SkillOptimizationCluster> = {},
): SkillOptimizationCluster =>
  ({
    id: uuid(3),
    skill_id: skill.id,
    agent_id: skill.agent_id,
    total_steps: 99,
    reflection_lock_acquired_at: null,
    ...overrides,
  }) as SkillOptimizationCluster;

const arm = (id: string, systemPrompt: string, temperature: number) =>
  ({
    id,
    skill_id: skill.id,
    cluster_id: uuid(3),
    params: {
      system_prompt: systemPrompt,
      temperature_min: temperature,
      temperature_max: temperature,
      model_id: uuid(9),
    },
  }) as unknown as SkillOptimizationArm;

/** Maps arms to their weighted means, which is what reflection sorts on. */
const statsFor = (
  entries: [SkillOptimizationArm, number, number][],
): Map<
  string,
  { n: number; weighted_mean: number; arm: SkillOptimizationArm }
> =>
  new Map(
    entries.map(([a, weightedMean, n]) => [
      a.id,
      { n, weighted_mean: weightedMean, arm: a },
    ]),
  );

const connector = () =>
  ({
    updateSkillOptimizationArm: vi.fn().mockResolvedValue(undefined),
    deleteSkillOptimizationArmStats: vi.fn().mockResolvedValue(undefined),
    updateSkillOptimizationCluster: vi.fn().mockResolvedValue(undefined),
    createSkillEvent: vi.fn().mockResolvedValue(undefined),
    getSkillOptimizationClusters: vi.fn(),
  }) as unknown as UserDataStorageConnector;

/** Arm ids passed to `updateSkillOptimizationArm`, in call order. */
const updatedArmIds = (c: UserDataStorageConnector): string[] =>
  vi
    .mocked(c.updateSkillOptimizationArm)
    .mock.calls.map(([, armId]) => armId as string);

const updateFor = (
  c: UserDataStorageConnector,
  armId: string,
): { params: Record<string, unknown> } | undefined =>
  vi
    .mocked(c.updateSkillOptimizationArm)
    .mock.calls.find(([, id]) => id === armId)?.[2] as
    | { params: Record<string, unknown> }
    | undefined;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('performReflection', () => {
  const best = arm('best', 'the winning prompt', 0.2);
  const middle = arm('middle', 'a mediocre prompt', 0.5);
  const worst = arm('worst', 'a losing prompt', 0.9);
  const arms = [worst, best, middle];
  const stats = statsFor([
    [best, 0.9, 40],
    [middle, 0.5, 30],
    [worst, 0.1, 20],
  ]);

  it('leaves the best arm completely untouched', async () => {
    /**
     * The guarantee the whole algorithm rests on. If the winning configuration
     * were rewritten on every cycle, the optimizer would keep discarding what
     * it had learned and never converge -- while still answering every request,
     * so nothing would look wrong.
     */
    const c = connector();

    await performReflection(
      mockContext,
      c,
      cluster(),
      skill,
      arms,
      stats,
      'a freshly written prompt',
      best,
    );

    expect(updatedArmIds(c)).not.toContain('best');
    const deleted = vi
      .mocked(c.deleteSkillOptimizationArmStats)
      .mock.calls.map(([, query]) => (query as { arm_id: string }).arm_id);
    expect(deleted).not.toContain('best');
  });

  it('gives the worst arm the best arm’s parameters and the new prompt', async () => {
    // The worst arm is the one being abandoned, so it restarts from what is
    // currently working rather than from its own losing configuration.
    const c = connector();

    await performReflection(
      mockContext,
      c,
      cluster(),
      skill,
      arms,
      stats,
      'a freshly written prompt',
      best,
    );

    const update = updateFor(c, 'worst');
    expect(update?.params.system_prompt).toBe('a freshly written prompt');
    expect(update?.params.temperature_min).toBe(0.2);
    expect(update?.params.temperature_max).toBe(0.2);
  });

  it('changes only the prompt on a middle arm, keeping its own parameters', async () => {
    // Middle arms are still contributing information about their own
    // hyperparameters, so only the prompt is replaced.
    const c = connector();

    await performReflection(
      mockContext,
      c,
      cluster(),
      skill,
      arms,
      stats,
      'a freshly written prompt',
      best,
    );

    const update = updateFor(c, 'middle');
    expect(update?.params.system_prompt).toBe('a freshly written prompt');
    expect(update?.params.temperature_min).toBe(0.5);
  });

  it('clears the history of every arm it rewrites', async () => {
    // A rewritten arm's past rewards were earned by a different prompt, so
    // keeping them would let a stale record decide future selections.
    const c = connector();

    await performReflection(
      mockContext,
      c,
      cluster(),
      skill,
      arms,
      stats,
      'a freshly written prompt',
      best,
    );

    const deleted = vi
      .mocked(c.deleteSkillOptimizationArmStats)
      .mock.calls.map(([, query]) => (query as { arm_id: string }).arm_id);
    expect(deleted.sort()).toEqual(['middle', 'worst']);
  });

  it('ranks by weighted mean rather than by the order it was given', async () => {
    // The input order here is deliberately the reverse of the ranking.
    const c = connector();

    await performReflection(
      mockContext,
      c,
      cluster(),
      skill,
      [best, middle, worst],
      statsFor([
        [best, 0.1, 40],
        [middle, 0.5, 30],
        [worst, 0.9, 20],
      ]),
      'a freshly written prompt',
      worst,
    );

    // `worst` now has the highest mean, so it is the one left alone.
    expect(updatedArmIds(c)).not.toContain('worst');
    expect(updatedArmIds(c).sort()).toEqual(['best', 'middle']);
  });

  it('resets the cluster step count to the best arm’s request count', async () => {
    // Steps drive the next reflection's threshold; leaving the old total would
    // schedule the following cycle against work that no longer exists.
    const c = connector();

    await performReflection(
      mockContext,
      c,
      cluster({ total_steps: 99 }),
      skill,
      arms,
      stats,
      'a freshly written prompt',
      best,
    );

    expect(c.updateSkillOptimizationCluster).toHaveBeenCalledWith(
      mockContext,
      uuid(3),
      { total_steps: 40 },
    );
  });

  it('records a reflection event', async () => {
    const c = connector();

    await performReflection(
      mockContext,
      c,
      cluster(),
      skill,
      arms,
      stats,
      'a freshly written prompt',
      best,
    );

    expect(c.createSkillEvent).toHaveBeenCalledWith(
      mockContext,
      expect.objectContaining({
        skill_id: skill.id,
        agent_id: skill.agent_id,
        cluster_id: uuid(3),
        event_type: SkillEventType.REFLECTION,
      }),
    );
  });

  it('treats the second of two arms as the worst', async () => {
    // With two arms there is no middle: one is kept, one is reset onto the
    // winner's configuration.
    const c = connector();
    const pair = [best, worst];

    await performReflection(
      mockContext,
      c,
      cluster(),
      skill,
      pair,
      statsFor([
        [best, 0.8, 10],
        [worst, 0.2, 10],
      ]),
      'a freshly written prompt',
      best,
    );

    expect(updatedArmIds(c)).toEqual(['worst']);
    expect(updateFor(c, 'worst')?.params.temperature_min).toBe(0.2);
  });

  it('updates nothing when the cluster holds a single arm', async () => {
    // That arm is simultaneously best and worst; "best" wins, so it survives.
    const c = connector();

    await performReflection(
      mockContext,
      c,
      cluster(),
      skill,
      [best],
      statsFor([[best, 0.7, 15]]),
      'a freshly written prompt',
      best,
    );

    expect(c.updateSkillOptimizationArm).not.toHaveBeenCalled();
    expect(c.deleteSkillOptimizationArmStats).not.toHaveBeenCalled();
    // The cycle still closes: steps are reset and the event is recorded.
    expect(c.updateSkillOptimizationCluster).toHaveBeenCalled();
    expect(c.createSkillEvent).toHaveBeenCalled();
  });

  it('protects the top-ranked arm even when told a different one is best', async () => {
    /**
     * `bestArm` arrives as an argument while the ranking is recomputed here
     * from the stats, so the two could disagree. Pinned to document which wins:
     * the arm left intact is the top of the ranking, while the parameters
     * copied onto the worst arm come from the argument.
     */
    const c = connector();

    await performReflection(
      mockContext,
      c,
      cluster(),
      skill,
      arms,
      stats,
      'a freshly written prompt',
      // `middle` is not the top-ranked arm.
      middle,
    );

    expect(updatedArmIds(c)).not.toContain('best');
    expect(updatedArmIds(c)).toContain('middle');
    expect(updateFor(c, 'worst')?.params.temperature_min).toBe(0.5);
  });
});

describe('acquireReflectionLock', () => {
  const clusterId = uuid(3);

  const lockConnector = (
    reads: (SkillOptimizationCluster[] | undefined)[],
  ): UserDataStorageConnector => {
    const getClusters = vi.fn();
    for (const read of reads) {
      getClusters.mockResolvedValueOnce(read ?? []);
    }
    return {
      getSkillOptimizationClusters: getClusters,
      updateSkillOptimizationCluster: vi.fn().mockResolvedValue(undefined),
      // The lock window is derived from the timeouts the lock guards; at
      // their defaults the floor still wins, so these tests read as before.
      getSystemSettings: vi.fn().mockResolvedValue({
        options: {
          system_prompt_reflection: { timeout_ms: 120_000 },
          evaluation_generation: { timeout_ms: 120_000 },
        },
      }),
    } as unknown as UserDataStorageConnector;
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-03-01T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('acquires the lock when the cluster is unlocked', async () => {
    const now = new Date().toISOString();
    const c = lockConnector([
      [cluster({ reflection_lock_acquired_at: null })],
      [cluster({ reflection_lock_acquired_at: now })],
    ]);

    expect(await acquireReflectionLock(mockContext, c, skill, clusterId)).toBe(
      now,
    );
    expect(c.updateSkillOptimizationCluster).toHaveBeenCalledWith(
      mockContext,
      clusterId,
      { reflection_lock_acquired_at: now },
    );
  });

  it('refuses when another run holds a fresh lock', async () => {
    // The case the lock exists for: a second concurrent request must not start
    // its own regeneration of the same cluster.
    const heldAt = new Date(Date.now() - 60_000).toISOString();
    const c = lockConnector([
      [cluster({ reflection_lock_acquired_at: heldAt })],
    ]);

    expect(
      await acquireReflectionLock(mockContext, c, skill, clusterId),
    ).toBeNull();
    expect(c.updateSkillOptimizationCluster).not.toHaveBeenCalled();
  });

  it('takes over a lock left behind more than ten minutes ago', async () => {
    // Without an expiry, a process that died mid-reflection would block the
    // cluster from ever being regenerated again.
    const now = new Date().toISOString();
    const stale = new Date(Date.now() - 11 * 60_000).toISOString();
    const c = lockConnector([
      [cluster({ reflection_lock_acquired_at: stale })],
      [cluster({ reflection_lock_acquired_at: now })],
    ]);

    expect(await acquireReflectionLock(mockContext, c, skill, clusterId)).toBe(
      now,
    );
  });

  it('holds a lock taken just under the timeout', async () => {
    const justInside = new Date(Date.now() - 9 * 60_000).toISOString();
    const c = lockConnector([
      [cluster({ reflection_lock_acquired_at: justInside })],
    ]);

    expect(
      await acquireReflectionLock(mockContext, c, skill, clusterId),
    ).toBeNull();
  });

  it('backs off when another run overwrote the lock in between', async () => {
    /**
     * The read-back after writing is what catches a genuine race: both runs
     * write, and the one whose timestamp did not survive has to stand down.
     * Without this check both would proceed and overwrite each other's arms.
     */
    const someoneElse = new Date(Date.now() + 5).toISOString();
    const c = lockConnector([
      [cluster({ reflection_lock_acquired_at: null })],
      [cluster({ reflection_lock_acquired_at: someoneElse })],
    ]);

    expect(
      await acquireReflectionLock(mockContext, c, skill, clusterId),
    ).toBeNull();
  });

  it('refuses when the cluster no longer exists', async () => {
    const c = lockConnector([[]]);

    expect(
      await acquireReflectionLock(mockContext, c, skill, clusterId),
    ).toBeNull();
  });

  it('refuses when the cluster disappears mid-acquisition', async () => {
    const c = lockConnector([
      [cluster({ reflection_lock_acquired_at: null })],
      [],
    ]);

    expect(
      await acquireReflectionLock(mockContext, c, skill, clusterId),
    ).toBeNull();
  });

  it('refuses when the write fails', async () => {
    // A rejected update means someone else won; proceeding would regenerate
    // without holding the lock at all.
    const c = {
      getSkillOptimizationClusters: vi
        .fn()
        .mockResolvedValue([cluster({ reflection_lock_acquired_at: null })]),
      updateSkillOptimizationCluster: vi
        .fn()
        .mockRejectedValue(new Error('conflict')),
    } as unknown as UserDataStorageConnector;

    expect(
      await acquireReflectionLock(mockContext, c, skill, clusterId),
    ).toBeNull();
  });
});

/**
 * The examples reflection learns from: the best log of the cluster, and its
 * worst recent ones. A log not judged yet has no score, and is no example of
 * anything -- the newest log is usually one, its evaluation still running
 * when reflection does.
 */
describe('fetchReflectionExamples', () => {
  /** A completed chat log that answered `content`, scored `score`. */
  const chatLog = (id: string, content: string, score: number | null) => ({
    id,
    status: 200,
    end_time: 2,
    function_name: 'chat_complete',
    avg_eval_score: score,
    ai_provider_request_log: {
      method: 'POST',
      request_url: 'https://api.openai.com/v1/chat/completions',
      request_body: {
        model: 'm',
        messages: [{ role: 'user', content: `asked ${id}` }],
      },
      response_body: {
        id,
        object: 'chat.completion',
        created: 1,
        model: 'm',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content },
            finish_reason: 'stop',
          },
        ],
      },
    },
  });

  it('leaves out logs that have not been judged', async () => {
    const logs = [
      chatLog('fresh', 'a fine answer, not judged yet', null),
      chatLog('good', 'a good answer', 0.9),
      chatLog('bad', 'a bad answer', 0.1),
    ];
    const userData = {
      getSkillEvents: vi.fn().mockResolvedValue([]),
      getSkillOptimizationEvaluationRuns: vi.fn().mockResolvedValue([]),
    } as unknown as UserDataStorageConnector;
    const logsStore = {
      getLogs: vi.fn().mockResolvedValue(logs),
    } as unknown as LogsStorageConnector;

    const { bestExamples, worstExamples } = await fetchReflectionExamples(
      createMockContext(),
      userData,
      logsStore,
      { id: 'cluster-1', skill_id: 'skill-1' } as SkillOptimizationCluster,
    );

    expect(bestExamples.join()).toContain('a good answer');
    expect(worstExamples.join()).toContain('a bad answer');
    expect([...bestExamples, ...worstExamples].join()).not.toContain(
      'not judged yet',
    );
  });

  // The newest logs of a busy cluster are the ones its judge has not
  // reached: reading the newest and dropping the unjudged could leave none.
  it('asks the store for judged logs only', async () => {
    const userData = {
      getSkillEvents: vi.fn().mockResolvedValue([]),
      getSkillOptimizationEvaluationRuns: vi.fn().mockResolvedValue([]),
    } as unknown as UserDataStorageConnector;
    const logsStore = {
      getLogs: vi.fn().mockResolvedValue([]),
    } as unknown as LogsStorageConnector;

    await fetchReflectionExamples(createMockContext(), userData, logsStore, {
      id: 'cluster-1',
      skill_id: 'skill-1',
    } as SkillOptimizationCluster);

    expect(logsStore.getLogs).toHaveBeenCalledTimes(2);
    for (const [, query] of vi.mocked(logsStore.getLogs).mock.calls) {
      expect(query).toMatchObject({ judged: true });
    }
  });
});

/**
 * A reflection cycle end to end, short of the model call: once every arm has
 * served enough requests, the cluster's arms are rewritten from its best and
 * worst judged logs -- and only when there are judged logs to learn from.
 */
describe('autoGenerateSystemPromptsForSkill', () => {
  const best = arm('best', 'the winning prompt', 0.2);
  const worst = arm('worst', 'a losing prompt', 0.9);

  const reflectingSkill = {
    ...skill,
    description: 'Answers questions.',
    allowed_template_variables: [],
    reflection_min_requests_per_arm: 5,
  } as unknown as Skill;

  /** A completed chat log that answered `content`, scored `score`. */
  const chatLog = (id: string, score: number | null) => ({
    id,
    status: 200,
    end_time: 2,
    function_name: 'chat_complete',
    avg_eval_score: score,
    ai_provider_request_log: {
      method: 'POST',
      request_url: 'https://api.openai.com/v1/chat/completions',
      request_body: {
        model: 'm',
        messages: [{ role: 'user', content: `asked ${id}` }],
      },
      response_body: {
        id,
        object: 'chat.completion',
        created: 1,
        model: 'm',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: `answered ${id}` },
            finish_reason: 'stop',
          },
        ],
      },
    },
  });

  const setup = (logs: unknown[]) => {
    // The lock is written to the cluster and read back, so the store keeps it.
    let lock: string | null = null;
    const userData = {
      getSkillOptimizationClusters: vi.fn(async () => [
        cluster({ reflection_lock_acquired_at: lock }),
      ]),
      updateSkillOptimizationCluster: vi.fn(
        (_c: unknown, _id: string, update: Record<string, unknown>) => {
          if ('reflection_lock_acquired_at' in update) {
            lock = update.reflection_lock_acquired_at as string | null;
          }
          return Promise.resolve();
        },
      ),
      getAgents: vi
        .fn()
        .mockResolvedValue([{ id: skill.agent_id, description: 'Helps.' }]),
      getSkillOptimizationArms: vi.fn().mockResolvedValue([best, worst]),
      getSkillOptimizationEvaluations: vi
        .fn()
        .mockResolvedValue([{ id: 'eval-1', weight: 1 }]),
      getSkillOptimizationArmStats: vi.fn().mockResolvedValue([
        { arm_id: 'best', evaluation_id: 'eval-1', mean: 0.9, n: 10 },
        { arm_id: 'worst', evaluation_id: 'eval-1', mean: 0.2, n: 10 },
      ]),
      getSkillEvents: vi.fn().mockResolvedValue([]),
      getSkillOptimizationEvaluationRuns: vi.fn().mockResolvedValue([]),
      updateSkillOptimizationArm: vi.fn().mockResolvedValue(undefined),
      deleteSkillOptimizationArmStats: vi.fn().mockResolvedValue(undefined),
      createSkillEvent: vi.fn().mockResolvedValue(undefined),
    } as unknown as UserDataStorageConnector;
    const logsStore = {
      getLogs: vi.fn().mockResolvedValue(logs),
    } as unknown as LogsStorageConnector;
    return { userData, logsStore, lockHeld: () => lock !== null };
  };

  const reflect = (
    userData: UserDataStorageConnector,
    logsStore: LogsStorageConnector,
  ) =>
    autoGenerateSystemPromptsForSkill(
      mockContext,
      FunctionName.CHAT_COMPLETE,
      userData,
      logsStore,
      reflectingSkill,
    );

  beforeEach(() => {
    vi.mocked(generateReflectiveSystemPromptForSkill).mockClear();
    vi.mocked(generateReflectiveSystemPromptForSkill).mockResolvedValue(
      'a freshly written prompt',
    );
  });

  it('rewrites the arms from the judged logs', async () => {
    const { userData, logsStore, lockHeld } = setup([
      chatLog('good', 0.9),
      chatLog('bad', 0.1),
    ]);

    await reflect(userData, logsStore);

    expect(generateReflectiveSystemPromptForSkill).toHaveBeenCalledTimes(1);
    expect(updatedArmIds(userData)).toEqual(['worst']);
    expect(lockHeld()).toBe(false);
  });

  // A judge slower than the traffic leaves every recent log unscored. The
  // reflector was still asked to settle "the failures" -- none -- and the
  // arms were rewritten, and their history cleared, with whatever it wrote.
  it('waits for the judge when no log has been judged', async () => {
    const { userData, logsStore, lockHeld } = setup([
      chatLog('fresh', null),
      chatLog('fresher', null),
    ]);

    await reflect(userData, logsStore);

    expect(generateReflectiveSystemPromptForSkill).not.toHaveBeenCalled();
    expect(userData.updateSkillOptimizationArm).not.toHaveBeenCalled();
    expect(userData.deleteSkillOptimizationArmStats).not.toHaveBeenCalled();
    expect(userData.createSkillEvent).not.toHaveBeenCalled();
    // And lets the next request try again.
    expect(lockHeld()).toBe(false);
  });

  it('waits when nothing since the last reflection has been judged', async () => {
    const { userData, logsStore, lockHeld } = setup([]);
    vi.mocked(logsStore.getLogs)
      // The best of all time...
      .mockResolvedValueOnce([chatLog('good', 0.9)] as never)
      // ...and nothing judged since the last reflection.
      .mockResolvedValueOnce([] as never);

    await reflect(userData, logsStore);

    expect(generateReflectiveSystemPromptForSkill).not.toHaveBeenCalled();
    expect(userData.updateSkillOptimizationArm).not.toHaveBeenCalled();
    expect(lockHeld()).toBe(false);
  });
});
