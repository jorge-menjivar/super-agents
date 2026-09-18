'use client';

import type { LogSummary } from '@shared/types/data';
import {
  isRunning,
  LogDuration,
  LogEvalScore,
  LogFunction,
  LogModel,
  LogStatusBadge,
} from '@web/components/agents/log-cells';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@web/components/ui/table';
import { formatClockTime } from '@web/utils/time';
import { cn } from '@web/utils/ui/utils';
import type { ReactElement, ReactNode } from 'react';

/**
 * The "recent requests" table both dashboards show, reading the same way the
 * logs page does: how the request ended, how it was judged, and how long it
 * took, rather than only what was asked of it.
 *
 * Shared between the agent's card and the skill's because the two differ in
 * one column -- which skill served the request, or which partition it landed
 * in -- and in nothing else. Kept narrower than the full logs table, which
 * has room for the endpoint, the trace and the inference parameters; a card
 * that carried all of those would be read as neither.
 */
export interface RecentLogsTableProps {
  logs: LogSummary[];
  /** The column that differs: the skill across an agent, the partition within one. */
  context: {
    header: string;
    render: (log: LogSummary) => ReactNode;
  };
  /** How many rows the card has room for. */
  limit?: number;
  /**
   * Opens one request. Given one, each row is a way into its own log rather
   * than five lines of text under a card that goes somewhere else.
   */
  onLogSelect?: (log: LogSummary) => void;
}

/** What a row's control is called, since the row itself is seven cells. */
const requestLabel = (log: LogSummary): string =>
  `${log.function_name} at ${formatClockTime(log.start_time)}, ${
    isRunning(log) ? 'running' : (log.status ?? 'no status')
  }`;

export function RecentLogsTable({
  logs,
  context,
  limit = 5,
  onLogSelect,
}: RecentLogsTableProps): ReactElement {
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead>Status</TableHead>
          <TableHead>Eval</TableHead>
          <TableHead>Function</TableHead>
          <TableHead>Model</TableHead>
          <TableHead>{context.header}</TableHead>
          <TableHead>Time</TableHead>
          <TableHead className="text-right">Duration</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {logs.slice(0, limit).map((log) => (
          <TableRow
            key={log.id}
            className={cn(
              isRunning(log)
                ? 'bg-muted/30 hover:bg-muted/30'
                : 'hover:bg-transparent',
              onLogSelect && 'cursor-pointer hover:bg-muted/50',
            )}
            data-testid={isRunning(log) ? 'running-log-row' : undefined}
            onClick={onLogSelect ? () => onLogSelect(log) : undefined}
          >
            <TableCell>
              {onLogSelect ? (
                /**
                 * The status badge is the row's handle rather than the row
                 * itself: a `tr` is a row, and calling it a button would take
                 * the table apart for anyone reading it as one. A real button
                 * in the row is what a keyboard tabs to and what a
                 * keyboard-driven browser can find -- React delegates the
                 * row's own click at the document root, so there is no
                 * `onclick` in the DOM for anything to see.
                 */
                <button
                  type="button"
                  aria-label={requestLabel(log)}
                  className="rounded-md outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                  onClick={(event) => {
                    event.stopPropagation();
                    onLogSelect(log);
                  }}
                >
                  <LogStatusBadge log={log} />
                </button>
              ) : (
                <LogStatusBadge log={log} />
              )}
            </TableCell>
            <TableCell>
              <LogEvalScore log={log} />
            </TableCell>
            <TableCell>
              <LogFunction log={log} />
            </TableCell>
            <TableCell>
              <LogModel log={log} />
            </TableCell>
            <TableCell>{context.render(log)}</TableCell>
            <TableCell className="text-muted-foreground whitespace-nowrap">
              {formatClockTime(log.start_time)}
            </TableCell>
            <TableCell className="text-right text-muted-foreground">
              <LogDuration log={log} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
