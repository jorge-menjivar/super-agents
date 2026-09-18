import { checkAndRegenerateEvaluationsEarly } from '@api/middlewares/optimizer/evaluations';
import { createMockContext } from '@api/test-utils/mock-context';
import type {
  EvaluationMethodConnector,
  LogsStorageConnector,
  UserDataStorageConnector,
} from '@api/types/connector';
import { FunctionName } from '@shared/types/api/request';
import type { Skill } from '@shared/types/data';
import type { Log } from '@shared/types/data/log';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The guards on early regeneration -- the one-off pass that rewrites a skill's
 * evaluations once it has served its first handful of real requests.
 *
 * Everything here is a reason *not* to proceed, and that is the point. The pass
 * is meant to happen exactly once per skill, and it calls models when it does,
 * so a guard that fails open regenerates repeatedly: the skill's evaluations
 * churn, tokens are spent on every request, and nothing reports an error.
 *
 * Only the early-return paths are exercised. Everything past them reaches the
 * model calls, which belong to an end-to-end test rather than this one.
 */

const mockContext = createMockContext();

const uuid = (n: number): string =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const skill = { id: uuid(1), agent_id: uuid(2) } as Skill;

const storedSkill = (overrides: Partial<Skill> = {}): Skill =>
  ({
    ...skill,
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
        messages: [{ role: 'user', content: 'Book a flight to Paris' }],
      },
      response_body: {
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: 1677652288,
        model: 'gpt-4',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'Booked.' },
            finish_reason: 'stop',
          },
        ],
      },
    },
  }) as unknown as Log;

/** A log the conversation extractor cannot parse, so it yields no example. */
const unusableLog = (): Log =>
  ({
    id: uuid(5),
    ai_provider_request_log: {
      method: 'POST',
      request_url: 'https://api.openai.com/v1/chat/completions',
      request_body: { model: 'gpt-4', messages: [] },
      response_body: { nonsense: true },
    },
  }) as unknown as Log;

const connectors = (
  skillReads: Skill[][],
  logs: Log[] = [],
): {
  userData: UserDataStorageConnector;
  logsStore: LogsStorageConnector;
} => {
  const getSkills = vi.fn();
  for (const read of skillReads) {
    getSkills.mockResolvedValueOnce(read);
  }
  getSkills.mockResolvedValue(skillReads[skillReads.length - 1] ?? []);

  return {
    userData: {
      getSkills,
      updateSkill: vi.fn().mockResolvedValue(undefined),
      // The lock window is derived from the timeouts the lock guards; at
      // their defaults the floor still wins, so these tests read as before.
      getSystemSettings: vi.fn().mockResolvedValue({
        options: {
          system_prompt_reflection: { timeout_ms: 120_000 },
          evaluation_generation: { timeout_ms: 120_000 },
        },
      }),
    } as unknown as UserDataStorageConnector,
    logsStore: {
      getLogs: vi.fn().mockResolvedValue(logs),
      getLogSummaries: vi.fn(),
    } as unknown as LogsStorageConnector,
  };
};

const run = (
  userData: UserDataStorageConnector,
  logsStore: LogsStorageConnector,
  functionName: FunctionName = FunctionName.CHAT_COMPLETE,
): Promise<void> =>
  checkAndRegenerateEvaluationsEarly(
    mockContext,
    functionName,
    userData,
    logsStore,
    skill,
    'an agent that does something useful',
    {} as Record<string, EvaluationMethodConnector>,
  );

