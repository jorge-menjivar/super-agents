import type { HookLog, Log } from '@shared/types/data/log';
import { CacheMode, CacheStatus } from '@shared/types/middleware/cache';
import {
  type Hook,
  HookProvider,
  type HookResult,
  HookType,
} from '@shared/types/middleware/hooks';
import { traceOf } from '@web/utils/log-trace';
import { describe, expect, it } from 'vitest';

const ARRIVED = 1_788_828_124_790;

const hookLog = (
  from: number,
  to: number,
  result: Partial<HookResult> = {},
  hook: Partial<Hook> = {},
): HookLog => ({
  trace_id: 'ses_1',
  hook: {
    id: 'reviewer:system-safety',
    type: HookType.OUTPUT_HOOK,
    hook_provider: HookProvider.AGENT,
    config: { agent_name: 'system-safety' },
    await: true,
    cache_mode: CacheMode.DISABLED,
    fail_closed: false,
    expose_reason: false,
    ...hook,
  },
  result: {
    deny_request: false,
    request_body_override: undefined,
    response_body_override: undefined,
    skipped: false,
    ...result,
  },
  start_time: from,
  end_time: to,
  duration: to - from,
  cache_status: CacheStatus.MISS,
});

const log = (extra: Partial<Log> = {}): Log =>
  ({
    id: 'log-1',
    start_time: ARRIVED,
    end_time: ARRIVED + 124_000,
    duration: 124_000,
    first_token_time: null,
    status: 200,
    hook_logs: [],
    ai_provider_request_log: null,
    ...extra,
  }) as Log;

/** A routing decision, as the log row carries it. */
const ROUTED = {
  method: 'embedding',
  similarity: 0.9,
  threshold: 0.8,
  candidates: 3,
};

/** The provider's own span, as the gateway records it. */
const provider = (from: number, to: number) =>
  ({ start_time: from, end_time: to }) as Log['ai_provider_request_log'];

