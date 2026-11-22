import type { UserDataStorageConnector } from '@api/types/connector';
import type { AppContext } from '@api/types/hono';
import { signReview } from '@api/utils/super-agents/review-signature';
import { reviewerHookFor } from '@api/utils/super-agents/reviewer';
import { AgentOptions } from '@shared/types/data';
import { HookProvider, HookType } from '@shared/types/middleware/hooks';
import { describe, expect, it, vi } from 'vitest';

// The signing secret is read off the environment, as on every runtime.
const c = { env: { AUTH_JWT_SECRET: 'test-secret' } } as unknown as AppContext;
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
  options: AgentOptions.parse({}),
  agent_type: 'text' as const,
};
const guard = { id: 'agent-2', name: 'guard', agent_type: 'text' };

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

  it('bounds the review by the agent timeout when it has one', async () => {
    const hook = await reviewerHookFor(
      c,
      connector([guard]),
      {
        ...agent,
        options: AgentOptions.parse({ review: { timeout_ms: 5000 } }),
      },
      {},
    );
    expect(hook?.config).toEqual({ agent_name: 'guard', timeout_ms: 5000 });
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
      await reviewerHookFor(c, store, agent, {
        reviewing_trace_id: 'trace-1',
        reviewing_signature: await signReview(c, 'trace-1'),
      }),
    ).toBeNull();
    expect(store.getAgents).not.toHaveBeenCalled();
  });

  // The gateway and its clients share a bearer token, so a client could
  // claim its request is a review -- and switch its agent's reviewer off.
  describe('a client claiming its request is a review', () => {
    it('is reviewed when it names a trace without a signature', async () => {
      const hook = await reviewerHookFor(c, connector([guard]), agent, {
        reviewing_trace_id: 'trace-1',
      });
      expect(hook?.config).toMatchObject({ agent_name: 'guard' });
    });

    it('is reviewed when the signature is for another trace', async () => {
      const hook = await reviewerHookFor(c, connector([guard]), agent, {
        reviewing_trace_id: 'trace-2',
        reviewing_signature: await signReview(c, 'trace-1'),
      });
      expect(hook).not.toBeNull();
    });

    it('is reviewed when the signature is under another secret', async () => {
      const elsewhere = {
        env: { AUTH_JWT_SECRET: 'another-secret' },
      } as unknown as AppContext;
      const hook = await reviewerHookFor(c, connector([guard]), agent, {
        reviewing_trace_id: 'trace-1',
        reviewing_signature: await signReview(elsewhere, 'trace-1'),
      });
      expect(hook).not.toBeNull();
    });

    it('is reviewed when the signature is not even hex', async () => {
      const hook = await reviewerHookFor(c, connector([guard]), agent, {
        reviewing_trace_id: 'trace-1',
        reviewing_signature: 'not-a-signature',
      });
      expect(hook).not.toBeNull();
    });
  });

  // A decision agent answers with probabilities, which no reviewer reads: a
  // reviewer it was given before the API refused one could only fail, and,
  // failing closed, deny every request.
  it('adds nothing for a decision agent', async () => {
    const store = connector([guard]);
    expect(
      await reviewerHookFor(
        c,
        store,
        { ...agent, agent_type: 'decision', review_fail_closed: true },
        {},
      ),
    ).toBeNull();
    expect(store.getAgents).not.toHaveBeenCalled();
  });

  it('adds nothing when the reviewer no longer exists', async () => {
    expect(await reviewerHookFor(c, connector([]), agent, {})).toBeNull();
  });

  // A decision agent cannot write a verdict, so it is asked through System
  // One for the probability of withholding instead.
  it('asks a decision agent through System One', async () => {
    const hook = await reviewerHookFor(
      c,
      connector([{ ...guard, agent_type: 'decision' }]),
      agent,
      {},
    );

    expect(hook?.config).toEqual({ agent_name: 'guard', api: 'system_one' });
  });

  // How sure the reviewer must be is the reviewed agent's to say.
  it("carries the agent's withhold threshold to a decision agent", async () => {
    const hook = await reviewerHookFor(
      c,
      connector([{ ...guard, agent_type: 'decision' }]),
      {
        ...agent,
        options: AgentOptions.parse({ review: { withhold_threshold: 0.8 } }),
      },
      {},
    );

    expect(hook?.config).toEqual({
      agent_name: 'guard',
      api: 'system_one',
      withhold_threshold: 0.8,
    });
  });

  it('leaves the threshold out where it means nothing', async () => {
    const options = AgentOptions.parse({
      review: { withhold_threshold: 0.8 },
    });
    // A reviewer that writes its verdict has no probability to compare.
    const writer = await reviewerHookFor(
      c,
      connector([guard]),
      { ...agent, options },
      {},
    );
    expect(writer?.config).toEqual({ agent_name: 'guard' });

    // And an agent with no opinion follows the default.
    const inherited = await reviewerHookFor(
      c,
      connector([{ ...guard, agent_type: 'decision' }]),
      agent,
      {},
    );
    expect(inherited?.config).toEqual({
      agent_name: 'guard',
      api: 'system_one',
    });
  });

  it('asks an LLM agent through chat completions', async () => {
    const hook = await reviewerHookFor(c, connector([guard]), agent, {});

    expect(hook?.config).toEqual({ agent_name: 'guard' });
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
