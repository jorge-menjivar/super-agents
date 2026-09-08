'use client';

import type { HookLog, Log } from '@shared/types/data/log';
import { CacheStatus } from '@shared/types/middleware/cache';
import { HookType } from '@shared/types/middleware/hooks';
import { Badge } from '@web/components/ui/badge';
import { Button } from '@web/components/ui/button';
import {
  describeHookLog,
  describeHookProvider,
  type HookOutcome,
  type HookVerdict,
} from '@web/utils/hook-outcome';
import { formatDuration } from '@web/utils/time';
import { ArrowUpRightIcon } from 'lucide-react';
import type { ReactElement } from 'react';

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
 * Whether the answer this hook withheld or replaced was lost: a log written
 * before the gateway kept it on the hook log has only the review to show
 * what the model wrote.
 */
const judgedResponseLost = (log: HookLog, outcome: HookOutcome): boolean =>
  log.hook.type === HookType.OUTPUT_HOOK &&
  (outcome.verdict === 'denied' || outcome.verdict === 'replaced') &&
  log.response_body === undefined;

/**
 * Every hook that judged the request, with its verdict, however it went:
 * a request that was allowed through shows who allowed it and why, just as
 * a withheld one shows who withheld it. The response a hook withheld or
 * replaced is drawn with the conversation, not here. A reviewer hook links
 * to the review its verdict came from, where what the reviewer was shown
 * and said can be read in full.
 */
export function HookResults({
  hookLogs,
  reviewOf,
  onOpenReview,
}: {
  hookLogs: HookLog[];
  /** The review a reviewer hook's verdict came from, when it is known. */
  reviewOf?: (log: HookLog) => Log | undefined;
  onOpenReview?: (review: Log, reviewerName: string) => void;
}): ReactElement {
  return (
    <div className="space-y-2" data-testid="hooks">
      {hookLogs.map((log) => {
        const outcome = describeHookLog(log);
        const audience = reasonAudience(log, outcome);
        const review = reviewOf?.(log);
        const reviewer =
          'agent_name' in log.hook.config ? log.hook.config.agent_name : null;
        const lost = judgedResponseLost(log, outcome)
          ? review
            ? 'What the model wrote was not kept on this log, which predates that; the review shows what the reviewer was sent.'
            : 'What the model wrote was not kept on this log, which predates that.'
          : null;
        return (
          <div
            key={`${log.hook.type}-${log.hook.id}-${log.start_time}`}
            className="rounded-md border bg-muted/30 px-3 py-2 space-y-1"
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
              {review && reviewer && onOpenReview && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs ml-auto"
                  onClick={() => onOpenReview(review, reviewer)}
                >
                  Open the review
                  <ArrowUpRightIcon className="h-3 w-3" />
                </Button>
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
            {(outcome.failure || audience || lost) && (
              <p className="text-xs text-muted-foreground">
                {[outcome.failure, audience, lost].filter(Boolean).join(' ')}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
