import { format } from 'date-fns';

/**
 * When a request happened, as every log surface writes it: the log's page
 * header, its card, the logs table. Twelve-hour clock, seconds kept, since
 * requests in one session are seconds apart.
 */
export function formatLogTimestamp(ms: number): string {
  return format(new Date(ms), 'MMM d, h:mm:ss a');
}

/**
 * The time of day alone, for a run of requests that all share their date --
 * a session's rail -- where repeating it would only take up room.
 */
export function formatClockTime(ms: number): string {
  return format(new Date(ms), 'h:mm:ss a');
}

/**
 * A length of time, in the unit a reader would say: a request's, a hook's,
 * or a whole session's.
 */
export function formatDuration(ms: number): string {
  if (ms < 1_000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`;
  if (ms < 3_600_000) {
    const minutes = Math.floor(ms / 60_000);
    const seconds = Math.round((ms % 60_000) / 1_000);
    return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}
