import type { HookLog } from '@shared/types/data/log';
import {
  type Hook,
  HookProvider,
  HookType,
} from '@shared/types/middleware/hooks';

/**
 * Reading a hook log as an outcome.
 *
 * These are pure readers rather than part of the panel that draws them,
 * because the log page is not the only surface that has to know a request
 * went out unreviewed: the session rail colours by it too.
 */

/** What a hook made of the request or the response, in a word. */
export type HookVerdict =
  | 'allowed'
  | 'denied'
  | 'replaced'
  | 'rewrote'
  | 'skipped'
  | 'failed';

export interface HookOutcome {
  verdict: HookVerdict;
  /** The verdict as it is shown. */
  label: string;
  /**
   * What the failure meant, when the hook could not run: the request went
   * through unreviewed, or was withheld for it. Null for a hook that ran.
   */
  failure: string | null;
}

/**
 * A hook log read as an outcome. A hook that could not run is a different
 * kind of news from one that objected, so its error is reported as such,
 * with what the failure did to the request -- which depends on whether the
 * hook fails open or closed.
 */
export function describeHookLog(log: HookLog): HookOutcome {
  const { hook, result } = log;
  const subject = hook.type === HookType.INPUT_HOOK ? 'request' : 'response';
  if (result.skipped) {
    return { verdict: 'skipped', label: 'Skipped', failure: null };
  }
  if (result.error !== undefined) {
    return result.deny_request
      ? {
          verdict: 'denied',
          label: 'Denied',
          failure: `The hook could not run and fails closed, so the ${subject} was withheld.`,
        }
      : {
          verdict: 'failed',
          label: 'Could not run',
          failure: `The hook fails open, so the ${subject} went through unreviewed.`,
        };
  }
  if (result.deny_request) {
    return { verdict: 'denied', label: 'Denied', failure: null };
  }
  if (result.response_body_override !== undefined) {
    return { verdict: 'replaced', label: 'Replaced', failure: null };
  }
  if (result.request_body_override !== undefined) {
    return { verdict: 'rewrote', label: 'Rewrote the request', failure: null };
  }
  return { verdict: 'allowed', label: 'Allowed', failure: null };
}

/** Who the hook asked: the reviewer agent, the endpoint, or the model. */
export function describeHookProvider(hook: Hook): string {
  const config = hook.config;
  switch (hook.hook_provider) {
    case HookProvider.AGENT:
      if ('agent_name' in config) {
        return config.skill_name
          ? `agent ${config.agent_name} / ${config.skill_name}`
          : `agent ${config.agent_name}`;
      }
      return 'agent';
    case HookProvider.HTTP:
      return 'url' in config ? `${config.method} ${config.url}` : 'http';
    case HookProvider.LLM:
      return 'model' in config ? `${config.provider}/${config.model}` : 'llm';
    default:
      return hook.hook_provider;
  }
}

/**
 * Whichever verdict decided the request. A denial settles it whatever else
 * ran; short of that, a hook that could not run is the next thing worth
 * knowing, since it means the request went out unchecked.
 */
const VERDICT_PRECEDENCE: readonly HookVerdict[] = [
  'denied',
  'failed',
  'replaced',
  'rewrote',
  'allowed',
];

export interface HookSummary {
  /** The line the closed strip shows: how many ran, and what they decided. */
  text: string;
  verdict: HookVerdict;
}

/**
 * Every hook's verdict in one phrase, for a strip that is shut.
 *
 * It names the hook that decided rather than counting verdicts, because
 * the reader's next question is always which one -- and a summary of "1
 * denied, 2 allowed" answers a question nobody asked.
 */
export function summariseHooks(hookLogs: HookLog[]): HookSummary {
  const outcomes = hookLogs.map((log) => ({
    log,
    outcome: describeHookLog(log),
  }));
  const ran = outcomes.filter(({ outcome }) => outcome.verdict !== 'skipped');

  if (ran.length === 0) {
    return {
      text:
        hookLogs.length === 1
          ? '1 hook, skipped'
          : `${hookLogs.length} hooks, all skipped`,
      verdict: 'skipped',
    };
  }

  const verdict =
    VERDICT_PRECEDENCE.find((candidate) =>
      ran.some(({ outcome }) => outcome.verdict === candidate),
    ) ?? 'allowed';
  const decided = ran.find(({ outcome }) => outcome.verdict === verdict);
  const count = ran.length === 1 ? '1 ran' : `${ran.length} ran`;

  if (verdict === 'allowed' || decided === undefined) {
    return { text: `${count} · Allowed`, verdict: 'allowed' };
  }
  const headline =
    verdict === 'failed'
      ? `${decided.log.hook.id} could not run`
      : `${decided.outcome.label} by ${decided.log.hook.id}`;
  return { text: `${count} · ${headline}`, verdict };
}

/**
 * The hook that withheld the request or the response, when one did. This is
 * what a withheld request is about, so the page says it in full rather than
 * behind a disclosure.
 */
export function denyingHook(hookLogs: HookLog[]): HookLog | undefined {
  return hookLogs.find((log) => describeHookLog(log).verdict === 'denied');
}

/**
 * Whether a hook that was supposed to check this request could not run and
 * let it through anyway. Neither a failure nor a clean pass, and the only
 * record that the check did not happen.
 */
export function wentUnreviewed(hookLogs: HookLog[]): boolean {
  return hookLogs.some((log) => describeHookLog(log).verdict === 'failed');
}
