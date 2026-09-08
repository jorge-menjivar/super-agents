'use client';

import type { HookLog } from '@shared/types/data/log';
import { CacheStatus } from '@shared/types/middleware/cache';
import {
  type Hook,
  HookProvider,
  HookType,
} from '@shared/types/middleware/hooks';
import { Badge } from '@web/components/ui/badge';
import { formatDuration } from '@web/utils/time';
import type { ReactElement } from 'react';

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

const VERDICT_VARIANT: Record<
  HookVerdict,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  allowed: 'outline',
  denied: 'destructive',
  replaced: 'secondary',
  rewrote: 'secondary',
  skipped: 'outline',
  failed: 'secondary',
};

/**
 * What the hook's reason did: a denial's reason reaches the client only
 * where the hook exposes it, and the difference is worth seeing here, since
 * this panel is where the reason is read either way.
 */
function reasonAudience(log: HookLog, outcome: HookOutcome): string | null {
  if (outcome.verdict !== 'denied') return null;
  return log.hook.expose_reason
    ? 'The client was told this reason.'
    : 'The client was told which hook withheld it, not why.';
}

/**
 * Every hook that judged the request, with its verdict, however it went:
 * a request that was allowed through shows who allowed it and why, just as
 * a withheld one shows who withheld it. The response a hook withheld or
 * replaced is drawn with the conversation, not here.
 */
export function HookResults({
  hookLogs,
}: {
  hookLogs: HookLog[];
}): ReactElement {
  return (
    <section
      aria-label="Hooks"
      className="px-4 py-3 space-y-2 bg-muted/30 border-b"
    >
      <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
        Hooks
      </div>
      {hookLogs.map((log) => {
        const outcome = describeHookLog(log);
        const audience = reasonAudience(log, outcome);
        return (
          <div
            key={`${log.hook.type}-${log.hook.id}-${log.start_time}`}
            className="bg-background rounded-md border px-3 py-2 space-y-1"
          >
            <div className="flex flex-row flex-wrap items-center gap-x-2 gap-y-1 text-xs">
              <Badge
                variant={VERDICT_VARIANT[outcome.verdict]}
                className="h-5 px-2 py-0 text-xs"
              >
                {outcome.label}
              </Badge>
              <span className="font-mono">{log.hook.id}</span>
              <span className="text-muted-foreground">
                {log.hook.type === HookType.INPUT_HOOK
                  ? 'on the request'
                  : 'on the response'}
              </span>
              <span className="text-muted-foreground">·</span>
              <span className="text-muted-foreground">
                {describeHookProvider(log.hook)}
              </span>
              <span className="text-muted-foreground">·</span>
              <span className="font-mono tabular-nums text-muted-foreground">
                {formatDuration(log.duration)}
              </span>
              {log.cache_status === CacheStatus.HIT && (
                <Badge variant="outline" className="h-5 px-2 py-0 text-xs">
                  cached verdict
                </Badge>
              )}
            </div>
            {log.result.reason && (
              <p className="text-sm whitespace-pre-wrap leading-relaxed">
                {log.result.reason}
              </p>
            )}
            {log.result.error !== undefined && (
              <p className="text-sm text-destructive whitespace-pre-wrap leading-relaxed">
                {log.result.error}
              </p>
            )}
            {(outcome.failure || audience) && (
              <p className="text-xs text-muted-foreground">
                {[outcome.failure, audience].filter(Boolean).join(' ')}
              </p>
            )}
          </div>
        );
      })}
    </section>
  );
}
