import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock dependencies - must be before other imports
vi.mock('@web/api/v1/super-agents/observability/logs', () => ({
  // The list and the neighbours read summaries; only the detail reads a
  // whole row, by id.
  queryLogSummaries: vi.fn().mockResolvedValue([{ id: '1' }]),
  queryLogs: vi.fn().mockResolvedValue([
    {
      id: '1',
      ai_provider_request_log: {
        response_body: {
          choices: [
            {
              message: { role: 'user', content: 'foo' },
              index: 0,
              finish_reason: 'stop',
            },
          ],
        },
      },
    },
  ]),
}));

vi.mock('@web/api/v1/super-agents/agents', () => ({
  getAgents: vi.fn().mockResolvedValue([]),
  createAgent: vi.fn(),
  updateAgent: vi.fn(),
  deleteAgent: vi.fn(),
}));

vi.mock('@web/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('@shared/types/data/log', () => ({
  // Pass params through so the tests can see what scope was queried
  LogsQueryParams: { parse: (params: unknown) => params },
}));

// Mock TanStack Router navigation hooks
vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({
    navigate: vi.fn(),
    history: {
      back: vi.fn(),
      forward: vi.fn(),
    },
  }),
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/agents' }),
  useParams: () => ({}),
  // biome-ignore lint/suspicious/noExplicitAny: test mock
  Link: ({ children, to }: { children: any; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

// Mock the providers that LogsProvider depends on
vi.mock('@web/providers/agents', () => ({
  useAgents: () => ({
    selectedAgent: { id: 'test-agent', name: 'Test Agent' },
  }),
}));

const mockNavigationState: Record<string, unknown> = {
  selectedAgent: { id: 'test-agent', name: 'Test Agent' },
  selectedSkill: { id: 'test-skill', name: 'Test Skill' },
};

vi.mock('@web/providers/navigation', () => ({
  useNavigation: () => ({
    navigationState: mockNavigationState,
  }),
}));

import type { Log } from '@shared/types/data/log';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import {
  queryLogSummaries,
  queryLogs,
} from '@web/api/v1/super-agents/observability/logs';
// Now import everything
import { LogsProvider, useLogs } from '@web/providers/logs';
import React from 'react';

// Create a mock for localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string): string | null => store[key] || null),
    setItem: vi.fn((key: string, value: string): void => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string): void => {
      delete store[key];
    }),
    clear: vi.fn((): void => {
      store = {};
    }),
  };
})();

function TestComponent(): React.ReactElement {
  const {
    logs,
    selectedLog,
    newerLog,
    olderLog,
    isLoading,
    setAgentId,
    setSkillId,
  } = useLogs();

  // Set agentId and skillId on mount to trigger log fetching
  React.useEffect(() => {
    setAgentId('test-agent');
    setSkillId('test-skill');
  }, [setAgentId, setSkillId]);

  return (
    <div>
      <div data-testid="logs-length">{logs.length}</div>
      <div data-testid="selected-log">{selectedLog?.id ?? ''}</div>
      <div data-testid="newer-log">{newerLog?.id ?? ''}</div>
      <div data-testid="older-log">{olderLog?.id ?? ''}</div>
      <div data-testid="is-loading">{String(isLoading)}</div>
    </div>
  );
}

// The agent-level logs page: the whole agent, no skill in the scope
function AgentWideComponent(): React.ReactElement {
  const {
    page,
    newerLog,
    olderLog,
    setAgentId,
    setAgentWide,
    setPage,
    setSkillId,
  } = useLogs();

  React.useEffect(() => {
    setAgentId('test-agent');
    setAgentWide(true);
  }, [setAgentId, setAgentWide]);

  return (
    <div>
      <div data-testid="page">{page}</div>
      <div data-testid="newer-log">{newerLog?.id ?? ''}</div>
      <div data-testid="older-log">{olderLog?.id ?? ''}</div>
      <button type="button" onClick={() => setPage(2)}>
        page 2
      </button>
      <button type="button" onClick={() => setSkillId('test-skill')}>
        name skill
      </button>
    </div>
  );
}

const asLogs = (logs: Partial<Log>[]): Log[] => logs as Log[];

