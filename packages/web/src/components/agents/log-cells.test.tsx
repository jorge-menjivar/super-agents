import type { Log } from '@shared/types/data';
import { render, screen } from '@testing-library/react';
import {
  LogDuration,
  LogEvalScore,
  LogFunction,
  LogModel,
  LogStatusBadge,
  LogTagBadge,
} from '@web/components/agents/log-cells';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The cells every log surface is read through.
 *
 * They exist so that the logs page and the dashboard cards cannot disagree
 * about how a request reads -- the cards previously showed a skill as bare
 * text where the table showed a badge, and could not show a failure at all.
 */

const aLog = (overrides: Partial<Log> = {}): Log =>
  ({
    id: 'log-1',
    function_name: 'chat_complete',
    model: 'glm-5.3',
    status: 200,
    start_time: Date.now() - 1500,
    end_time: Date.now(),
    duration: 1500,
    avg_eval_score: null,
    ...overrides,
  }) as unknown as Log;

const running = (overrides: Partial<Log> = {}): Log =>
  aLog({ status: null, end_time: null, duration: null, ...overrides });

describe('log cells', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads a finished request by its status', () => {
    render(<LogStatusBadge log={aLog()} />);
    expect(screen.getByText('200')).toBeInTheDocument();
  });

  it('reads a failed request by its status too', () => {
    render(<LogStatusBadge log={aLog({ status: 502 })} />);
    expect(screen.getByText('502')).toBeInTheDocument();
  });

  it('says a request is running rather than showing a status it has not got', () => {
    render(<LogStatusBadge log={running()} />);
    expect(screen.getByText('running')).toBeInTheDocument();
  });

  it('shows how long a finished request took', () => {
    render(<LogDuration log={aLog({ duration: 1500 })} />);
    expect(screen.getByText('1500ms')).toBeInTheDocument();
  });

  it('counts up from the start time while a request runs', () => {
    // Frozen, so the elapsed time is exactly what the fixture set however
    // slow the render.
    vi.useFakeTimers({ toFake: ['Date'] });
    render(<LogDuration log={running({ start_time: Date.now() - 3000 })} />);
    expect(screen.getByText('3.0s')).toBeInTheDocument();
  });

  it('shows a score once there is one, and a dash before', () => {
    const { unmount } = render(<LogEvalScore log={aLog()} />);
    expect(screen.getByText('—')).toBeInTheDocument();
    unmount();

    render(<LogEvalScore log={aLog({ avg_eval_score: 0.42 })} />);
    expect(screen.getByText('42%')).toBeInTheDocument();
  });

  it('names the function the way a person reads it', () => {
    render(<LogFunction log={aLog()} />);
    // The pretty name, not the wire spelling.
    expect(screen.queryByText('chat_complete')).not.toBeInTheDocument();
  });

  it('falls back to a dash for a model not yet known', () => {
    render(<LogModel log={running({ model: null })} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('draws a skill or partition as a badge, the way the logs page does', () => {
    render(<LogTagBadge value="generate-thread-titles" />);
    const badge = screen.getByText('generate-thread-titles');
    // A badge, not bare text: this is what the cards were missing.
    expect(badge.className).toContain('border');
  });

  it('says what is missing when there is no name', () => {
    const { unmount } = render(<LogTagBadge value={null} />);
    expect(screen.getByText('—')).toBeInTheDocument();
    unmount();

    render(<LogTagBadge value={undefined} missing="Not found" />);
    expect(screen.getByText('Not found')).toBeInTheDocument();
  });
});
