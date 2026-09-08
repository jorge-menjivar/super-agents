import type { HookLog, Log } from '@shared/types/data/log';
import { CacheMode, CacheStatus } from '@shared/types/middleware/cache';
import {
  HookProvider,
  type HookResult,
  HookType,
} from '@shared/types/middleware/hooks';
import { outcomeOf } from '@web/utils/log-outcome';
import { describe, expect, it } from 'vitest';

const hookLog = (result: Partial<HookResult> = {}): HookLog => ({
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
  },
  result: {
    deny_request: false,
    request_body_override: undefined,
    response_body_override: undefined,
    skipped: false,
    ...result,
  },
  start_time: 1_000,
  end_time: 2_000,
  duration: 1_000,
  cache_status: CacheStatus.MISS,
});

const log = (extra: Partial<Log> = {}): Log =>
  ({
    id: 'log-1',
    start_time: 1_000,
    end_time: 2_000,
    duration: 1_000,
    status: 200,
    hook_logs: [],
    avg_eval_score: null,
    ...extra,
  }) as Log;

describe('outcomeOf', () => {
  it('is running until the row is closed', () => {
    expect(outcomeOf(log({ end_time: null, status: null }))).toEqual({
      tone: 'running',
      label: 'Running',
    });
  });

  it('calls a reviewer denial withheld by review, and names the hook', () => {
    const outcome = outcomeOf(
      log({ status: 446, hook_logs: [hookLog({ deny_request: true })] }),
    );
    expect(outcome.tone).toBe('failed');
    expect(outcome.label).toBe('Withheld by review');
    expect(outcome.title).toContain('reviewer:system-safety');
    expect(outcome.title).toContain('withheld the response');
  });

  it('calls any other denial withheld by a hook', () => {
    // Nothing recorded the denial, so there is no reviewer to name.
    expect(outcomeOf(log({ status: 446 })).label).toBe('Withheld by a hook');
  });

  it('calls any other error a failure, and says which', () => {
    const outcome = outcomeOf(log({ status: 404 }));
    expect(outcome.tone).toBe('failed');
    expect(outcome.label).toBe('Failed');
    expect(outcome.title).toContain('404');
  });

  it('marks an answer that went out without the check that was meant to run', () => {
    const outcome = outcomeOf(
      log({ hook_logs: [hookLog({ error: 'Reviewer unreachable' })] }),
    );
    expect(outcome.tone).toBe('unreviewed');
    expect(outcome.label).toBe('Answered unreviewed');
  });

  it('is served for an answer whose hooks all ran', () => {
    expect(
      outcomeOf(log({ hook_logs: [hookLog({ reason: 'Fine.' })] })),
    ).toEqual({ tone: 'served', label: 'Answered' });
  });

  it('says nothing about how good the answer was', () => {
    // A weak answer is not a request that went wrong. The score says that,
    // and it is a number: colouring by both is what made them look alike.
    expect(outcomeOf(log({ avg_eval_score: 0.04 })).tone).toBe('served');
  });
});