describe('traceOf', () => {
  it('splits a withheld request into the gateway, the provider and the review', () => {
    // The real shape of log 5aca7ef5: two minutes, of which the model had
    // eight seconds and the reviewer seven.
    const stages = traceOf(
      log({
        ai_provider_request_log: provider(ARRIVED + 108_950, ARRIVED + 116_817),
        hook_logs: [
          hookLog(ARRIVED + 116_821, ARRIVED + 123_963, { deny_request: true }),
        ],
        end_time: ARRIVED + 123_963,
        duration: 123_963,
        status: 446,
      }),
    );

    expect(stages?.map((stage) => [stage.label, stage.ms])).toEqual([
      ['setup', 108_950],
      ['provider', 7_867],
      ['review', 7_142],
    ]);
  });

  it('names an input hook as a check, before the provider', () => {
    const stages = traceOf(
      log({
        hook_logs: [
          hookLog(
            ARRIVED + 200,
            ARRIVED + 1_400,
            {},
            { type: HookType.INPUT_HOOK },
          ),
        ],
        ai_provider_request_log: provider(ARRIVED + 1_500, ARRIVED + 9_000),
        end_time: ARRIVED + 9_100,
        duration: 9_100,
      }),
    );

    // The gateway's own work is named by where it falls: what ran before
    // anything else is setup, what runs between two stages is the gateway,
    // and what is left at the end is the response.
    expect(stages?.map((stage) => stage.label)).toEqual([
      'setup',
      'check',
      'gateway',
      'provider',
      'response',
    ]);
    expect(stages?.map((stage) => stage.kind)).toEqual([
      'gateway',
      'hook',
      'gateway',
      'provider',
      'gateway',
    ]);
  });

  it('leaves out a gap too short to be a stage of the request', () => {
    // 4ms between the provider answering and the review starting is the cost
    // of moving between them, not a stage worth naming beside two minutes.
    const stages = traceOf(
      log({
        ai_provider_request_log: provider(ARRIVED + 108_950, ARRIVED + 116_817),
        hook_logs: [hookLog(ARRIVED + 116_821, ARRIVED + 123_963)],
        end_time: ARRIVED + 123_963,
        duration: 123_963,
      }),
    );

    expect(stages).toHaveLength(3);
    expect(stages?.some((stage) => stage.ms === 4)).toBe(false);
  });

  it('keeps a tail long enough to matter', () => {
    const stages = traceOf(
      log({
        ai_provider_request_log: provider(ARRIVED + 1_000, ARRIVED + 5_000),
        end_time: ARRIVED + 9_000,
        duration: 9_000,
      }),
    );

    expect(stages?.map((stage) => [stage.label, stage.ms])).toEqual([
      ['setup', 1_000],
      ['provider', 4_000],
      ['response', 4_000],
    ]);
  });

  it('skips a hook that never ran', () => {
    const stages = traceOf(
      log({
        ai_provider_request_log: provider(ARRIVED + 1_000, ARRIVED + 5_000),
        hook_logs: [
          hookLog(ARRIVED + 1_000, ARRIVED + 1_000, { skipped: true }),
        ],
        end_time: ARRIVED + 5_000,
        duration: 5_000,
      }),
    );

    expect(stages?.map((stage) => stage.label)).toEqual(['setup', 'provider']);
  });

  it('splits the head of the first gap into the routing it measured', () => {
    // Routing is the one piece of the gateway's own work the row times, and
    // it happens first, so the gap before the provider is cut at it rather
    // than drawn as one bar that hides a model call inside it.
    const stages = traceOf(
      log({
        metadata: { skill_routing: { ...ROUTED, duration_ms: 3_000 } },
        ai_provider_request_log: provider(ARRIVED + 4_000, ARRIVED + 9_000),
        end_time: ARRIVED + 9_000,
        duration: 9_000,
      }),
    );

    expect(stages?.map((stage) => [stage.label, stage.ms])).toEqual([
      ['routing', 3_000],
      ['setup', 1_000],
      ['provider', 5_000],
    ]);
  });

  it('gives routing the whole gap when it fills it', () => {
    // The measurement and the gap come off different clocks, so routing can
    // read as longer than the gap it sits in; it takes the gap, not more.
    const stages = traceOf(
      log({
        metadata: { skill_routing: { ...ROUTED, duration_ms: 9_000 } },
        ai_provider_request_log: provider(ARRIVED + 1_000, ARRIVED + 5_000),
        end_time: ARRIVED + 5_000,
        duration: 5_000,
      }),
    );

    expect(stages?.map((stage) => [stage.label, stage.ms])).toEqual([
      ['routing', 1_000],
      ['provider', 4_000],
    ]);
  });

  it('reads overlapping stages as one after another', () => {
    // A hook whose clock says it began before the provider had finished
    // keeps only the part that is its own, so the ribbon still sums.
    const stages = traceOf(
      log({
        ai_provider_request_log: provider(ARRIVED, ARRIVED + 6_000),
        hook_logs: [hookLog(ARRIVED + 4_000, ARRIVED + 10_000)],
        end_time: ARRIVED + 10_000,
        duration: 10_000,
      }),
    );

    expect(stages?.map((stage) => [stage.label, stage.ms])).toEqual([
      ['provider', 6_000],
      ['review', 4_000],
    ]);
    expect(stages?.reduce((sum, stage) => sum + stage.ms, 0)).toBe(10_000);
  });

  it('says nothing about a request that is still running', () => {
    expect(traceOf(log({ end_time: null, duration: null }))).toBeNull();
  });

  it('says nothing when neither a provider nor a hook was reached', () => {
    // An unknown agent, or a cache hit: one undivided span, which a ribbon
    // would draw as a single bar carrying no information.
    expect(traceOf(log({ status: 404 }))).toBeNull();
  });

  it('notes when the first token arrived, on the provider stage', () => {
    const stages = traceOf(
      log({
        ai_provider_request_log: provider(ARRIVED + 1_000, ARRIVED + 9_000),
        first_token_time: ARRIVED + 3_400,
        end_time: ARRIVED + 9_000,
        duration: 9_000,
      }),
    );

    expect(
      stages?.find((stage) => stage.kind === 'provider')?.detail,
    ).toContain('first token arrived after 2400ms');
  });
});
