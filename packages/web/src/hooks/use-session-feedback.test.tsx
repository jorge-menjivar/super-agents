import { describe, expect, it, vi } from 'vitest';

const getFeedback = vi.fn();
vi.mock('@web/api/v1/super-agents/feedbacks', () => ({
  getFeedback: (...args: unknown[]) => getFeedback(...args),
}));

import { FEEDBACK_LOG_IDS_LIMIT } from '@shared/types/data/feedback';
import type { LogSummary } from '@shared/types/data/log';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { useSessionFeedback } from '@web/hooks/use-session-feedback';
import type { ReactNode } from 'react';

const logs = (count: number): LogSummary[] =>
  Array.from({ length: count }, (_, i) => ({ id: `log-${i}` }) as LogSummary);

const renderFeedback = (session: LogSummary[]) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(() => useSessionFeedback(session), { wrapper });
};

describe('useSessionFeedback', () => {
  it('asks once for a session that fits in one request', async () => {
    getFeedback.mockResolvedValue([
      { log_id: 'log-2', created_at: '2026-09-01T00:00:00Z', score: 1 },
    ]);

    const { result } = renderFeedback(logs(20));

    await waitFor(() => expect(result.current.size).toBe(1));
    expect(getFeedback).toHaveBeenCalledTimes(1);
    expect(getFeedback).toHaveBeenCalledWith({
      log_ids: logs(20).map((log) => log.id),
    });
  });

  /**
   * The ids travel as a URL, twice: once from the browser and again as
   * PostgREST's `log_id=in.(...)`. A uuid and its encoded comma is 39
   * characters, so a session long enough is a request line a proxy refuses --
   * and the schema rejects it before that, which is the point of the cap.
   */
  it('splits a session too long for one request line', async () => {
    const session = logs(FEEDBACK_LOG_IDS_LIMIT + 1);
    getFeedback.mockImplementation(({ log_ids }: { log_ids: string[] }) =>
      Promise.resolve(
        log_ids.map((id) => ({
          log_id: id,
          created_at: '2026-09-01T00:00:00Z',
          score: 1,
        })),
      ),
    );

    const { result } = renderFeedback(session);

    await waitFor(() =>
      expect(result.current.size).toBe(FEEDBACK_LOG_IDS_LIMIT + 1),
    );
    expect(getFeedback).toHaveBeenCalledTimes(2);

    // No batch is over the cap, and between them they name every log once.
    const asked: string[][] = getFeedback.mock.calls.map(
      (call) => (call[0] as { log_ids: string[] }).log_ids,
    );
    for (const batch of asked) {
      expect(batch.length).toBeLessThanOrEqual(FEEDBACK_LOG_IDS_LIMIT);
    }
    expect(asked.flat()).toEqual(session.map((log) => log.id));
  });

  it('asks for nothing when the session is empty', async () => {
    renderFeedback([]);
    await waitFor(() => expect(getFeedback).not.toHaveBeenCalled());
  });

  it('keeps the newest verdict when a log has more than one', async () => {
    getFeedback.mockResolvedValue([
      { log_id: 'log-1', created_at: '2026-09-01T00:00:00Z', score: 0 },
      { log_id: 'log-1', created_at: '2026-09-02T00:00:00Z', score: 1 },
    ]);

    const { result } = renderFeedback(logs(3));

    await waitFor(() => expect(result.current.size).toBe(1));
    expect(result.current.get('log-1')?.score).toBe(1);
  });
});