const neighborsOfLog2 = (params: unknown): Promise<Log[]> => {
  const { after, before } = params as { after?: string; before?: string };
  if (after) {
    return Promise.resolve(asLogs([{ id: 'log-3', start_time: 3000 }]));
  }
  if (before) {
    return Promise.resolve(asLogs([{ id: 'log-1', start_time: 1000 }]));
  }
  return Promise.resolve(asLogs([{ id: 'log-2', start_time: 2000 }]));
};

describe('LogsProvider', (): void => {
  let queryClient: QueryClient;

  // Set up the localStorage mock before each test
  beforeEach((): void => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
    Object.defineProperty(window, 'localStorage', {
      value: localStorageMock,
      writable: true,
    });
  });

  // Clear mock calls after each test
  afterEach((): void => {
    vi.clearAllMocks();
    delete mockNavigationState.logId;
  });

  it('provides logs from queryLogSummaries', async (): Promise<void> => {
    await act(async (): Promise<void> => {
      await Promise.resolve();
      render(
        <QueryClientProvider client={queryClient}>
          <LogsProvider>
            <TestComponent />
          </LogsProvider>
        </QueryClientProvider>,
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId('logs-length').textContent).toBe('1');
    });
  });

  it('fetches agent-wide logs without a skill filter', async (): Promise<void> => {
    // The agent-level logs page has no skill: it turns on agentWide and the
    // query must go out with only the agent id, not wait for a skill id.
    function AgentWideComponent(): React.ReactElement {
      const { logs, setAgentId, setAgentWide } = useLogs();

      React.useEffect(() => {
        setAgentId('test-agent');
        setAgentWide(true);
      }, [setAgentId, setAgentWide]);

      return <div data-testid="logs-length">{logs.length}</div>;
    }

    await act(async (): Promise<void> => {
      await Promise.resolve();
      render(
        <QueryClientProvider client={queryClient}>
          <LogsProvider>
            <AgentWideComponent />
          </LogsProvider>
        </QueryClientProvider>,
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId('logs-length').textContent).toBe('1');
    });

    const listCall = vi
      .mocked(queryLogSummaries)
      .mock.calls.find(([params]) => !('id' in (params as object)));
    expect(listCall?.[0]).toMatchObject({ agent_id: 'test-agent' });
    expect(listCall?.[0]).not.toHaveProperty('skill_id');
  });

  it('fetches a log by id when it is not in the current page', async (): Promise<void> => {
    // A deep link, or a row clicked on a later page of the agent-wide view,
    // names a log the one-page list does not hold.
    mockNavigationState.logId = 'log-9';
    vi.mocked(queryLogs).mockResolvedValue(asLogs([{ id: 'log-9' }]));

    await act(async (): Promise<void> => {
      await Promise.resolve();
      render(
        <QueryClientProvider client={queryClient}>
          <LogsProvider>
            <TestComponent />
          </LogsProvider>
        </QueryClientProvider>,
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId('selected-log').textContent).toBe('log-9');
    });
  });

  it('is loading, not missing, while a log is fetched by id', async (): Promise<void> => {
    // Between the page arriving without the log and the fetch by id
    // resolving, the detail view must show its skeleton, not "not found".
    mockNavigationState.logId = 'log-9';
    let resolveDetail!: (logs: Log[]) => void;
    const detail = new Promise<Log[]>((resolve) => {
      resolveDetail = resolve;
    });
    vi.mocked(queryLogs).mockImplementation(() => detail);

    await act(async (): Promise<void> => {
      await Promise.resolve();
      render(
        <QueryClientProvider client={queryClient}>
          <LogsProvider>
            <TestComponent />
          </LogsProvider>
        </QueryClientProvider>,
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId('logs-length').textContent).toBe('1');
    });
    expect(screen.getByTestId('selected-log').textContent).toBe('');
    expect(screen.getByTestId('is-loading').textContent).toBe('true');

    await act(async (): Promise<void> => {
      resolveDetail(asLogs([{ id: 'log-9' }]));
      await detail;
    });

    await waitFor(() => {
      expect(screen.getByTestId('selected-log').textContent).toBe('log-9');
    });
    expect(screen.getByTestId('is-loading').textContent).toBe('false');
  });

  it("looks up the selected log's neighbors by time", async (): Promise<void> => {
    // Stepping to the previous or next log has to work across pages and
    // from a deep link, so the neighbors are found by start_time rather
    // than in the page: the nearest log strictly after it, oldest first,
    // and the nearest strictly before it, newest first.
    mockNavigationState.logId = 'log-2';
    vi.mocked(queryLogSummaries).mockImplementation(neighborsOfLog2);
    vi.mocked(queryLogs).mockResolvedValue(
      asLogs([{ id: 'log-2', start_time: 2000 }]),
    );

    await act(async (): Promise<void> => {
      await Promise.resolve();
      render(
        <QueryClientProvider client={queryClient}>
          <LogsProvider>
            <TestComponent />
          </LogsProvider>
        </QueryClientProvider>,
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId('newer-log').textContent).toBe('log-3');
      expect(screen.getByTestId('older-log').textContent).toBe('log-1');
    });

    const sent = vi
      .mocked(queryLogSummaries)
      .mock.calls.map(([params]) => params);
    expect(sent).toContainEqual({
      agent_id: 'test-agent',
      skill_id: 'test-skill',
      after: '2001',
      order: 'asc',
      limit: '1',
    });
    expect(sent).toContainEqual({
      agent_id: 'test-agent',
      skill_id: 'test-skill',
      before: '1999',
      limit: '1',
    });

    // Summaries, so neither is seeded into the detail cache: stepping to one
    // fetches that row whole, which is what the detail view draws.
    expect(
      queryClient.getQueryData(['logs', 'detail', 'log-3']),
    ).toBeUndefined();
    expect(
      queryClient.getQueryData(['logs', 'detail', 'log-1']),
    ).toBeUndefined();
  });

  it('looks up neighbors across the agent when the view is agent-wide', async (): Promise<void> => {
    // A log opened from the agent's logs page steps through the agent's
    // logs, whatever skill they belong to.
    mockNavigationState.logId = 'log-2';
    vi.mocked(queryLogSummaries).mockImplementation(neighborsOfLog2);
    vi.mocked(queryLogs).mockResolvedValue(
      asLogs([{ id: 'log-2', start_time: 2000 }]),
    );

    await act(async (): Promise<void> => {
      await Promise.resolve();
      render(
        <QueryClientProvider client={queryClient}>
          <LogsProvider>
            <AgentWideComponent />
          </LogsProvider>
        </QueryClientProvider>,
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId('newer-log').textContent).toBe('log-3');
      expect(screen.getByTestId('older-log').textContent).toBe('log-1');
    });

    const sent = vi
      .mocked(queryLogSummaries)
      .mock.calls.map(([params]) => params);
    expect(sent).toContainEqual({
      agent_id: 'test-agent',
      after: '2001',
      order: 'asc',
      limit: '1',
    });
    expect(sent).toContainEqual({
      agent_id: 'test-agent',
      before: '1999',
      limit: '1',
    });
  });

  it('keeps the agent-wide page when a skill is named under it', async (): Promise<void> => {
    // The detail view names the skill of the log it shows even when the log
    // was opened agent-wide. That is not a scope change: going back to the
    // agent's logs must land on the page the log was opened from.
    await act(async (): Promise<void> => {
      await Promise.resolve();
      render(
        <QueryClientProvider client={queryClient}>
          <LogsProvider>
            <AgentWideComponent />
          </LogsProvider>
        </QueryClientProvider>,
      );
    });

    await act(async (): Promise<void> => {
      await Promise.resolve();
      screen.getByText('page 2').click();
    });
    expect(screen.getByTestId('page').textContent).toBe('2');

    await act(async (): Promise<void> => {
      await Promise.resolve();
      screen.getByText('name skill').click();
    });
    expect(screen.getByTestId('page').textContent).toBe('2');
  });

  it('throws if useLogs is used outside provider', (): void => {
    function BadComponent(): React.ReactElement | null {
      useLogs();
      return null;
    }
    expect(() => render(<BadComponent />)).toThrow();
  });
});
