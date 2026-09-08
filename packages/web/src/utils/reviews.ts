import type { HookLog, Log } from '@shared/types/data/log';
import { HookProvider } from '@shared/types/middleware/hooks';

/** The span a review is logged under: what the agent hook names its request. */
export const REVIEW_SPAN = 'review';

/** The reviews among a trace's logs. */
export const reviewsAmong = (logs: Log[]): Log[] =>
  logs.filter((log) => log.span_name === REVIEW_SPAN);

/**
 * The review a reviewer hook's verdict came from, among the reviews of the
 * request: the one its reviewer agent answered while the hook was running.
 *
 * A review is a log of its own under the reviewer's agent, sharing the
 * reviewed request's trace, so the reviewer is read off the request the
 * review was sent as. The window matters because a request can be
 * reviewed by several agents, and a session by the same one many times.
 * No review that fits, or more than one, links nothing rather than the
 * wrong one.
 */
export function reviewOf(hookLog: HookLog, reviews: Log[]): Log | undefined {
  const { hook } = hookLog;
  if (
    hook.hook_provider !== HookProvider.AGENT ||
    !('agent_name' in hook.config)
  ) {
    return undefined;
  }
  const reviewer = hook.config.agent_name;
  const fitting = reviews.filter(
    (review) =>
      review.base_sa_config.agent_name === reviewer &&
      review.start_time >= hookLog.start_time &&
      review.start_time <= hookLog.end_time,
  );
  return fitting.length === 1 ? fitting[0] : undefined;
}
