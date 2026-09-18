import { describe, expect, it, vi } from 'vitest';

const queryLogSummaries = vi.fn();
vi.mock('@web/api/v1/super-agents/observability/logs', () => ({
  queryLogSummaries: (...args: unknown[]) => queryLogSummaries(...args),
}));

vi.mock('@shared/types/data/log', () => ({
  // Pass params through so the tests can see what was queried
  LogsQueryParams: { parse: (params: unknown) => params },
}));

import type { Log } from '@shared/types/data/log';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { SESSION_WINDOW, useLogSession } from '@web/hooks/use-log-session';
import type { ReactNode } from 'react';

const log = (id: string, start_time: number): Log =>
  ({ id, agent_id: 'agent-1', trace_id: 'ses_1', start_time }) as Log;

const renderSession = (current: Log | undefined) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return {
    queryClient,
    ...renderHook((log: Log | undefined) => useLogSession(log), {
      wrapper,
      initialProps: current,
    }),
  };
};

describe('useLogSession', () => {
  it('fetches a window around the log on each side of its trace', async () => {
    const current = log('b', 2000);
    queryLogSummaries.mockImplementation((params: { before?: string }) =>
      Promise.resolve(
        params.before
          ? [current, log('a', 1000)] // newest first
          : [current, log('c', 3000)], // oldest first
      ),
    );

    const { result, queryClient } = renderSession(current);

    await waitFor(() => {
      expect(result.current.logs.map((l) => l.id)).toEqual(['a', 'b', 'c']);
    });
    expect(result.current.hasEarlier).toBe(false);
    expect(result.current.hasLater).toBe(false);

    const scope = {
      agent_id: 'agent-1',
      trace_id: 'ses_1',
      limit: String(SESSION_WINDOW),
    };
    expect(queryLogSummaries).toHaveBeenCalledWith({
      ...scope,
      before: '2000',
    });
    expect(queryLogSummaries).toHaveBeenCalledWith({
      ...scope,
      after: '2000',
      order: 'asc',
    });
    // Summaries, so nothing here is seeded into the detail cache: a summary
    // has no conversation, and the detail view is what reads one.
    expect(queryClient.getQueryData(['logs', 'detail', 'c'])).toBeUndefined();
  });

  it('says when the session goes on past the window', async () => {
    const current = log('x', 100_000);
    queryLogSummaries.mockImplementation((params: { before?: string }) =>
      Promise.resolve(
        params.before
          ? Array.from({ length: SESSION_WINDOW }, (_, i) =>
              log(`e${i}`, 100_000 - i),
            )
          : [current],
      ),
    );

    const { result } = renderSession(current);

    await waitFor(() => {
      expect(result.current.hasEarlier).toBe(true);
    });
    expect(result.current.hasLater).toBe(false);
  });

  it('keeps the rail up while stepping within the session', async () => {
    // The window is centred on the log, so stepping changes the query; the
    // previous window is the same session and must stay until the new one
    // arrives, or the rail unmounts and the page jumps for a moment.
    const a = log('a', 1000);
    const b = log('b', 2000);
    queryLogSummaries.mockImplementation((params: { before?: string }) =>
      Promise.resolve(params.before ? [b, a] : [b, log('c', 3000)]),
    );
    const { result, rerender } = renderSession(b);
    await waitFor(() => {
      expect(result.current.logs).toHaveLength(3);
    });

    queryLogSummaries.mockImplementation(() => new Promise(() => undefined)); // never lands
    rerender(a);
    expect(result.current.logs.map((l) => l.id)).toEqual(['a', 'b', 'c']);

    // A log of another session gets nothing of it
    rerender({ ...log('z', 9000), trace_id: 'ses_other' });
    expect(result.current.logs).toEqual([]);
  });

  it('has no session for a log without a trace', () => {
    queryLogSummaries.mockClear();
    const { result } = renderSession({
      ...log('lone', 1000),
      trace_id: null,
    });

    expect(result.current.logs).toEqual([]);
    expect(result.current.isLoading).toBe(false);
    expect(queryLogSummaries).not.toHaveBeenCalled();
  });
});
