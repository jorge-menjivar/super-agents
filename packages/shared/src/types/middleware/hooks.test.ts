import {
  Hook,
  HookAgentProviderConfig,
  HookDenialResponseBody,
  HookProvider,
  HookType,
} from '@shared/types/middleware/hooks';
import { describe, expect, it } from 'vitest';

const minimal = {
  id: 'reviewer:guard',
  type: HookType.OUTPUT_HOOK,
  hook_provider: HookProvider.AGENT,
  config: { agent_name: 'guard' },
};

describe('Hook', () => {
  it('waits, skips the cache, fails open and keeps its reason unless told otherwise', () => {
    expect(Hook.parse(minimal)).toEqual({
      ...minimal,
      await: true,
      cache_mode: 'disabled',
      fail_closed: false,
      expose_reason: false,
    });
  });

  it('reads an agent config as one, with the skill and timeout it names', () => {
    const config = { agent_name: 'guard', skill_name: 'pii', timeout_ms: 5000 };

    expect(Hook.parse({ ...minimal, config }).config).toEqual(config);
  });

  it('refuses a config that names no provider it knows', () => {
    expect(Hook.safeParse({ ...minimal, config: {} }).success).toBe(false);
  });
});

describe('HookAgentProviderConfig', () => {
  it('takes the timeout as a positive whole number of milliseconds', () => {
    expect(HookAgentProviderConfig.safeParse({ agent_name: 'g' }).success).toBe(
      true,
    );
    for (const timeout_ms of [0, -1, 1.5]) {
      expect(
        HookAgentProviderConfig.safeParse({ agent_name: 'g', timeout_ms })
          .success,
      ).toBe(false);
    }
  });
});

describe('HookDenialResponseBody', () => {
  it('is an error of one type, with the reason optional', () => {
    const error = { message: 'Withheld.', type: 'hook_denied', hook_id: 'h' };

    expect(HookDenialResponseBody.safeParse({ error }).success).toBe(true);
    expect(
      HookDenialResponseBody.safeParse({ error: { ...error, reason: 'No.' } })
        .success,
    ).toBe(true);
    expect(
      HookDenialResponseBody.safeParse({ error: { ...error, type: 'other' } })
        .success,
    ).toBe(false);
  });
});
