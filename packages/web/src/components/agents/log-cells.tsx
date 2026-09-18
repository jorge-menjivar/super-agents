'use client';

import { PrettyFunctionName } from '@shared/types/api/request/function-name';
import type { LogSummary } from '@shared/types/data';
import { Badge } from '@web/components/ui/badge';
import { formatClockTime } from '@web/utils/time';
import { CheckCircle2, XCircle } from 'lucide-react';
import type { ReactElement } from 'react';
import { useEffect, useState } from 'react';

/**
 * The cells a log is read by, shared between the logs table and the dashboard
 * cards that summarise it.
 *
 * They take a `LogSummary` -- the row without the conversation, which is what
 * a list fetches -- and a whole `Log` satisfies that, so the log detail can
 * draw its own row with the same cells.
 *
 * They live together because they answer one question between them -- how did
 * this request go -- and because a row is now written when a request arrives
 * rather than when it finishes. Every surface showing a log therefore has to
 * render three states, not one, and the cost of them disagreeing is a card
 * that quietly cannot show a failure.
 */

/** How often the counter on a running request is redrawn. */
const PENDING_TICK_MS = 200;

/** A score at or above this reads as good. */
const GOOD_SCORE = 0.7;

/**
 * Fixed footprints for the three cells whose content changes as a request
 * progresses -- `running` is wider than `200`, a ticking `9.8s` narrower than
 * `12.4s`, and a score appears where a dash was.
 *
 * Without them every column downstream shifts as rows settle, and a table
 * with anything in flight drifts left and right while it is being read. The
 * widths live with the cells rather than with either table so that the two
 * cannot disagree about them.
 */
const STATUS_WIDTH = 'min-w-[5.5rem] justify-center';
const SCORE_WIDTH = 'inline-flex min-w-[3.25rem]';
const DURATION_WIDTH = 'inline-block min-w-[4.25rem]';

const statusVariant = (status: number | null) => {
  if (status === null) return 'secondary';
  if (status >= 200 && status < 300) return 'default';
  if (status >= 400) return 'destructive';
  return 'secondary';
};

/** Whether the request this log describes is still running. */
export const isRunning = (log: LogSummary): boolean => log.end_time === null;

/**
 * The duration of a request that has not finished, counting up.
 *
 * Measured from the row's own `start_time`, which the server wrote, so a
 * reload picks a running request up where it actually is. It owns its own
 * interval so that ticking costs one cell rather than the whole table: a page
 * of fifty finished rows has no reason to re-render five times a second
 * because one request is in flight.
 */
function TickingDuration({ startTime }: { startTime: number }): ReactElement {
  const [elapsed, setElapsed] = useState(() => Date.now() - startTime);

  useEffect(() => {
    const interval = setInterval(
      () => setElapsed(Date.now() - startTime),
      PENDING_TICK_MS,
    );
    return () => clearInterval(interval);
  }, [startTime]);

  return <>{(Math.max(elapsed, 0) / 1000).toFixed(1)}s</>;
}

/** How long the request took, or how long it has been going. */
export function LogDuration({ log }: { log: LogSummary }): ReactElement {
  return (
    <span className={`font-mono text-xs tabular-nums ${DURATION_WIDTH}`}>
      {isRunning(log) ? (
        <TickingDuration startTime={log.start_time} />
      ) : log.duration === null ? (
        'N/A'
      ) : (
        `${log.duration.toFixed(0)}ms`
      )}
    </span>
  );
}

/**
 * How the request ended: its status, or that it has not ended.
 *
 * A request that failed before reaching a provider still has the status the
 * caller was given, so a failure reads the same here whether it came from the
 * provider or from the gateway ahead of it.
 */
export function LogStatusBadge({ log }: { log: LogSummary }): ReactElement {
  if (isRunning(log)) {
    return (
      <Badge variant="secondary" className={`gap-1.5 ${STATUS_WIDTH}`}>
        <span className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse" />
        running
      </Badge>
    );
  }

  return (
    <Badge variant={statusVariant(log.status)} className={STATUS_WIDTH}>
      {log.status ?? '—'}
    </Badge>
  );
}

/** What a row's control is called, since the row itself is a line of cells. */
const requestLabel = (log: LogSummary): string =>
  `${log.function_name} at ${formatClockTime(log.start_time)}, ${
    isRunning(log) ? 'running' : (log.status ?? 'no status')
  }`;

/**
 * The control that opens a request, wrapped around the status badge every
 * row starts with.
 *
 * In the row rather than as the row: a `tr` is a row, and calling it a button
 * would take the table apart for anyone reading it as one. It has to be a
 * real control all the same -- React delegates the row's own click at the
 * document root, so there is no `onclick` in the DOM for a keyboard-driven
 * browser to find, and the row is reachable by pointer alone.
 */
export function LogRowHandle({
  log,
  onSelect,
}: {
  log: LogSummary;
  onSelect: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      aria-label={requestLabel(log)}
      className="rounded-md outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px]"
      onClick={(event) => {
        // The row opens the same request; once is enough.
        event.stopPropagation();
        onSelect();
      }}
    >
      <LogStatusBadge log={log} />
    </button>
  );
}

/** The judges' verdict, once there is one. */
export function LogEvalScore({ log }: { log: LogSummary }): ReactElement {
  const score = log.avg_eval_score;

  if (score === null || score === undefined) {
    return (
      <span className={`text-muted-foreground text-xs ${SCORE_WIDTH}`}>—</span>
    );
  }

  return (
    <div className={`items-center gap-1 ${SCORE_WIDTH}`}>
      {score >= GOOD_SCORE ? (
        <CheckCircle2 className="h-3 w-3 text-green-500" />
      ) : (
        <XCircle className="h-3 w-3 text-red-500" />
      )}
      <span className="font-mono text-xs">{(score * 100).toFixed(0)}%</span>
    </div>
  );
}

/**
 * What was asked of the model.
 *
 * The pretty name rather than the raw one: `chat_complete` is the wire
 * spelling, not something anyone reads a table by.
 */
export function LogFunction({ log }: { log: LogSummary }): ReactElement {
  return (
    <>{PrettyFunctionName[log.function_name] || log.function_name || 'N/A'}</>
  );
}

/** The model that served it, once one has. */
export function LogModel({ log }: { log: LogSummary }): ReactElement {
  return <span className="text-xs">{log.model ?? '—'}</span>;
}

/**
 * A name hanging off a log: the skill that served it, or the partition it
 * landed in.
 *
 * Both read as the same kind of thing and so are drawn the same way, on the
 * logs page and on the cards that summarise it. `mono` is for the generated
 * partition names, which are read character by character.
 */
export function LogTagBadge({
  value,
  mono = false,
  missing = '—',
}: {
  value: string | null | undefined;
  mono?: boolean;
  missing?: string;
}): ReactElement {
  if (!value) {
    return <span className="text-muted-foreground text-xs">{missing}</span>;
  }

  return (
    <Badge variant="outline" className={mono ? 'font-mono text-xs' : 'text-xs'}>
      {value}
    </Badge>
  );
}
