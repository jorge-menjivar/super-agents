import { format } from 'date-fns';

/** A column of a performance chart: the bucket it stands for, and its tick. */
export interface ChartBucket {
  /** The bucket's start, which is where its score is drawn */
  time: Date;
  label: string;
}

export interface ChartWindow {
  /** The right edge of the chart */
  endTime: Date;
  windowHours: number;
  intervalMinutes: number;
  /** A narrow chart, which has room for a time and nothing else */
  compact?: boolean;
}

const labelFor = (
  time: Date,
  intervalMinutes: number,
  compact: boolean,
): string => {
  // A day's bucket is named by its date even on a narrow chart: the time is
  // the same for every one of them, so it would label thirty columns alike.
  if (intervalMinutes >= 1440) return format(time, 'MMM d');
  if (compact) return format(time, intervalMinutes >= 60 ? 'ha' : 'h:mm a');
  if (intervalMinutes >= 60) return format(time, 'MMM d, ha');
  return format(time, 'MMM d, h:mm a');
};

/**
 * The buckets a chart draws for its window, oldest first.
 *
 * Aligned to the epoch at the bucket size, which is where the server puts
 * them: `aggregateScoresByTimeBucket`, and the plpgsql it replaces, floor each
 * run's time to a multiple of the interval, and a series is matched to this
 * grid by bucket start. Rounding to the local hour instead -- as all three
 * charts used to -- lands between the server's buckets for every size that is
 * not a divisor of an hour: at six hours and at a day not one bucket of the
 * thirty matched, so those charts drew nothing at all.
 */
export function bucketsForWindow({
  endTime,
  windowHours,
  intervalMinutes,
  compact = false,
}: ChartWindow): ChartBucket[] {
  const intervalMs = intervalMinutes * 60 * 1000;
  const end = endTime.getTime();
  const start =
    Math.floor((end - windowHours * 60 * 60 * 1000) / intervalMs) * intervalMs;

  const buckets: ChartBucket[] = [];
  for (let time = start; time <= end; time += intervalMs) {
    const at = new Date(time);
    buckets.push({ time: at, label: labelFor(at, intervalMinutes, compact) });
  }
  return buckets;
}

/**
 * The range to ask the server for in order to draw a window of `windowHours`
 * ending at `endTime`, with `include_edge_buckets` so that the bucket nearest
 * outside each end comes back too.
 *
 * Exactly the window, aligned to the bucket grid the chart draws on: the edge
 * buckets are the ones outside *that*, so an unaligned start would name the
 * chart's own first bucket as the one before it. Asking the server for the
 * neighbours is what removes the reach this used to guess at -- it widened
 * the range instead, which meant paying for every bucket in between and gave
 * up at a cutoff, so a skill quiet for longer than the cutoff simply vanished.
 */
export function scoreRangeForWindow(
  endTime: Date,
  windowHours: number,
  intervalMinutes: number,
): {
  start_time: string;
  end_time: string;
  include_edge_buckets: true;
} {
  const intervalMs = intervalMinutes * 60 * 1000;
  const end = endTime.getTime();
  const start =
    Math.floor((end - windowHours * 60 * 60 * 1000) / intervalMs) * intervalMs;
  return {
    start_time: new Date(start).toISOString(),
    end_time: new Date(end).toISOString(),
    include_edge_buckets: true,
  };
}

export interface WindowSeries {
  /** One value per bucket, null where nothing was scored */
  data: (number | null)[];
  /** Indices holding where the line meets an edge, rather than a score */
  edges: Set<number>;
  /**
   * Indices the line was carried to rather than measured toward. The stretch
   * ending at one is drawn dashed, which is the whole reason it may be drawn
   * at all: it says the score is the last one known, not a new one.
   */
  carried: Set<number>;
  /** How many buckets carry a score */
  measured: number;
}

/** Where a straight line through two points stands at `time`. */
const valueAt = (
  time: number,
  [from, fromValue]: [number, number],
  [to, toValue]: [number, number],
): number =>
  to === from
    ? toValue
    : fromValue + ((toValue - fromValue) * (time - from)) / (to - from);

/**
 * A series laid across the window's buckets, drawn out to the edges it
 * actually reaches.
 *
 * A line used to begin at its first scored bucket and end at its last, which
 * is true but reads as though the metric began and ended there. What it really
 * does is cross the window: the point just outside an edge and the first one
 * inside it are the two ends of one segment, and this works out where that
 * segment meets the edge. Both ends are measurements, so the line enters at
 * the slope the data has rather than at one invented to fill the space --
 * which is why `scores` is given every point fetched, inside the window and
 * out.
 *
 * Past its last score a line is *carried* instead: held flat out to the right
 * edge and marked in `carried`, so the chart can draw it dashed. That is the
 * last-known-value reading of a metric -- the newest thing known about the
 * skill, still standing -- and it is what lets a skill that has been quiet for
 * days appear at all, carried across the whole window from a score that sits
 * before it.
 *
 * Backwards it is never carried. Nothing is known about a skill before its
 * first score, and a line held back to the left edge would say its score was
 * that value before anyone had measured it; only a real segment from an
 * earlier point brings a line in at that edge.
 */
export function seriesAcrossWindow(
  scores: Map<number, number>,
  buckets: ChartBucket[],
): WindowSeries {
  const times = buckets.map((bucket) => bucket.time.getTime());
  const data = times.map((time) => scores.get(time) ?? null);
  const edges = new Set<number>();
  const carried = new Set<number>();
  const measured = data.filter((value) => value !== null).length;

  const last = times.length - 1;
  if (last < 0) {
    return { data, edges, carried, measured };
  }

  // The nearest point beyond each edge, which is the far end of the segment
  // that crosses it.
  let before: [number, number] | undefined;
  let after: [number, number] | undefined;
  for (const point of scores) {
    const [time] = point;
    if (time < times[0] && (before === undefined || time > before[0])) {
      before = point;
    }
    if (time > times[last] && (after === undefined || time < after[0])) {
      after = point;
    }
  }

  const first = data.findIndex((value) => value !== null);
  const final = data.findLastIndex((value) => value !== null);

  if (first === -1) {
    if (before !== undefined && after !== undefined) {
      // Nothing was scored inside the window, but the series is known on both
      // sides: one real segment spanning the whole chart.
      data[0] = valueAt(times[0], before, after);
      data[last] = valueAt(times[last], before, after);
      edges.add(0);
      edges.add(last);
    } else if (before !== undefined) {
      // A skill that has been quiet since before the window opened. Its last
      // score is carried across, dashed, rather than the skill vanishing.
      data[0] = before[1];
      data[last] = before[1];
      for (const index of [0, last]) {
        edges.add(index);
        carried.add(index);
      }
    }
    return { data, edges, carried, measured };
  }

  if (first > 0 && before !== undefined) {
    data[0] = valueAt(times[0], before, [times[first], data[first] as number]);
    edges.add(0);
  }
  if (final < last) {
    if (after !== undefined) {
      data[last] = valueAt(
        times[last],
        [times[final], data[final] as number],
        after,
      );
    } else {
      // Nothing since: the last score stands, carried to the edge.
      data[last] = data[final];
      carried.add(last);
    }
    edges.add(last);
  }

  return { data, edges, carried, measured };
}
