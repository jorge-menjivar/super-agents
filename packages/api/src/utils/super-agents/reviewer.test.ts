import type { UserDataStorageConnector } from '@api/types/connector';
import type { AppContext } from '@api/types/hono';
import { reviewerHookFor } from '@api/utils/super-agents/reviewer';
import { HookProvider, HookType } from '@shared/types/middleware/hooks';
import { describe, expect, it, vi } from 'vitest';

const c = {} as AppContext;
const connector = (agents: unknown[]): UserDataStorageConnector =>
  ({
    getAgents: vi.fn().mockResolvedValue(agents),
  }) as unknown as UserDataStorageConnector;

const agent = {
  id: 'agent-1',
  name: 'helper',
  reviewer_agent_id: 'agent-2',
  review_fail_closed: false,
  review_expose_reason: false,
};
const guard = { id: 'agent-2', name: 'guard' };

describe('reviewerHookFor', () => {
  it('turns the agent reviewer into a blocking output hook', async () => {
    const hook = await reviewerHookFor(c, connector([guard]), agent, {});

    expect(hook).toEqual({
      id: 'reviewer:guard',
      type: HookType.OUTPUT_HOOK,
      hook_provider: HookProvider.AGENT,
      config: { agent_name: 'guard' },
      await: true,
      cache_mode: 'disabled',
      fail_closed: false,
      expose_reason: false,
    });
  });

  it('carries the agent choice to fail closed', async () => {
    const hook = await reviewerHookFor(
      c,
      connector([guard]),
      { ...agent, review_fail_closed: true },
      {},
    );
    expect(hook?.fail_closed).toBe(true);
  });

  it('carries the agent choice to explain denials', async () => {
    const hook = await reviewerHookFor(
      c,
      connector([guard]),
      { ...agent, review_expose_reason: true },
      {},
    );
    expect(hook?.expose_reason).toBe(true);
  });

  it('adds nothing for an agent without a reviewer', async () => {
    const store = connector([guard]);
    expect(
      await reviewerHookFor(
        c,
        store,
        { ...agent, reviewer_agent_id: null },
        {},
      ),
    ).toBeNull();
    expect(await reviewerHookFor(c, store, undefined, {})).toBeNull();
    expect(store.getAgents).not.toHaveBeenCalled();
  });

  it('does not review a review', async () => {
    // The request the gateway sends a reviewer says which request it
    // reviews; adding the reviewer's own reviewer here is how two agents
    // reviewing each other would never finish.
    const store = connector([guard]);
    expect(
      await reviewerHookFor(c, store, agent, { reviewing_trace_id: 'trace-1' }),
    ).toBeNull();
    expect(store.getAgents).not.toHaveBeenCalled();
  });

  it('adds nothing when the reviewer no longer exists', async () => {
    expect(await reviewerHookFor(c, connector([]), agent, {})).toBeNull();
  });

  it('never lets an agent wait on its own verdict', async () => {
    expect(
      await reviewerHookFor(
        c,
        connector([agent]),
        { ...agent, reviewer_agent_id: agent.id },
        {},
      ),
    ).toBeNull();
  });
});
