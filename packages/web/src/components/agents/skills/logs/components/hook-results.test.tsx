import type { HookLog } from '@shared/types/data/log';
import { CacheMode, CacheStatus } from '@shared/types/middleware/cache';
import {
  type Hook,
  HookProvider,
  type HookResult,
  HookType,
} from '@shared/types/middleware/hooks';
import { render, screen } from '@testing-library/react';
import {
  describeHookLog,
  describeHookProvider,
  HookResults,
} from '@web/components/agents/skills/logs/components/hook-results';
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

describe('HookResults', () => {
  it('shows a denial with its reason, who denied it, and how long it took', () => {
    render(
      <HookResults
        hookLogs={[
          hookLog(
            { deny_request: true, reason: 'About to run gh pr checkout.' },
            { expose_reason: true },
          ),
        ]}
      />,
    );

    const panel = screen.getByRole('region', { name: 'Hooks' });
    expect(panel).toHaveTextContent('Denied');
    expect(panel).toHaveTextContent('reviewer:system-safety');
    expect(panel).toHaveTextContent('on the response');
    expect(panel).toHaveTextContent('agent system-safety');
    expect(panel).toHaveTextContent('7.1s');
    expect(panel).toHaveTextContent('About to run gh pr checkout.');
    expect(panel).toHaveTextContent('The client was told this reason.');
  });

  it('says when the reason was kept from the client', () => {
    render(
      <HookResults
        hookLogs={[hookLog({ deny_request: true, reason: 'Leaks a secret.' })]}
      />,
    );

    expect(screen.getByRole('region', { name: 'Hooks' })).toHaveTextContent(
      'The client was told which hook withheld it, not why.',
    );
  });

  it('shows an allowed response as allowed, so every hook that ran is seen', () => {
    render(
      <HookResults
        hookLogs={[
          hookLog({ reason: 'Nothing to object to.' }),
          hookLog({ skipped: true }, { id: 'gate', type: HookType.INPUT_HOOK }),
        ]}
      />,
    );

    const panel = screen.getByRole('region', { name: 'Hooks' });
    expect(panel).toHaveTextContent('Allowed');
    expect(panel).toHaveTextContent('Nothing to object to.');
    expect(panel).toHaveTextContent('Skipped');
    expect(panel).toHaveTextContent('gate');
    expect(panel).toHaveTextContent('on the request');
  });

  it('shows the error of a hook that could not run, and what that did', () => {
    render(
      <HookResults
        hookLogs={[
          hookLog(
            { error: 'The reviewer "guard" did not answer with a verdict' },
            { fail_closed: false },
          ),
        ]}
      />,
    );

    const panel = screen.getByRole('region', { name: 'Hooks' });
    expect(panel).toHaveTextContent('Could not run');
    expect(panel).toHaveTextContent(
      'The reviewer "guard" did not answer with a verdict',
    );
    expect(panel).toHaveTextContent('went through unreviewed');
  });

  it('marks a verdict served from the cache', () => {
    render(
      <HookResults
        hookLogs={[hookLog({}, {}, { cache_status: CacheStatus.HIT })]}
      />,
    );

    expect(screen.getByText('cached verdict')).toBeInTheDocument();
  });
});