/** Lock writes, in call order: the timestamp set, or null for a release. */
const lockWrites = (c: UserDataStorageConnector): (string | null)[] =>
  vi
    .mocked(c.updateSkill)
    .mock.calls.map(
      ([, , update]) =>
        (update as { evaluation_lock_acquired_at?: string | null })
          .evaluation_lock_acquired_at ?? null,
    );

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-03-01T12:00:00.000Z'));
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('checkAndRegenerateEvaluationsEarly', () => {
  it('ignores a request that is not a chat completion', async () => {
    // Embeddings and the like carry no conversation to learn from.
    const { userData, logsStore } = connectors([[storedSkill()]]);

    await run(userData, logsStore, FunctionName.EMBED);

    expect(userData.getSkills).not.toHaveBeenCalled();
  });

  it('runs for each conversational endpoint', async () => {
    for (const functionName of [
      FunctionName.CHAT_COMPLETE,
      FunctionName.STREAM_CHAT_COMPLETE,
      FunctionName.CREATE_MODEL_RESPONSE,
    ]) {
      const { userData, logsStore } = connectors([[]]);
      await run(userData, logsStore, functionName);
      expect(userData.getSkills).toHaveBeenCalled();
    }
  });

  it('stops when the skill no longer exists', async () => {
    const { userData, logsStore } = connectors([[]]);

    await run(userData, logsStore);

    expect(userData.updateSkill).not.toHaveBeenCalled();
  });

  it('never regenerates a skill twice', async () => {
    /**
     * The one-off guarantee. `evaluations_regenerated_at` is the record that
     * the pass already happened; ignoring it would rewrite the skill's
     * evaluations on every subsequent request and spend a model call each time.
     */
    const { userData, logsStore } = connectors([
      [storedSkill({ evaluations_regenerated_at: '2026-02-01T00:00:00.000Z' })],
    ]);

    await run(userData, logsStore);

    expect(userData.updateSkill).not.toHaveBeenCalled();
    expect(logsStore.getLogs).not.toHaveBeenCalled();
  });

  it('stands down while another request holds a fresh lock', async () => {
    const heldAt = new Date(Date.now() - 60_000).toISOString();
    const { userData, logsStore } = connectors([
      [storedSkill({ evaluation_lock_acquired_at: heldAt })],
    ]);

    await run(userData, logsStore);

    expect(userData.updateSkill).not.toHaveBeenCalled();
  });

  it('holds off on a lock taken just under the timeout', async () => {
    const justInside = new Date(Date.now() - 4 * 60_000).toISOString();
    const { userData, logsStore } = connectors([
      [storedSkill({ evaluation_lock_acquired_at: justInside })],
    ]);

    await run(userData, logsStore);

    expect(userData.updateSkill).not.toHaveBeenCalled();
  });

  it('takes over a lock abandoned more than five minutes ago', async () => {
    // Without an expiry a process that died mid-pass would block the skill from
    // ever regenerating. It backs off again at the read-back here, which keeps
    // the test clear of the model calls further down.
    const stale = new Date(Date.now() - 6 * 60_000).toISOString();
    const { userData, logsStore } = connectors([
      [storedSkill({ evaluation_lock_acquired_at: stale })],
      [storedSkill({ evaluation_lock_acquired_at: 'someone-elses-lock' })],
    ]);

    await run(userData, logsStore);

    expect(lockWrites(userData)).toEqual([new Date().toISOString()]);
  });

  it('releases the lock when another request finished first', async () => {
    // Two requests can both pass the first check; the one that reads back a
    // completed skill has to release rather than proceed.
    const { userData, logsStore } = connectors([
      [storedSkill()],
      [
        storedSkill({
          evaluations_regenerated_at: '2026-03-01T11:59:59.000Z',
          evaluation_lock_acquired_at: new Date().toISOString(),
        }),
      ],
    ]);

    await run(userData, logsStore);

    expect(lockWrites(userData)).toEqual([new Date().toISOString(), null]);
    expect(logsStore.getLogs).not.toHaveBeenCalled();
  });

  it('backs off when its lock was overwritten in between', async () => {
    /**
     * The genuine race: both requests write a lock, and the one whose timestamp
     * did not survive must stand down. Note it returns *without* releasing --
     * releasing here would clear the winner's lock.
     */
    const someoneElse = new Date(Date.now() + 5).toISOString();
    const { userData, logsStore } = connectors([
      [storedSkill()],
      [storedSkill({ evaluation_lock_acquired_at: someoneElse })],
    ]);

    await run(userData, logsStore);

    expect(lockWrites(userData)).toEqual([new Date().toISOString()]);
    expect(logsStore.getLogs).not.toHaveBeenCalled();
  });

  it('stops when the lock write fails', async () => {
    const { userData, logsStore } = connectors([[storedSkill()]]);
    vi.mocked(userData.updateSkill).mockRejectedValueOnce(
      new Error('conflict'),
    );

    await run(userData, logsStore);

    expect(logsStore.getLogs).not.toHaveBeenCalled();
  });

  it('waits for five logs before regenerating', async () => {
    /**
     * The documented trigger. Regenerating from one or two examples would
     * rewrite the evaluations from a sample too small to be representative --
     * and it only gets one chance, since the pass never runs again.
     *
     * The logs are deliberately *usable*: with unparseable ones the next guard
     * down would release the lock too, and the test could not tell which of the
     * two stopped it.
     */
    const now = new Date().toISOString();
    const { userData, logsStore } = connectors(
      [[storedSkill()], [storedSkill({ evaluation_lock_acquired_at: now })]],
      [usableLog(), usableLog(), usableLog(), usableLog()],
    );

    await run(userData, logsStore);

    expect(logsStore.getLogs).toHaveBeenCalled();
    // Lock taken, then released, so the next request can try again later.
    expect(lockWrites(userData)).toEqual([now, null]);
    /**
     * And it stopped *here*, rather than proceeding into generation and failing
     * there. The catch block releases the lock too, so the lock writes alone
     * cannot tell a clean guard from a crash -- the absence of a logged error
     * is what distinguishes them.
     */
    expect(console.error).not.toHaveBeenCalled();
  });

  it('releases the lock when no log yields a usable example', async () => {
    // Enough logs to pass the threshold, none of them parseable. Proceeding
    // would regenerate the evaluations from an empty example set and burn the
    // skill's single chance at the early pass.
    const now = new Date().toISOString();
    const { userData, logsStore } = connectors(
      [[storedSkill()], [storedSkill({ evaluation_lock_acquired_at: now })]],
      Array.from({ length: 5 }, unusableLog),
    );

    await run(userData, logsStore);

    expect(lockWrites(userData)).toEqual([now, null]);
  });
});
