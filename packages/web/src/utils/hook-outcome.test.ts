import type { HookLog } from '@shared/types/data/log';
import { CacheMode, CacheStatus } from '@shared/types/middleware/cache';
import {
  type Hook,
  HookProvider,
  type HookResult,
  HookType,
} from '@shared/types/middleware/hooks';
import {
  denyingHook,
  describeHookLog,
  describeHookProvider,
  summariseHooks,
  wentUnreviewed,
} from '@web/utils/hook-outcome';
import { describe, expect, it } from 'vitest';

const hookLog = (
  result: Partial<HookResult> = {},
  hook: Partial<Hook> = {},
  extra: Partial<HookLog> = {},
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
  start_time: 1_000,
  end_time: 8_142,
  duration: 7_142,
  cache_status: CacheStatus.MISS,
  ...extra,
});

describe('describeHookLog', () => {
  it('reads an allowed response as allowed', () => {
    expect(describeHookLog(hookLog({ reason: 'Fine.' }))).toEqual({
      verdict: 'allowed',
      label: 'Allowed',
      failure: null,
    });
  });

  it('reads a denial as denied', () => {
    expect(describeHookLog(hookLog({ deny_request: true }))).toEqual({
      verdict: 'denied',
      label: 'Denied',
      failure: null,
    });
  });

  it('tells a replacement and a rewrite from a denial', () => {
    expect(
      describeHookLog(
        hookLog({
          response_body_override: {
            choices: [],
          } as unknown as HookResult['response_body_override'],
        }),
      ).verdict,
    ).toBe('replaced');
    expect(
      describeHookLog(
        hookLog(
          {
            request_body_override: {
              messages: [],
            } as unknown as HookResult['request_body_override'],
          },
          { type: HookType.INPUT_HOOK },
        ),
      ).verdict,
    ).toBe('rewrote');
  });

  it('reads a hook that could not run by what its failure did', () => {
    const open = describeHookLog(hookLog({ error: 'Reviewer unreachable' }));
    expect(open.verdict).toBe('failed');
    expect(open.failure).toContain('went through unreviewed');

    const closed = describeHookLog(
      hookLog({ error: 'Reviewer unreachable', deny_request: true }),
    );
    expect(closed.verdict).toBe('denied');
    expect(closed.failure).toContain('the response was withheld');
  });

  it('reads a skipped hook as skipped, whatever else it says', () => {
    expect(
      describeHookLog(hookLog({ skipped: true, deny_request: true })).verdict,
    ).toBe('skipped');
  });
});

describe('describeHookProvider', () => {
  it('names the reviewer agent, and its skill when one was named', () => {
    expect(describeHookProvider(hookLog().hook)).toBe('agent system-safety');
    expect(
      describeHookProvider(
        hookLog({}, { config: { agent_name: 'guard', skill_name: 'policy' } })
          .hook,
      ),
    ).toBe('agent guard / policy');
  });

  it('names an endpoint and a model by what they are', () => {
    expect(
      describeHookProvider(
        hookLog(
          {},
          {
            hook_provider: HookProvider.HTTP,
            config: {
              method: 'POST',
              url: 'https://guard.example/check',
            } as unknown as Hook['config'],
          },
        ).hook,
      ),
    ).toBe('POST https://guard.example/check');
    expect(
      describeHookProvider(
        hookLog(
          {},
          {
            hook_provider: HookProvider.LLM,
            config: {
              model: 'gpt-5.6-sol',
              provider: 'openai',
            } as unknown as Hook['config'],
          },
        ).hook,
      ),
    ).toBe('openai/gpt-5.6-sol');
  });
});

describe('summariseHooks', () => {
  it('names the hook that denied, whatever else allowed', () => {
    expect(
      summariseHooks([
        hookLog({ reason: 'Fine.' }, { id: 'gate' }),
        hookLog({ deny_request: true }),
      ]),
    ).toEqual({
      text: '2 ran · Denied by reviewer:system-safety',
      verdict: 'denied',
    });
  });

  it('says a hook could not run, when none denied', () => {
    expect(
      summariseHooks([
        hookLog({ reason: 'Fine.' }, { id: 'gate' }),
        hookLog({ error: 'Reviewer unreachable' }),
      ]),
    ).toEqual({
      text: '2 ran · reviewer:system-safety could not run',
      verdict: 'failed',
    });
  });

  it('reads a clean pass as allowed, without naming anyone', () => {
    expect(summariseHooks([hookLog({ reason: 'Fine.' })])).toEqual({
      text: '1 ran · Allowed',
      verdict: 'allowed',
    });
  });

  it('counts only the hooks that ran', () => {
    expect(
      summariseHooks([hookLog({ skipped: true }), hookLog({ reason: 'Ok.' })])
        .text,
    ).toBe('1 ran · Allowed');
  });

  it('says so when every hook was skipped', () => {
    expect(summariseHooks([hookLog({ skipped: true })])).toEqual({
      text: '1 hook, skipped',
      verdict: 'skipped',
    });
    expect(
      summariseHooks([hookLog({ skipped: true }), hookLog({ skipped: true })])
        .text,
    ).toBe('2 hooks, all skipped');
  });
});

describe('denyingHook', () => {
  it('finds the hook that withheld the request', () => {
    const denied = hookLog({ deny_request: true });
    expect(denyingHook([hookLog({ reason: 'Fine.' }), denied])).toBe(denied);
  });

  it('finds nothing when every hook let it through', () => {
    expect(denyingHook([hookLog({ reason: 'Fine.' })])).toBeUndefined();
  });
});

describe('wentUnreviewed', () => {
  it('is true when a hook failed open, so the check never happened', () => {
    expect(wentUnreviewed([hookLog({ error: 'Reviewer unreachable' })])).toBe(
      true,
    );
  });

  it('is false when the failure withheld the response instead', () => {
    expect(
      wentUnreviewed([
        hookLog({ error: 'Reviewer unreachable', deny_request: true }),
      ]),
    ).toBe(false);
  });

  it('is false for hooks that ran', () => {
    expect(wentUnreviewed([hookLog({ reason: 'Fine.' })])).toBe(false);
  });
});
