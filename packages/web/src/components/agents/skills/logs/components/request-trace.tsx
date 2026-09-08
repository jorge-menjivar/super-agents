'use client';

import type { TraceStage, TraceStageKind } from '@web/utils/log-trace';
import { formatDuration } from '@web/utils/time';
import { cn } from '@web/utils/ui/utils';
import type { CSSProperties, ReactElement } from 'react';

/**
 * A request drawn to scale: how long it took, and whose time it was.
 *
 * The gateway's own work is the neutral colour because it is overhead --
 * the point of the picture is usually how little of the bar the model got.
 * A stage keeps a floor of a couple of pixels so that a real one is never
 * invisible; the widths are otherwise the durations themselves.
 *
 * Each stage is named under its own part of the bar rather than in a legend
 * beside it, so the reading is positional: the label for the two minutes is
 * over the two minutes. A riser in the stage's own colour ties the two
 * together, and the labels alternate between two rows so that neighbours
 * never overlap however narrow their stages are.
 */

const STAGE_FILL: Record<TraceStageKind, string> = {
  gateway: 'bg-muted-foreground/40',
  provider: 'bg-teal-500',
  hook: 'bg-amber-500',
};

/** How far in from an edge a label may sit before it is anchored to it. */
const EDGE = 0.15;

/** Where the two rows of labels sit, and how far their risers reach. */
const ROW_TOP = [7, 24];
const RISER_HEIGHT = [5, 22];

interface PlacedStage extends TraceStage {
  /** The middle of its segment, as a share of the whole request. */
  middle: number;
}

/** Each stage told where its own segment sits along the bar. */
export function placeStages(stages: TraceStage[]): PlacedStage[] {
  const total = stages.reduce((sum, stage) => sum + stage.ms, 0) || 1;
  let cursor = 0;
  return stages.map((stage) => {
    const middle = (cursor + stage.ms / 2) / total;
    cursor += stage.ms;
    return { ...stage, middle };
  });
}

/** The whole request in a sentence, for a reader who cannot see the bar. */
export function describeTrace(stages: TraceStage[], total: number): string {
  const parts = stages
    .map((stage) => `${stage.label} ${formatDuration(stage.ms)}`)
    .join(', ');
  return `The request took ${formatDuration(total)}: ${parts}.`;
}

/**
 * A label sits over the middle of its stage, unless that would push it off
 * an end, where it is anchored to the end instead. Its riser stays at the
 * true middle either way, so it still points at what it names.
 */
function labelPosition(middle: number, row: number): CSSProperties {
  const top = ROW_TOP[row];
  if (middle < EDGE) return { top, left: 0 };
  if (middle > 1 - EDGE) return { top, right: 0 };
  return { top, left: `${middle * 100}%`, transform: 'translateX(-50%)' };
}

export function RequestTrace({
  stages,
  total,
}: {
  stages: TraceStage[];
  /** The request's own duration, which the stages divide. */
  total: number;
}): ReactElement {
  const placed = placeStages(stages);
  // Two stages sit at opposite ends and cannot collide; more than two do.
  const rows = stages.length > 2 ? 2 : 1;

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
        style={{ height: rows === 1 ? 22 : ROW_TOP[1] + 15 }}
      >
        {placed.map((stage, index) => {
          const row = rows === 1 ? 0 : index % 2;
          return (
            <span key={stage.key}>
              <span
                aria-hidden="true"
                className={cn('absolute top-0 w-px', STAGE_FILL[stage.kind])}
                style={{
                  left: `${stage.middle * 100}%`,
                  height: RISER_HEIGHT[row],
                }}
              />
              <span
                className="absolute whitespace-nowrap text-[11px] leading-none"
                style={labelPosition(stage.middle, row)}
                title={stage.detail}
              >
                <span className="text-muted-foreground">{stage.label} </span>
                <span className="font-mono font-medium tabular-nums">
                  {formatDuration(stage.ms)}
                </span>
              </span>
            </span>
          );
        })}
      </div>
    </section>
  );
}
