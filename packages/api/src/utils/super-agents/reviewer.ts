import type { UserDataStorageConnector } from '@api/types/connector';
import type { AppContext } from '@api/types/hono';
import { warn } from '@shared/console-logging';
import type { SuperAgentsConfigPreProcessed } from '@shared/types/api/request/headers';
import type { Agent } from '@shared/types/data';
import { CacheMode } from '@shared/types/middleware/cache';
import {
  type Hook,
  HookProvider,
  HookType,
} from '@shared/types/middleware/hooks';

/** The id of the output hook an agent's reviewer becomes, as the logs show it. */
export const reviewerHookId = (reviewer: Pick<Agent, 'name'>): string =>
  `reviewer:${reviewer.name}`;

/**
 * The output hook that sends an agent's responses to its reviewer, or null
 * when there is nothing to add: the agent has no reviewer, the reviewer is
 * gone, or this request is itself a review.
 *
 * Configured on the agent and added here, server-side, rather than read from
 * the client's `sa-config`: a review a client could leave out of its header
 * would review nothing. The agent's own `options.review.timeout_ms` bounds
 * it -- the reviewed agent's, not the reviewer's, because it is the reviewed
 * agent's client that waits -- and null leaves it at
 * `DEFAULT_REVIEW_TIMEOUT_MS`.
 *
 * A decision agent as reviewer is asked through System One: it cannot write
 * a verdict, so it is asked for the probability that the response should be
 * withheld.
 */
export async function reviewerHookFor(
  c: AppContext,
  connector: UserDataStorageConnector,
  agent:
    | Pick<
        Agent,
        | 'id'
        | 'name'
        | 'reviewer_agent_id'
        | 'review_fail_closed'
        | 'review_expose_reason'
        | 'options'
      >
    | undefined,
  config: Pick<SuperAgentsConfigPreProcessed, 'reviewing_trace_id'>,
): Promise<Hook | null> {
  if (!agent?.reviewer_agent_id || config.reviewing_trace_id) {
    return null;
  }
  // Both schemas refuse this row; a reviewer cannot wait on its own verdict.
  if (agent.reviewer_agent_id === agent.id) {
    warn(`[HOOKS] Agent "${agent.name}" names itself as its reviewer`);
    return null;
  }
  const [reviewer] = await connector.getAgents(c, {
    id: agent.reviewer_agent_id,
  });
  if (!reviewer) {
    warn(
      `[HOOKS] Agent "${agent.name}" names a reviewer agent that no longer exists`,
    );
    return null;
  }
  const decides = reviewer.agent_type === 'decision';
  const timeoutMs = agent.options.review.timeout_ms;
  // How sure a decision agent must be to withhold is the reviewed agent's to
  // say, as its timeout is; a reviewer that writes its verdict has no use
  // for it.
  const threshold = agent.options.review.withhold_threshold;
  return {
    id: reviewerHookId(reviewer),
    type: HookType.OUTPUT_HOOK,
    hook_provider: HookProvider.AGENT,
    config: {
      agent_name: reviewer.name,
      ...(decides ? { api: 'system_one' as const } : {}),
      ...(decides && threshold !== null
        ? { withhold_threshold: threshold }
        : {}),
      ...(timeoutMs === null ? {} : { timeout_ms: timeoutMs }),
    },
    await: true,
    cache_mode: CacheMode.DISABLED,
    fail_closed: agent.review_fail_closed,
    expose_reason: agent.review_expose_reason,
  };
}
