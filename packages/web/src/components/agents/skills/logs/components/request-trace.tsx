'use client';

import type { TraceStage, TraceStageKind } from '@web/utils/log-trace';
import { formatDuration } from '@web/utils/time';
import { cn } from '@web/utils/ui/utils';
import type { CSSProperties, ReactElement } from 'react';

/**
 * A request drawn to scale: how long it took, and whose time it was.
 *
 * The gateway's own work is the neutral colour because it is overhead -- the
 * point of the picture is usually how little of the bar the model got.
 *
 * Each stage is named under the bar, and the name begins exactly where its
 * own segment begins -- nothing sits in front of it, because anything that
 * did would be what lined up with the segment instead of the word. Names
 * that would run into one another drop to a second row rather than crowd,
 * and one that would run off the end is pulled back to it. Whether two
 * collide is worked out from the text itself, so the layout is settled
 * before anything is drawn and never moves once it is.
 */

const STAGE_FILL: Record<TraceStageKind, string> = {
  gateway: 'bg-stone-300 dark:bg-stone-600',
  provider: 'bg-teal-600',
  hook: 'bg-amber-600',
};

/**
 * What a name is assumed to take, for deciding whether two of them fit
 * beside each other: the card's usual width, the width of a character at
 * 11px, and the air to leave after it. Two names that just fit are better
 * than a second row that was not needed, so the guess is close rather than
 * cautious; a pair that overruns it on a narrow card sit tight rather than
 * break anything.
 */
const NOMINAL_WIDTH = 1300;
const CHARACTER = 5.5;
const LABEL_PADDING = 8;

/** Where the two rows of names sit. */
const ROW_TOP = [5, 20];

export interface PlacedStage extends TraceStage {
  /** Where its segment begins, as a share of the whole request. */
  start: number;
  row: number;
  /** Its name would run off the end, so it is pulled back to it. */
  atEnd: boolean;
}

const labelOf = (stage: TraceStage): string =>
  `${stage.label} ${formatDuration(stage.ms)}`;

/** The share of the bar a stage's name is assumed to need. */
const widthShare = (stage: TraceStage): number =>
  (labelOf(stage).length * CHARACTER + LABEL_PADDING) / NOMINAL_WIDTH;

/**
 * Every stage told where its name goes: at its own segment's start, on the
 * first row that has room for it.
 */
export function placeStages(stages: TraceStage[]): PlacedStage[] {
  const total = stages.reduce((sum, stage) => sum + stage.ms, 0) || 1;
  // How far along each row is already spoken for.
  const filled = [0, 0];
  let cursor = 0;

  return stages.map((stage) => {
    const start = cursor / total;
    cursor += stage.ms;
    const width = widthShare(stage);
    const row = start >= filled[0] ? 0 : 1;
    filled[row] = start + width;
    return { ...stage, start, row, atEnd: start + width > 1 };
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
    ? { top: ROW_TOP[stage.row], right: 0 }
    : { top: ROW_TOP[stage.row], left: `${stage.start * 100}%` };

export function RequestTrace({
  stages,
  total,
}: {
  stages: TraceStage[];
  /** The request's own duration, which the stages divide. */
  total: number;
}): ReactElement {
  const placed = placeStages(stages);
  const rows = placed.some((stage) => stage.row === 1) ? 2 : 1;

  return (
    <section aria-label="Timing" className="px-4 pt-3 pb-2 border-b">
      <div
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
        style={{ height: ROW_TOP[rows - 1] + 14 }}
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
