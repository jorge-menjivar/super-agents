/**
 * The window a performance chart is read over.
 *
 * One bucket size, thirty buckets: the reader picks how finely time is cut
 * and the window follows from it, rather than choosing both and having to
 * keep them consistent. So `1 Min` is the last half hour and `1 Day` the last
 * month, and every chart in the dashboard means the same thing by them.
 */
export type TimeInterval =
  | '1min'
  | '5min'
  | '15min'
  | '1hour'
  | '6hour'
  | '24hour';

/** How many buckets a chart draws, whatever the interval. */
export const CHART_BUCKETS = 30;

const across = (minutes: number) => (CHART_BUCKETS * minutes) / 60;

export const INTERVAL_CONFIG = {
  '1min': { label: '1 Min', minutes: 1, hours: across(1) },
  '5min': { label: '5 Min', minutes: 5, hours: across(5) },
  '15min': { label: '15 Min', minutes: 15, hours: across(15) },
  '1hour': { label: '1 Hour', minutes: 60, hours: across(60) },
  '6hour': { label: '6 Hours', minutes: 360, hours: across(360) },
  '24hour': { label: '1 Day', minutes: 1440, hours: across(1440) },
} as const satisfies Record<
  TimeInterval,
  { label: string; minutes: number; hours: number }
>;

export const TIME_INTERVALS = Object.keys(INTERVAL_CONFIG) as TimeInterval[];

/**
 * The interval this reader last chose, under `key`.
 *
 * Remembered rather than defaulted because it is how someone reads their
 * charts, not a property of what is being charted; stored per surface, since
 * an agent's month and one partition's half hour are different questions.
 */
export const storedInterval = (
  key: string,
  fallback: TimeInterval = '1hour',
): TimeInterval => {
  if (typeof window === 'undefined') return fallback;
  try {
    const stored = localStorage.getItem(key);
    if (stored && stored in INTERVAL_CONFIG) {
      return stored as TimeInterval;
    }
  } catch {
    // localStorage not available
  }
  return fallback;
};

export const rememberInterval = (key: string, interval: TimeInterval): void => {
  try {
    localStorage.setItem(key, interval);
  } catch {
    // localStorage not available
  }
};
