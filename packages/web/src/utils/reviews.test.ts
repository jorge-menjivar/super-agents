import type { HookLog, Log } from '@shared/types/data/log';
import { CacheMode, CacheStatus } from '@shared/types/middleware/cache';
import {
  type Hook,
  HookProvider,
  HookType,
} from '@shared/types/middleware/hooks';
import { reviewOf, reviewsAmong } from '@web/utils/reviews';
import { describe, expect, it } from 'vitest';

const hookLog = (hook: Partial<Hook> = {}, extra: Partial<HookLog> = {}) =>
  ({
    trace_id: 'ses_1',
    hook: {
      id: 'reviewer:guard',
      type: HookType.OUTPUT_HOOK,
      hook_provider: HookProvider.AGENT,
      config: { agent_name: 'guard' },
      await: true,
      cache_mode: CacheMode.DISABLED,
      fail_closed: false,
      expose_reason: false,
      ...hook,
    },
    result: {
      deny_request: true,
      request_body_override: undefined,
      response_body_override: undefined,
      skipped: false,
    },
    start_time: 1_000,
    end_time: 8_000,
    duration: 7_000,
    cache_status: CacheStatus.MISS,
    ...extra,
  }) as HookLog;

const review = (id: string, start_time: number, agent_name = 'guard') =>
  ({
    id,
    start_time,
    span_name: 'review',
    base_sa_config: { agent_name },
  }) as unknown as Log;

describe('reviewOf', () => {
  it('finds the review the reviewer answered while the hook ran', () => {
    const reviews = [review('earlier', 500), review('mine', 1_200)];

    expect(reviewOf(hookLog(), reviews)?.id).toBe('mine');
  });

  it('tells the reviews of two reviewer agents apart', () => {
    const reviews = [review('theirs', 1_100, 'other'), review('mine', 1_200)];

    expect(reviewOf(hookLog(), reviews)?.id).toBe('mine');
    expect(
      reviewOf(hookLog({ config: { agent_name: 'other' } }), reviews)?.id,
    ).toBe('theirs');
  });

  it('links nothing rather than guess between two that fit', () => {
    const reviews = [review('one', 1_100), review('two', 1_200)];

    expect(reviewOf(hookLog(), reviews)).toBeUndefined();
  });

  it('links nothing for a hook that is not a reviewer agent', () => {
    const http = hookLog({
      hook_provider: HookProvider.HTTP,
      config: { method: 'POST', url: 'https://guard' } as Hook['config'],
    });

    expect(reviewOf(http, [review('mine', 1_200)])).toBeUndefined();
  });
});

describe('reviewsAmong', () => {
  it('keeps the reviews of a trace and drops the rest', () => {
    const logs = [
      review('r', 1_200),
      { id: 'q', span_name: null } as unknown as Log,
    ];

    expect(reviewsAmong(logs).map((log) => log.id)).toEqual(['r']);
  });
});
