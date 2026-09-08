'use client';

import type { Log } from '@shared/types/data/log';
import { Button } from '@web/components/ui/button';
import { type LogOutcomeTone, outcomeOf } from '@web/utils/log-outcome';
import { formatClockTime, formatDuration } from '@web/utils/time';
import { cn } from '@web/utils/ui/utils';
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import type { ReactElement } from 'react';
import { useEffect, useRef } from 'react';

/**
 * The colour a request is read by, answering one question: did something go
 * wrong. Red for a request that failed or was withheld, amber for one that
 * was served without a check that was meant to run, green for one that came
 * through clean, and nothing while it is still going.
 *
 * How *good* the answer was is the score beside it, which is a number and
 * reads as one. Colouring by the two at once is what used to make a weak
 * answer and a failed request look alike, and it cost the rail the status
 * of every request it had scored.
 */
const TEXT_TONE: Record<LogOutcomeTone, string> = {
  failed: 'text-red-500',
  unreviewed: 'text-amber-500',
  served: 'text-green-500',
  running: 'text-muted-foreground',
};

const BAR_TONE: Record<LogOutcomeTone, string> = {
  failed: 'bg-red-500',
  unreviewed: 'bg-amber-500',
  served: 'bg-green-500',
  running: 'bg-muted-foreground/40',
};

interface SessionMapProps {
  /** The session's requests, oldest first */
  logs: Log[];
  currentId: string;
  /** The session goes on past what is shown, on that side */
  hasEarlier: boolean;
  hasLater: boolean;
  traceId: string;
  appId?: string | null;
  /** A line under a request's time: what it was, when that is known */
  labelOf: (log: Log) => string | null;
  onSelect: (log: Log) => void;
}

/**
 * A session's requests as a rail beside the one being read: each a time,
 * the score it was judged at, and a bar as long as the request took, its
 * length written at the tip so it cannot be read as a score. Colour says
 * whether the request went wrong; the score says how good the answer was.
 * The rail carries its own arrows, so stepping through the session is never
 * confused with the page's arrows, which step through the list.
 */
export function SessionMap({
  logs,
  currentId,
  hasEarlier,
  hasLater,
  traceId,
  appId,
  labelOf,
  onSelect,
}: SessionMapProps): ReactElement {
  const currentRef = useRef<HTMLButtonElement>(null);
  const longest = Math.max(1, ...logs.map((log) => log.duration ?? 0));

  // Keep the request being read in view as the reader steps through
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when the current request changes
  useEffect(() => {
    currentRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [currentId]);

  // How many, and -- when all of them are here -- how long they spanned
  const cut = hasEarlier || hasLater;
  const first = logs[0];
  const last = logs[logs.length - 1];
  const span =
    first && last && !cut
      ? ` · ${formatDuration(
          last.start_time + (last.duration ?? 0) - first.start_time,
        )}`
      : '';
  const count = `${logs.length}${cut ? '+' : ''} requests${span}`;

  // The session's own arrows, in its order: earlier is up the rail
  const index = logs.findIndex((log) => log.id === currentId);
  const earlier = index > 0 ? logs[index - 1] : undefined;
  const later = index >= 0 ? logs[index + 1] : undefined;
  // A position only means something once the whole session is here
  const position = !cut && index >= 0 ? `${index + 1} of ${logs.length}` : null;

  return (
    <nav
      aria-label="Session"
      className="hidden md:flex flex-col w-52 shrink-0 border-r bg-background"
    >
      <div className="px-3 pt-3 pb-2 border-b">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
            Session
          </span>
          {appId && (
            <span
              className="text-[10px] text-muted-foreground truncate"
              title={appId}
            >
              {appId}
            </span>
          )}
        </div>
        <div className="mt-1 flex items-baseline justify-between gap-2">
          <span
            className="font-mono text-[11px] truncate select-all cursor-text"
            title={traceId}
          >
            {traceId}
          </span>
          <span className="text-[11px] text-muted-foreground shrink-0 tabular-nums">
            {count}
          </span>
        </div>
      </div>
      <div className="flex items-center justify-between px-1.5 py-1 border-b">
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          aria-label="Earlier request in this session"
          disabled={!earlier}
          onClick={() => earlier && onSelect(earlier)}
        >
          <ChevronLeftIcon className="h-3.5 w-3.5" />
        </Button>
        {position && (
          <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
            {position}
          </span>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          aria-label="Later request in this session"
          disabled={!later}
          onClick={() => later && onSelect(later)}
        >
          <ChevronRightIcon className="h-3.5 w-3.5" />
        </Button>
      </div>
      {/* The list's own padding and margins are reset: it is a rail, not prose */}
      <ol className="flex-1 overflow-y-auto m-0 py-1 pl-0 list-none">
        {hasEarlier && (
          <li className="px-3 py-1 text-[10px] text-muted-foreground">
            Earlier requests not shown
          </li>
        )}
        {logs.map((log) => {
          const current = log.id === currentId;
          const outcome = outcomeOf(log);
          const tone = outcome.tone;
          const score = log.avg_eval_score;
          const label = labelOf(log);
          const time = formatClockTime(log.start_time);
          const running = log.duration === null;
          const duration =
            log.duration === null ? 'running' : formatDuration(log.duration);
          // The status lives here rather than in the row, which shows the
          // score instead; the colour is what carries the outcome now.
          const tooltip = [
            running ? 'still running' : `HTTP ${log.status}`,
            duration,
            log.model,
          ]
            .concat(
              score !== null && score !== undefined
                ? [`scored ${Math.round(score * 100)}%`]
                : ['not scored'],
            )
            .concat(tone === 'unreviewed' ? ['went unreviewed'] : [])
            .join(' · ');
          return (
            <li key={log.id}>
              <button
                type="button"
                ref={current ? currentRef : undefined}
                aria-current={current ? 'true' : undefined}
                onClick={() => onSelect(log)}
                title={tooltip}
                className={cn(
                  'w-full text-left px-3 py-1.5 border-l-2 transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                  current
                    ? 'border-primary bg-accent'
                    : 'border-transparent hover:bg-muted/60',
                )}
              >
                <div className="flex items-baseline justify-between gap-2 font-mono text-[11px] tabular-nums">
                  <span
                    className={
                      current ? 'text-foreground' : 'text-muted-foreground'
                    }
                  >
                    {time}
                  </span>
                  <span
                    className={cn('font-medium', TEXT_TONE[tone])}
                    title={outcome.title ?? outcome.label}
                  >
                    {score === null || score === undefined
                      ? '—'
                      : `${Math.round(score * 100)}%`}
                  </span>
                </div>
                {label && (
                  <div className="truncate text-[10px] text-muted-foreground">
                    {label}
                  </div>
                )}
                <div className="mt-1 flex items-center gap-1.5">
                  <div
                    className={cn(
                      'h-[3px] rounded-full min-w-[3px] shrink-0',
                      BAR_TONE[tone],
                    )}
                    // The longest request reaches the label's reserve; the
                    // rest are to scale, each read off at its own tip
                    style={{
                      width: `calc((100% - 2.75rem) * ${(log.duration ?? 0) / longest})`,
                    }}
                  />
                  <span className="text-[10px] tabular-nums text-muted-foreground shrink-0">
                    {duration}
                  </span>
                </div>
              </button>
            </li>
          );
        })}
        {hasLater && (
          <li className="px-3 py-1 text-[10px] text-muted-foreground">
            Later requests not shown
          </li>
        )}
      </ol>
    </nav>
  );
}
