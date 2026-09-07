import type { Log } from '@shared/types/data';
import { act, render, screen } from '@testing-library/react';
import { LogsTableView } from '@web/components/agents/logs-table-view';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The logs table, seen from the angle of requests that have not finished.
 *
 * A row is written when a request arrives rather than when it completes, so
 * the table has to render three states, not one: running, failed, and done.
 * `end_time === null` is the whole distinction.
 */

const logsState = vi.hoisted(() => ({
  value: {
    logs: [] as unknown[],
    isLoading: false,
    page: 1,
    pageSize: 50,
    totalPages: 1,
    setPage: vi.fn(),
    setPageSize: vi.fn(),
  },
}));

vi.mock('@web/providers/logs', () => ({
  useLogs: () => logsState.value,
}));

const aLog = (overrides: Partial<Log> = {}): Log =>
  ({
    id: 'log-1',
    agent_id: 'agent-1',
    skill_id: 'skill-1',
    cluster_id: null,
    method: 'POST',
    endpoint: '/v1/chat/completions',
    function_name: 'chatComplete',
    start_time: Date.now() - 1000,
    first_token_time: null,
    base_sa_config: {},
    status: 200,
    end_time: Date.now(),
    duration: 1000,
    ai_provider: 'openai',
    model: 'gpt-5.6',
    ai_provider_request_log: null,
    hook_logs: [],
    metadata: {},
    embedding: null,
    original_system_prompt: null,
    cache_status: 'MISS',
    error: null,
    trace_id: null,
    parent_span_id: null,
    span_id: null,
    span_name: null,
    app_id: null,
    external_user_id: null,
    external_user_human_name: null,
    user_metadata: null,
    ...overrides,
  }) as unknown as Log;

/** A request that has arrived but not finished. */
const aRunningLog = (overrides: Partial<Log> = {}): Log =>
  aLog({
    id: 'log-running',
    status: null,
    end_time: null,
    duration: null,
    ai_provider: null,
    model: null,
    cache_status: null,
    ...overrides,
  });

const renderTable = () =>
  render(
    <LogsTableView
      description="Logs"
      emptyText="No logs yet"
      onBack={vi.fn()}
      onLogClick={vi.fn()}
      extraColumn={{ header: 'Skill', render: () => 'skill' }}
    />,
  );

describe('LogsTableView', () => {
  beforeEach(() => {
    logsState.value = { ...logsState.value, page: 1, logs: [] };
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('marks a request that has not finished as running', () => {
    logsState.value = { ...logsState.value, logs: [aRunningLog()] };

    renderTable();

    expect(screen.getByTestId('running-log-row')).toBeInTheDocument();
    expect(screen.getByText('running')).toBeInTheDocument();
    expect(screen.getByText(/1 running/)).toBeInTheDocument();
  });

  it('counts the duration up while the request runs', () => {
    // The clock only moves when the test moves it: with time advancing on
    // its own, a slow render reads 1.1s where 1.0s is expected.
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    logsState.value = {
      ...logsState.value,
      logs: [aRunningLog({ start_time: Date.now() - 1000 })],
    };

    renderTable();

    expect(screen.getByText('1.0s')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(screen.getByText('3.0s')).toBeInTheDocument();
  });

  it('shows a finished request with its status and duration', () => {
    logsState.value = { ...logsState.value, logs: [aLog()] };

    renderTable();

    expect(screen.queryByTestId('running-log-row')).not.toBeInTheDocument();
    expect(screen.getByText('200')).toBeInTheDocument();
    expect(screen.getByText('1000ms')).toBeInTheDocument();
  });

  it('does not claim a model lacks temperature while the request is running', () => {
    // A running row has no provider exchange to read a temperature from.
    // Saying "not supported" there asserts something unknown, and it visibly
    // corrected itself to the real value when the request finished.
    logsState.value = { ...logsState.value, logs: [aRunningLog()] };

    renderTable();

    expect(
      screen.queryByText(/Temperature not supported/),
    ).not.toBeInTheDocument();
  });

  it('shows a request that failed before a provider answered', () => {
    logsState.value = {
      ...logsState.value,
      logs: [
        aLog({
          id: 'log-failed',
          status: 404,
          ai_provider: null,
          model: null,
          error: 'Agent with name nope not found',
        }),
      ],
    };

    renderTable();

    expect(screen.getByText('404')).toBeInTheDocument();
  });
});
