'use client';

import type { TraceStage, TraceStageKind } from '@web/utils/log-trace';
import { formatDuration } from '@web/utils/time';
import { cn } from '@web/utils/ui/utils';
import type { ReactElement } from 'react';

/**
 * A request drawn to scale: how long it took, and whose time it was.
 *
 * The gateway's own work is the neutral colour because it is overhead --
 * the point of the picture is usually how little of the bar the model got.
 * A stage keeps a floor of a couple of pixels so that a real one is never
 * invisible; the widths are otherwise the durations themselves.
 */

const STAGE_FILL: Record<TraceStageKind, string> = {
  gateway: 'bg-muted-foreground/40',
  provider: 'bg-teal-500',
  hook: 'bg-amber-500',
};

/** The whole request in a sentence, for a reader who cannot see the bar. */
export function describeTrace(stages: TraceStage[], total: number): string {
  const parts = stages
    .map((stage) => `${stage.label} ${formatDuration(stage.ms)}`)
    .join(', ');
  return `The request took ${formatDuration(total)}: ${parts}.`;
}

export function RequestTrace({
  stages,
  total,
}: {
  stages: TraceStage[];
  /** The request's own duration, which the stages divide. */
  total: number;
}): ReactElement {
  const description = describeTrace(stages, total);

  return (
    <section aria-label="Timing" className="px-4 py-3 border-b">
      <div
        className="flex h-2.5 gap-px overflow-hidden rounded-sm bg-muted"
        role="img"
        aria-label={description}
      >
        {stages.map((stage) => (
          <div
            key={stage.key}
            title={`${stage.label} — ${formatDuration(stage.ms)}. ${stage.detail}`}
            className={cn('min-w-[2px] basis-0', STAGE_FILL[stage.kind])}
            style={{ flexGrow: stage.ms }}
          />
        ))}
      </div>
      <div className="mt-2 flex flex-row flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
        {stages.map((stage) => (
          <span
            key={stage.key}
            className="flex items-center gap-1.5"
            title={stage.detail}
          >
            <span
              className={cn('h-2 w-2 rounded-[2px]', STAGE_FILL[stage.kind])}
            />
            <span className="text-muted-foreground">{stage.label}</span>
            <span className="font-mono tabular-nums">
              {formatDuration(stage.ms)}
            </span>
          </span>
        ))}
        <span className="ml-auto flex items-center gap-1.5">
          <span className="text-muted-foreground">total</span>
          <span className="font-mono font-medium tabular-nums">
            {formatDuration(total)}
          </span>
        </span>
      </div>
    </section>
  );
}
