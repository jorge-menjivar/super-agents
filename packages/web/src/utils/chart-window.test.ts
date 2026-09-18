import {
  bucketsForWindow,
  carriedFromLabel,
  scoreRangeForWindow,
  seriesAcrossWindow,
} from '@web/utils/chart-window';
import { describe, expect, it } from 'vitest';

const HOUR = 60 * 60 * 1000;

/** Six hourly buckets ending at a round hour, the shape the charts draw. */
const hourlyBuckets = (endTime: number, hours = 5) =>
  bucketsForWindow({
    endTime: new Date(endTime),
    windowHours: hours,
    intervalMinutes: 60,
  });

const END = Date.parse('2026-09-15T18:00:00Z');

describe('bucketsForWindow', () => {
  it('lands on the grid the server buckets to, whatever the size', () => {
    for (const intervalMinutes of [1, 5, 15, 60, 360, 1440]) {
      const buckets = bucketsForWindow({
        // Deliberately not on any boundary
        endTime: new Date(Date.parse('2026-09-15T19:27:43.123Z')),
        windowHours: (30 * intervalMinutes) / 60,
        intervalMinutes,
      });
      const intervalMs = intervalMinutes * 60 * 1000;
      expect(
        buckets.every((bucket) => bucket.time.getTime() % intervalMs === 0),
      ).toBe(true);
      // The window, plus the partial bucket the end time falls inside
      expect(buckets.length).toBeGreaterThanOrEqual(30);
    }
  });

  it('runs oldest first, a bucket apart, up to the end time', () => {
    const buckets = hourlyBuckets(END);

    expect(buckets.map((b) => b.time.toISOString())).toEqual([
      '2026-09-15T13:00:00.000Z',
      '2026-09-15T14:00:00.000Z',
      '2026-09-15T15:00:00.000Z',
      '2026-09-15T16:00:00.000Z',
      '2026-09-15T17:00:00.000Z',
      '2026-09-15T18:00:00.000Z',
    ]);
  });

  it('labels a narrow chart with the time alone', () => {
    const [wide] = hourlyBuckets(END);
    const [narrow] = bucketsForWindow({
      endTime: new Date(END),
      windowHours: 5,
      intervalMinutes: 60,
      compact: true,
    });

    expect(wide.label).toMatch(/^Sep 15, /);
    expect(narrow.label).not.toMatch(/Sep/);
  });

  it('still names a day bucket by its date on a narrow chart', () => {
    // Every day bucket starts at the same time, so a time would label them
    // all alike.
    const [narrow] = bucketsForWindow({
      endTime: new Date(END),
      windowHours: 24 * 5,
      intervalMinutes: 1440,
      compact: true,
    });

    expect(narrow.label).toMatch(/^Sep \d+$/);
  });
});

describe('scoreRangeForWindow', () => {
  it('asks for the window itself, and for the buckets either side of it', () => {
    const range = scoreRangeForWindow(new Date(END), 5, 60);

    expect(Date.parse(range.start_time)).toBe(END - 5 * HOUR);
    expect(Date.parse(range.end_time)).toBe(END);
    // However old those neighbours are. Widening the range instead meant
    // paying for everything in between, and giving up at a cutoff.
    expect(range.include_edge_buckets).toBe(true);
  });

  it('starts on a bucket boundary, so the edge bucket is really outside', () => {
    // A quarter past the hour, with hour buckets: an unaligned start would
    // name the chart's own first bucket as the one before it.
    const range = scoreRangeForWindow(new Date(END + 15 * 60 * 1000), 5, 60);

    expect(Date.parse(range.start_time) % HOUR).toBe(0);
  });
});

