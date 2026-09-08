'use client';

import type { TraceStage, TraceStageKind } from '@web/utils/log-trace';
import { formatDuration } from '@web/utils/time';
import { cn } from '@web/utils/ui/utils';
import {
  type CSSProperties,
  type ReactElement,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from 'react';

/**
 * A request drawn to scale: how long it took, and whose time it was.
 *
 * The gateway's own work is the neutral colour because it is overhead -- the
 * point of the picture is usually how little of the bar the model got.
 *
 * Each stage is named under the bar, and the name begins exactly where its
 * own segment begins -- nothing sits in front of it, because anything that
 * did would be what lined up with the segment instead of the word. Names
 * that would run into one another drop to a row of their own rather than
 * crowd, and one that would run off the end is pulled back to it. Whether
 * two collide depends on how wide the card actually is, so the bar is
 * measured and the layout settled from that: the same three names that sit
 * on one line on a wide screen take three lines on a narrow one, which is
 * the only way they stay readable there.
 */

const STAGE_FILL: Record<TraceStageKind, string> = {
  gateway: 'bg-stone-300 dark:bg-stone-600',
  provider: 'bg-teal-600',
  hook: 'bg-amber-600',
};

/**
 * What a name takes: the width of a character at 11px and the air to leave
 * after it. Two names that just fit are better than a second row that was
 * not needed, so the estimate is close rather than cautious.
 */
const CHARACTER = 5.5;
const LABEL_PADDING = 8;

/**
 * The width to lay names out against before the bar has been measured --
 * the card's usual width. It stands in for the first paint and for a
 * renderer with no layout at all, and is replaced as soon as the real
 * width is known.
 */
const NOMINAL_WIDTH = 1300;

/** Where a row of names sits, and how far apart two rows are. */
const FIRST_ROW = 5;
const ROW_HEIGHT = 15;
const rowTop = (row: number): number => FIRST_ROW + row * ROW_HEIGHT;

export interface PlacedStage extends TraceStage {
  /** Where its segment begins, as a share of the whole request. */
  start: number;
  row: number;
  /** Its name would run off the end, so it is pulled back to it. */
  atEnd: boolean;
}

const labelOf = (stage: TraceStage): string =>
  `${stage.label} ${formatDuration(stage.ms)}`;

/** The share of the bar a stage's name needs at a given width. */
const widthShare = (stage: TraceStage, width: number): number =>
  (labelOf(stage).length * CHARACTER + LABEL_PADDING) / width;

/**
 * Every stage told where its name goes: at its own segment's start, on the
 * first row that has room for it. A name with nowhere left goes on a row of
 * its own, however many that takes -- crowding two into one line would lose
 * both, and on a narrow card that is what would happen to every name.
 */
export function placeStages(
  stages: TraceStage[],
  width: number = NOMINAL_WIDTH,
): PlacedStage[] {
  const total = stages.reduce((sum, stage) => sum + stage.ms, 0) || 1;
  // How far along each row is already spoken for.
  const filled: number[] = [];
  let cursor = 0;

  return stages.map((stage) => {
    const start = cursor / total;
    cursor += stage.ms;
    const share = widthShare(stage, width);
    const atEnd = start + share > 1;
    // A name pulled back to the end takes the room before the end, not the
    // room after its own segment, and that is what has to clear the row.
    const from = atEnd ? Math.max(0, 1 - share) : start;
    let row = filled.findIndex((taken) => from >= taken);
    if (row === -1) {
      row = filled.length;
      filled.push(0);
    }
    filled[row] = atEnd ? 1 : start + share;
    return { ...stage, start, row, atEnd };
  });
}

/** The whole request in a sentence, for a reader who cannot see the bar. */
export function describeTrace(stages: TraceStage[], total: number): string {
  const parts = stages
    .map((stage) => `${stage.label} ${formatDuration(stage.ms)}`)
    .join(', ');
  return `The request took ${formatDuration(total)}: ${parts}.`;
}

const labelPosition = (stage: PlacedStage): CSSProperties =>
  stage.atEnd
    ? { top: rowTop(stage.row), right: 0 }
    : { top: rowTop(stage.row), left: `${stage.start * 100}%` };

/**
 * The width the names are laid out against, as the card is resized. Until
 * the bar has been measured -- the first paint, or a renderer with no
 * layout -- the nominal width stands in.
 */
function useBarWidth(): [RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(NOMINAL_WIDTH);

  useEffect(() => {
    const bar = ref.current;
    if (!bar) return;
    const observer = new ResizeObserver(() => {
      const measured = bar.getBoundingClientRect().width;
      if (measured > 0) setWidth(measured);
    });
    observer.observe(bar);
    return () => observer.disconnect();
  }, []);

  return [ref, width];
}

export function RequestTrace({
  stages,
  total,
}: {
  stages: TraceStage[];
  /** The request's own duration, which the stages divide. */
  total: number;
}): ReactElement {
  const [barRef, width] = useBarWidth();
  const placed = placeStages(stages, width);
  const rows = placed.reduce((most, stage) => Math.max(most, stage.row), 0) + 1;

  return (
    <section aria-label="Timing" className="px-4 pt-3 pb-2 border-b">
      <div
        ref={barRef}
        className="flex h-2.5 gap-px overflow-hidden rounded-sm bg-muted"
        role="img"
        aria-label={describeTrace(stages, total)}
      >
        {placed.map((stage) => (
          <div
            key={stage.key}
            title={`${stage.label} — ${formatDuration(stage.ms)}. ${stage.detail}`}
            className={cn('min-w-[2px] basis-0', STAGE_FILL[stage.kind])}
            style={{ flexGrow: stage.ms }}
          />
        ))}
      </div>
      <div
        className="relative"
        style={{ height: rowTop(rows - 1) + 14 }}
        data-testid="trace-labels"
      >
        {placed.map((stage) => (
          <span
            key={stage.key}
            className="absolute whitespace-nowrap text-[11px] leading-none"
            style={labelPosition(stage)}
            title={stage.detail}
          >
            <span className="text-muted-foreground">{stage.label} </span>
            <span className="font-mono font-medium tabular-nums">
              {formatDuration(stage.ms)}
            </span>
          </span>
        ))}
      </div>
    </section>
  );
}
