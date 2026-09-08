import type { Log } from '@shared/types/data/log';
import { fireEvent, render, screen } from '@testing-library/react';
import { SessionMap } from '@web/components/agents/skills/logs/components/session-map';
import { describe, expect, it, vi } from 'vitest';

const log = (id: string, start_time: number, extra: Partial<Log> = {}): Log =>
  ({
    id,
    start_time,
    duration: 1_000,
    status: 200,
    model: 'gpt-5.6-sol',
    avg_eval_score: null,
    span_name: null,
    ...extra,
  }) as Log;

// A coding-agent turn: a title call beside the real one, then a failure
const logs = [
  log('a', 1_000_000, { avg_eval_score: 0.87 }),
  log('b', 1_000_300, { duration: 12_000 }),
  log('c', 1_240_300, { status: 500, duration: 100 }),
];

const renderMap = (props: Partial<Parameters<typeof SessionMap>[0]> = {}) =>
  render(
    <SessionMap
      logs={logs}
      currentId="b"
      hasEarlier={false}
      hasLater={false}
      traceId="ses_1"
      labelOf={() => null}
      onSelect={vi.fn()}
      {...props}
    />,
  );

describe('SessionMap', () => {
  it('lists the requests with the current one marked', () => {
    renderMap();

    expect(screen.getAllByTitle(/^HTTP /)).toHaveLength(3);
    // Each bar is read off at its tip, so a length is never taken for a score
    expect(screen.getByRole('button', { current: true })).toHaveTextContent(
      '12.0s',
    );
    // First request to the end of the last: 240.4s
    expect(screen.getByText('3 requests · 4m')).toBeInTheDocument();
  });

  it('shows a failure by its status and a good request by its score', () => {
    renderMap();

    expect(screen.getByText('500')).toHaveClass('text-red-500');
    expect(screen.getByText('87%')).toHaveClass('text-green-500');
    expect(screen.queryByText('200')).not.toBeInTheDocument();
  });

  it('colours a weak score apart from a failure', () => {
    renderMap({
      logs: [log('weak', 1_000_000, { avg_eval_score: 0.4 })],
      currentId: 'weak',
    });

    expect(screen.getByText('40%')).toHaveClass('text-amber-500');
  });

  it('opens a request', () => {
    const onSelect = vi.fn();
    renderMap({ onSelect });

    const [first] = screen.getAllByTitle(/^HTTP /);
    fireEvent.click(first);
    expect(onSelect).toHaveBeenCalledWith(logs[0]);
    expect(first).toHaveAttribute(
      'title',
      'HTTP 200 · 1.0s · gpt-5.6-sol · scored 87%',
    );
  });

  it('steps through the session with its own arrows, earlier being up', () => {
    const onSelect = vi.fn();
    renderMap({ onSelect });

    expect(screen.getByText('2 of 3')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Earlier request in this session'));
    expect(onSelect).toHaveBeenLastCalledWith(logs[0]);

    fireEvent.click(screen.getByLabelText('Later request in this session'));
    expect(onSelect).toHaveBeenLastCalledWith(logs[2]);
  });

  it('stops at the ends of the session', () => {
    renderMap({ currentId: 'c' });

    expect(screen.getByText('3 of 3')).toBeInTheDocument();
    expect(
      screen.getByLabelText('Later request in this session'),
    ).toBeDisabled();
    expect(
      screen.getByLabelText('Earlier request in this session'),
    ).toBeEnabled();
  });

  it('says when the session goes on past the window', () => {
    renderMap({ hasEarlier: true, hasLater: true });

    expect(screen.getByText('Earlier requests not shown')).toBeInTheDocument();
    expect(screen.getByText('Later requests not shown')).toBeInTheDocument();
    expect(screen.getByText('3+ requests')).toBeInTheDocument();
    // With the window cut, a position would be a guess
    expect(screen.queryByText(/of 3/)).not.toBeInTheDocument();
  });
});