describe('seriesAcrossWindow', () => {
  const buckets = hourlyBuckets(END);
  const at = (index: number) => buckets[index].time.getTime();

  it('lays scores on their buckets and leaves the rest null', () => {
    const series = seriesAcrossWindow(
      new Map([
        [at(2), 80],
        [at(3), 90],
      ]),
      buckets,
    );

    expect(series.data).toEqual([null, null, 80, 90, null, 90]);
    expect(series.measured).toBe(2);
    // Only the carry to the right edge, which is not a measurement
    expect(series.edges).toEqual(new Set([5]));
  });

  it('crosses the left edge at the slope of the point before the window', () => {
    // 60 an hour before the window, 80 two hours into it: three hours for
    // twenty points, so the segment stands a third of the way up at the edge.
    const series = seriesAcrossWindow(
      new Map([
        [at(0) - HOUR, 60],
        [at(2), 80],
      ]),
      buckets,
    );

    expect(series.data[0]).toBe(66.66666666666667);
    expect(series.edges.has(0)).toBe(true);
    // A real segment, so it is drawn solid rather than as a carry
    expect(series.carried.has(0)).toBe(false);
    // The edge is not a score, and the rest of the gap stays empty
    expect(series.measured).toBe(1);
    expect(series.data[1]).toBeNull();
  });

  it('crosses the right edge the same way, when the window ends in the past', () => {
    const series = seriesAcrossWindow(
      new Map([
        [at(3), 40],
        [at(5) + HOUR, 70],
      ]),
      buckets,
    );

    expect(series.data[5]).toBe(60);
    expect(series.edges.has(5)).toBe(true);
  });

  it('carries the last score to the right edge, and says where it came from', () => {
    const series = seriesAcrossWindow(new Map([[at(2), 80]]), buckets);

    expect(series.data).toEqual([null, null, 80, null, null, 80]);
    expect(series.edges).toEqual(new Set([5]));
    // Not just that it was carried, but from which bucket: a dash says the
    // value was not measured here, and only this says when it was.
    expect(series.carried.get(5)).toBe(at(2));
  });

  it('never carries a line backwards past its first score', () => {
    const series = seriesAcrossWindow(new Map([[at(2), 80]]), buckets);

    // Nothing is known before a skill's first score, so the line begins there
    expect(series.data[0]).toBeNull();
    expect(series.data[1]).toBeNull();
  });

  it('carries a series that went quiet before the window across all of it', () => {
    const series = seriesAcrossWindow(
      new Map([[at(0) - 200 * HOUR, 64]]),
      buckets,
    );

    expect(series.data[0]).toBe(64);
    expect(series.data[5]).toBe(64);
    // Both ends carried, both from the one score that exists
    expect([...series.carried.values()]).toEqual([
      at(0) - 200 * HOUR,
      at(0) - 200 * HOUR,
    ]);
    expect(series.measured).toBe(0);
  });

  it('prefers a real crossing to a carry when the series is known on both sides', () => {
    const series = seriesAcrossWindow(
      new Map([
        [at(0) - HOUR, 50],
        [at(5) + HOUR, 120],
      ]),
      buckets,
    );

    expect(series.carried.size).toBe(0);
  });

  it('spans the window for a series known only on both sides of it', () => {
    const series = seriesAcrossWindow(
      new Map([
        [at(0) - HOUR, 50],
        [at(5) + HOUR, 120],
      ]),
      buckets,
    );

    expect(series.data[0]).toBe(60);
    expect(series.data[5]).toBe(110);
    expect(series.measured).toBe(0);
    expect(series.edges).toEqual(new Set([0, 5]));
  });

  it('names a carry by when it was last measured', () => {
    const now = Date.parse('2026-09-17T14:00:00Z');

    // Today needs no date; this year needs no year; an old one says the year,
    // which is the whole point -- it is what a dash cannot say.
    expect(carriedFromLabel(Date.parse('2026-09-17T09:30:00Z'), now)).toMatch(
      /^\d{1,2}:\d{2} (AM|PM)$/,
    );
    expect(carriedFromLabel(Date.parse('2026-09-05T09:00:00Z'), now)).toBe(
      'Sep 5',
    );
    expect(carriedFromLabel(Date.parse('2024-09-05T09:00:00Z'), now)).toBe(
      'Sep 5, 2024',
    );
  });

  it('draws nothing for a series whose only score comes after the window', () => {
    // A skill that had not started yet has nothing to carry forward
    const series = seriesAcrossWindow(
      new Map([[at(5) + 100 * HOUR, 50]]),
      buckets,
    );

    expect(series.data.every((value) => value === null)).toBe(true);
    expect(series.edges.size).toBe(0);
  });

  it('reaches both edges from a single score inside the window', () => {
    const series = seriesAcrossWindow(
      new Map([
        [at(0) - HOUR, 0],
        [at(2), 20],
        [at(5) + HOUR, 20],
      ]),
      buckets,
    );

    expect(series.data[0]).toBeCloseTo(6.667, 3);
    expect(series.data[5]).toBe(20);
    expect(series.measured).toBe(1);
  });
});
