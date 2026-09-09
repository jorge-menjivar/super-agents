import type { Log } from '@shared/types/data/log';
import { HookType } from '@shared/types/middleware/hooks';
import { readSkillRouting } from '@web/utils/skill-routing';

/**
 * A request's passage through the gateway, read off the row it left.
 *
 * The row already carries every mark this needs: when the request arrived
 * and when it was answered, when the provider was asked and when it had
 * answered, and when each hook ran. What it does not carry is the shape --
 * that the model's own 8 seconds sat inside two minutes, and that the rest
 * was the gateway's. Splitting the span at the marks is what shows it.
 */

export type TraceStageKind = 'gateway' | 'provider' | 'hook';

export interface TraceStage {
  key: string;
  kind: TraceStageKind;
  /** What the stage was, in a word: the ribbon is a shape, not a legend. */
  label: string;
  /** The whole of it, for a reader who stops on the stage. */
  detail: string;
  ms: number;
}

/**
 * A gap in the gateway's own work shorter than this is not a stage of the
 * request, it is the cost of moving between two of them. Naming it would
 * put "gateway 4ms" beside the two minutes that matter.
 */
const NOISE_MS = 50;

interface KnownSpan {
  kind: 'provider' | 'hook';
  label: string;
  detail: string;
  from: number;
  to: number;
}

/** The spans the row records outright, in the order they happened. */
function knownSpans(log: Log): KnownSpan[] {
  const spans: KnownSpan[] = [];

  const provider = log.ai_provider_request_log;
  if (provider?.start_time !== undefined && provider.end_time !== undefined) {
    const firstToken =
      log.first_token_time !== null
        ? ` Its first token arrived after ${log.first_token_time - provider.start_time}ms.`
        : '';
    spans.push({
      kind: 'provider',
      label: 'provider',
      detail: `The provider answering, for the attempt that answered.${firstToken}`,
      from: provider.start_time,
      to: provider.end_time,
    });
  }

  for (const hookLog of log.hook_logs) {
    // A hook that was skipped never ran, so it is not a stage of anything.
    if (hookLog.result.skipped) continue;
    const judged =
      hookLog.hook.type === HookType.INPUT_HOOK ? 'request' : 'response';
    spans.push({
      kind: 'hook',
      label: hookLog.hook.type === HookType.INPUT_HOOK ? 'check' : 'review',
      detail: `The "${hookLog.hook.id}" hook judging the ${judged}.`,
      from: hookLog.start_time,
      to: hookLog.end_time,
    });
  }

  return spans.sort((a, b) => a.from - b.from);
}

/** What the gateway was doing in a gap, by where the gap falls. */
function gatewayStage(
  index: number,
  first: boolean,
  last: boolean,
): {
  label: string;
  detail: string;
} {
  if (first) {
    return {
      label: 'setup',
      detail:
        "Embedding the request, pulling the configuration that served it, and the gateway's own setup, before anything else had run.",
    };
  }
  if (last) {
    return {
      label: 'response',
      detail: 'Building the response the client received.',
    };
  }
  return {
    label: 'gateway',
    detail: `The gateway's own work between stage ${index} and the next.`,
  };
}

/**
 * The stages of a finished request, in order, or null when the row cannot
 * say. A request still running has no shape yet, and one that reached
 * neither a provider nor a hook -- an unknown agent, a cache hit -- is a
 * single undivided span, which a ribbon would draw as one bar saying
 * nothing.
 */
export function traceOf(log: Log): TraceStage[] | null {
  if (log.end_time === null) return null;

  const start = log.start_time;
  const total = log.end_time - start;
  if (total <= 0) return null;

  // Clamped into the row's own span, since a clock that moved between two
  // recordings should cost a stage its width rather than the whole ribbon.
  const known = knownSpans(log)
    .map((span) => ({
      ...span,
      from: Math.min(Math.max(span.from, start), log.end_time as number),
      to: Math.min(Math.max(span.to, start), log.end_time as number),
    }))
    .filter((span) => span.to > span.from);

  if (known.length === 0) return null;

  const stages: TraceStage[] = [];
  let cursor = start;

  // The one piece of the gateway's own work the row times: choosing the
  // skill, for a request that named only the agent. It happens at the head
  // of the first gap, so the gap is split at it rather than drawn as one
  // bar that hides the model call inside it.
  const routingMs = readSkillRouting(log.metadata)?.duration_ms ?? null;

  known.forEach((span, index) => {
    // Overlapping spans are read as one after another: a hook that started
    // before the previous stage ended keeps only the part that is its own.
    const from = Math.max(span.from, cursor);
    const gap = from - cursor;
    const first = cursor === start;
    // Only what is left of the gap once routing has had its share; a
    // measurement longer than the gap it sits in takes the whole of it.
    const routed = first && routingMs !== null ? Math.min(routingMs, gap) : 0;
    if (routed > 0) {
      stages.push({
        key: `routing-${cursor}`,
        kind: 'gateway',
        label: 'routing',
        detail:
          'Choosing the skill for a request that named only its agent: embedding it, and on a miss the arbiter and the skill it created.',
        ms: routed,
      });
    }
    if (gap - routed >= NOISE_MS) {
      const where = gatewayStage(stages.length, first, false);
      stages.push({
        key: `gateway-${cursor}`,
        kind: 'gateway',
        label: where.label,
        detail: where.detail,
        ms: gap - routed,
      });
    }
    if (span.to > from) {
      stages.push({
        key: `${span.kind}-${index}-${span.from}`,
        kind: span.kind,
        label: span.label,
        detail: span.detail,
        ms: span.to - from,
      });
      cursor = span.to;
    }
  });

  const tail = log.end_time - cursor;
  if (tail >= NOISE_MS) {
    const where = gatewayStage(stages.length, stages.length === 0, true);
    stages.push({
      key: `gateway-${cursor}`,
      kind: 'gateway',
      label: where.label,
      detail: where.detail,
      ms: tail,
    });
  }

  return stages.length > 0 ? stages : null;
}
