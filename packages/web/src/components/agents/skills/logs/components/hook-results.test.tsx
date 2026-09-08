import type { HookLog, Log } from '@shared/types/data/log';
import { CacheMode, CacheStatus } from '@shared/types/middleware/cache';
import {
  type Hook,
  HookProvider,
  type HookResult,
  HookType,
} from '@shared/types/middleware/hooks';
import { fireEvent, render, screen } from '@testing-library/react';
import { HookResults } from '@web/components/agents/skills/logs/components/hook-results';
import { describe, expect, it, vi } from 'vitest';

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

    const panel = screen.getByTestId('hooks');
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

    expect(screen.getByTestId('hooks')).toHaveTextContent(
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

    const panel = screen.getByTestId('hooks');
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

    const panel = screen.getByTestId('hooks');
    expect(panel).toHaveTextContent('Could not run');
    expect(panel).toHaveTextContent(
      'The reviewer "guard" did not answer with a verdict',
    );
    expect(panel).toHaveTextContent('went through unreviewed');
  });

  it('links a reviewer hook to the review its verdict came from', () => {
    const review = { id: 'review-1' } as Log;
    const onOpenReview = vi.fn();
    render(
      <HookResults
        hookLogs={[hookLog({ deny_request: true })]}
        reviewOf={() => review}
        onOpenReview={onOpenReview}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Open the review/ }));

    expect(onOpenReview).toHaveBeenCalledWith(review, 'system-safety');
  });

  it('offers no link when the review is not known', () => {
    render(
      <HookResults
        hookLogs={[hookLog({ deny_request: true })]}
        reviewOf={() => undefined}
        onOpenReview={vi.fn()}
      />,
    );

    expect(
      screen.queryByRole('button', { name: /Open the review/ }),
    ).not.toBeInTheDocument();
  });

  it('says when a withheld answer was not kept, and where it can still be read', () => {
    const denied = hookLog({ deny_request: true });
    const { rerender } = render(
      <HookResults
        hookLogs={[denied]}
        reviewOf={() => ({ id: 'r' }) as Log}
        onOpenReview={vi.fn()}
      />,
    );
    expect(screen.getByTestId('hooks')).toHaveTextContent(
      'What the model wrote was not kept on this log, which predates that; the review shows what the reviewer was sent.',
    );

    // Kept on the log: nothing to apologise for.
    rerender(
      <HookResults
        hookLogs={[
          hookLog(
            { deny_request: true },
            {},
            { response_body: { choices: [] } },
          ),
        ]}
      />,
    );
    expect(screen.getByTestId('hooks')).not.toHaveTextContent('was not kept');
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
