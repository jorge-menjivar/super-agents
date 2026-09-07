import type { Agent } from '@shared/types/data';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import {
  AgentsProvider,
  agentQueryKeys,
  useAgents,
} from '@web/providers/agents';
import type React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock dependencies
vi.mock('@web/api/v1/super-agents/agents', () => ({
  createAgent: vi.fn(),
  getAgents: vi.fn(),
  updateAgent: vi.fn(),
  deleteAgent: vi.fn(),
}));

vi.mock('@web/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// Mock the navigation provider
vi.mock('@web/providers/navigation', () => ({
  useNavigation: vi.fn(() => ({
    navigationState: {
      section: 'agents',
      selectedAgentName: null,
      selectedSkillName: null,
    },
  })),
  NavigationProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// Mock the system settings provider
vi.mock('@web/providers/system-settings', () => ({
  useSystemSettings: vi.fn(() => ({
    systemSettings: {
      embedding_model_id: null,
      judge_model_id: null,
      system_prompt_reflection_model_id: null,
      evaluation_generation_model_id: null,
    },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    updateSystemSettings: vi.fn(),
    isUpdating: false,
    updateError: null,
  })),
  SystemSettingsProvider: ({ children }: { children: React.ReactNode }) =>
    children,
}));

// Import mocked functions
import {
  createAgent,
  deleteAgent,
  getAgents,
  updateAgent,
} from '@web/api/v1/super-agents/agents';

const mockAgents: Agent[] = [
  {
    id: '1',
    name: 'Test Agent 1',
    description: 'Test Description 1',
    metadata: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    auto_create_skills: true,
    skill_match_threshold: 0.8,
    max_auto_created_skills: 10,
    skill_arbiter_model_id: null,
    skill_arbiter_timeout_ms: null,
    reviewer_agent_id: null,
    review_fail_closed: false,
    review_expose_reason: false,
  },
  {
    id: '2',
    name: 'Test Agent 2',
    description: 'Test Description 2',
    metadata: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    auto_create_skills: true,
    skill_match_threshold: 0.8,
    max_auto_created_skills: 10,
    skill_arbiter_model_id: null,
    skill_arbiter_timeout_ms: null,
    reviewer_agent_id: null,
    review_fail_closed: false,
    review_expose_reason: false,
  },
];

function TestComponent(): React.ReactElement {
  const {
    agents,
    isLoading,
    error,
    queryParams,
    setQueryParams,
    createAgent: createAgentFn,
    updateAgent: updateAgentFn,
    deleteAgent: deleteAgentFn,
    isCreating,
    isUpdating,
    isDeleting,
    createError,
    updateError,
    deleteError,
    getAgentById,
    refreshAgents,
  } = useAgents();

  return (
    <div>
      <div data-testid="loading">{isLoading ? 'loading' : 'loaded'}</div>
      <div data-testid="error">{error?.message ?? 'no error'}</div>
      <div data-testid="agents-count">{agents?.length ?? 0}</div>
      <div data-testid="query-params">{JSON.stringify(queryParams)}</div>

      <div data-testid="create-loading">
        {isCreating ? 'creating' : 'not creating'}
      </div>
      <div data-testid="update-loading">
        {isUpdating ? 'updating' : 'not updating'}
      </div>
      <div data-testid="delete-loading">
        {isDeleting ? 'deleting' : 'not deleting'}
      </div>
      <div data-testid="create-error">
        {createError?.message ?? 'no create error'}
      </div>
      <div data-testid="update-error">
        {updateError?.message ?? 'no update error'}
      </div>
      <div data-testid="delete-error">
        {deleteError?.message ?? 'no delete error'}
      </div>

      <button
        type="button"
        data-testid="set-query-params"
        onClick={() => setQueryParams({ name: 'test' })}
      >
        Set Query Params
      </button>

      <button
        type="button"
        data-testid="create-agent"
        onClick={async () => {
          try {
            await createAgentFn({
              name: 'New Agent',
              description: 'New Description',
              metadata: {},
              auto_create_skills: true,
              skill_match_threshold: 0.8,
              max_auto_created_skills: 10,
              skill_arbiter_model_id: null,
              skill_arbiter_timeout_ms: null,
              reviewer_agent_id: null,
              review_fail_closed: false,
              review_expose_reason: false,
            });
          } catch (error) {
            console.error('Create failed:', error);
          }
        }}
      >
        Create Agent
      </button>

      <button
        type="button"
        data-testid="update-agent"
        onClick={async () => {
          try {
            await updateAgentFn('1', { description: 'Updated Description' });
          } catch (error) {
            console.error('Update failed:', error);
          }
        }}
      >
        Update Agent
      </button>

      <button
        type="button"
        data-testid="delete-agent"
        onClick={async () => {
          try {
            await deleteAgentFn('1');
          } catch (error) {
            console.error('Delete failed:', error);
          }
        }}
      >
        Delete Agent
      </button>

      <button
        type="button"
        data-testid="get-agent-by-id"
        onClick={() => {
          const agent = getAgentById('1');
          console.log('Found agent:', agent);
        }}
      >
        Get Agent By ID
      </button>

      <button
        type="button"
        data-testid="refresh-agents"
        onClick={refreshAgents}
      >
        Refresh Agents
      </button>
    </div>
  );
}

describe('AgentsProvider', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
        mutations: {
          retry: false,
        },
      },
    });

    // Reset mocks
    vi.mocked(createAgent).mockResolvedValue({
      id: '3',
      name: 'New Agent',
      description: 'New Description',
      metadata: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      auto_create_skills: true,
      skill_match_threshold: 0.8,
      max_auto_created_skills: 10,
      skill_arbiter_model_id: null,
      skill_arbiter_timeout_ms: null,
      reviewer_agent_id: null,
      review_fail_closed: false,
      review_expose_reason: false,
    });
    vi.mocked(getAgents).mockResolvedValue(mockAgents);
    vi.mocked(updateAgent).mockResolvedValue({
      ...mockAgents[0],
      description: 'Updated Description',
    });
    vi.mocked(deleteAgent).mockResolvedValue();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('provides agents data and loading states', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <AgentsProvider>
          <TestComponent />
        </AgentsProvider>
      </QueryClientProvider>,
    );

    // Initially loading
    expect(screen.getByTestId('loading').textContent).toBe('loading');
    expect(screen.getByTestId('agents-count').textContent).toBe('0');

    // Wait for data to load
    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('loaded');
    });

    expect(screen.getByTestId('agents-count').textContent).toBe('2');
    expect(screen.getByTestId('error').textContent).toBe('no error');
    expect(getAgents).toHaveBeenCalledWith({ limit: 20, offset: 0 });
  });

  it('handles agent creation successfully', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <AgentsProvider>
          <TestComponent />
        </AgentsProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('loaded');
    });

    expect(screen.getByTestId('create-loading').textContent).toBe(
      'not creating',
    );

    await act(() => {
      fireEvent.click(screen.getByTestId('create-agent'));
    });

    await waitFor(() => {
      expect(createAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'New Agent',
          description: 'New Description',
          metadata: {},
        }),
      );
    });
  });

  it('handles query parameter updates', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <AgentsProvider>
          <TestComponent />
        </AgentsProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('loaded');
    });

    expect(screen.getByTestId('query-params').textContent).toBe('{}');

    // Mock a second call for when params change
    vi.mocked(getAgents).mockResolvedValueOnce(
      mockAgents.filter((a) => a.name.includes('test')),
    );

    await act(() => {
      fireEvent.click(screen.getByTestId('set-query-params'));
    });

    expect(screen.getByTestId('query-params').textContent).toBe(
      JSON.stringify({ name: 'test' }),
    );

    // Should trigger refetch with new params
    await waitFor(() => {
      expect(getAgents).toHaveBeenCalledWith({
        name: 'test',
        limit: 20,
        offset: 0,
      });
    });
  });

  it('handles agent updates successfully', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <AgentsProvider>
          <TestComponent />
        </AgentsProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('loaded');
    });

    expect(screen.getByTestId('update-loading').textContent).toBe(
      'not updating',
    );

    await act(() => {
      fireEvent.click(screen.getByTestId('update-agent'));
    });

    await waitFor(() => {
      expect(updateAgent).toHaveBeenCalledWith('1', {
        description: 'Updated Description',
      });
    });
  });

  it('handles agent deletion successfully', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <AgentsProvider>
          <TestComponent />
        </AgentsProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('loaded');
    });

    expect(screen.getByTestId('delete-loading').textContent).toBe(
      'not deleting',
    );

    await act(() => {
      fireEvent.click(screen.getByTestId('delete-agent'));
    });

    await waitFor(() => {
      expect(deleteAgent).toHaveBeenCalledWith('1');
    });
  });

  it('provides getAgentById helper function', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <AgentsProvider>
          <TestComponent />
        </AgentsProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('loaded');
    });

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {
      // Mock implementation
    });

    await act(() => {
      fireEvent.click(screen.getByTestId('get-agent-by-id'));
    });

    expect(consoleSpy).toHaveBeenCalledWith('Found agent:', mockAgents[0]);
    consoleSpy.mockRestore();
  });

  it('handles API errors gracefully', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {
      // Suppress console errors in tests
    });

    vi.mocked(getAgents).mockRejectedValue(new Error('API Error'));

    render(
      <QueryClientProvider client={queryClient}>
        <AgentsProvider>
          <TestComponent />
        </AgentsProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('error').textContent).toBe('API Error');
    });

    consoleError.mockRestore();
  });

  it('throws error when useAgents is used outside provider', () => {
    function BadComponent(): React.ReactElement | null {
      useAgents();
      return null;
    }

    expect(() => render(<BadComponent />)).toThrow(
      'useAgents must be used within an AgentsProvider',
    );
  });

  it('separates error states correctly', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {
      // Suppress console errors in tests
    });

    vi.mocked(createAgent).mockRejectedValue(new Error('Create Error'));
    vi.mocked(updateAgent).mockRejectedValue(new Error('Update Error'));
    vi.mocked(deleteAgent).mockRejectedValue(new Error('Delete Error'));

    render(
      <QueryClientProvider client={queryClient}>
        <AgentsProvider>
          <TestComponent />
        </AgentsProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('loaded');
    });

    // Test create error
    await act(() => {
      fireEvent.click(screen.getByTestId('create-agent'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('create-error').textContent).toBe(
        'Create Error',
      );
    });

    consoleError.mockRestore();
  });

  it('handles delete errors', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {
      // Suppress console errors in tests
    });

    // Mock delete to fail
    vi.mocked(deleteAgent).mockRejectedValue(new Error('Delete failed'));

    render(
      <QueryClientProvider client={queryClient}>
        <AgentsProvider>
          <TestComponent />
        </AgentsProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('loaded');
    });

    // Should show 2 agents initially
    expect(screen.getByTestId('agents-count').textContent).toBe('2');

    // Attempt delete (should fail)
    await act(() => {
      fireEvent.click(screen.getByTestId('delete-agent'));
    });

    // Should show delete error
    await waitFor(() => {
      expect(screen.getByTestId('delete-error').textContent).toBe(
        'Delete failed',
      );
    });

    consoleError.mockRestore();
  });

  it('automatically refetches when query parameters change', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <AgentsProvider>
          <TestComponent />
        </AgentsProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('loaded');
    });

    // Initial call with empty params
    expect(getAgents).toHaveBeenCalledWith({ limit: 20, offset: 0 });

    // Clear previous calls
    vi.clearAllMocks();

    // Mock filtered results
    vi.mocked(getAgents).mockResolvedValueOnce(
      mockAgents.filter((a) => a.name.includes('test')),
    );

    // Change query params
    await act(() => {
      fireEvent.click(screen.getByTestId('set-query-params'));
    });

    // Should automatically trigger new query due to queryKey change
    await waitFor(() => {
      expect(getAgents).toHaveBeenCalledWith({
        name: 'test',
        limit: 20,
        offset: 0,
      });
    });
  });

  it('invalidates cache on successful mutations', async () => {
    const invalidateQueriesSpy = vi.spyOn(queryClient, 'invalidateQueries');

    render(
      <QueryClientProvider client={queryClient}>
        <AgentsProvider>
          <TestComponent />
        </AgentsProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('loaded');
    });

    // Test create invalidation
    await act(() => {
      fireEvent.click(screen.getByTestId('create-agent'));
    });

    await waitFor(() => {
      expect(invalidateQueriesSpy).toHaveBeenCalledWith({
        queryKey: agentQueryKeys.lists(),
      });
    });

    // Clear and test delete invalidation
    invalidateQueriesSpy.mockClear();

    await act(() => {
      fireEvent.click(screen.getByTestId('delete-agent'));
    });

    await waitFor(() => {
      expect(invalidateQueriesSpy).toHaveBeenCalledWith({
        queryKey: agentQueryKeys.lists(),
      });
    });

    invalidateQueriesSpy.mockRestore();
  });

  it('handles update errors separately from delete errors', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {
      // Suppress console errors in tests
    });

    // Mock only update to fail
    vi.mocked(updateAgent).mockRejectedValue(new Error('Update failed'));
    // Keep delete working
    vi.mocked(deleteAgent).mockResolvedValue();

    render(
      <QueryClientProvider client={queryClient}>
        <AgentsProvider>
          <TestComponent />
        </AgentsProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('loaded');
    });

    // Test update error
    await act(() => {
      fireEvent.click(screen.getByTestId('update-agent'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('update-error').textContent).toBe(
        'Update failed',
      );
      expect(screen.getByTestId('delete-error').textContent).toBe(
        'no delete error',
      );
    });

    // Test that delete still works (no error)
    await act(() => {
      fireEvent.click(screen.getByTestId('delete-agent'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('delete-error').textContent).toBe(
        'no delete error',
      );
    });

    consoleError.mockRestore();
  });

  it('validates query keys structure', () => {
    expect(agentQueryKeys.all).toEqual(['agents']);
    expect(agentQueryKeys.lists()).toEqual(['agents', 'list']);
    expect(agentQueryKeys.list({ name: 'test' })).toEqual([
      'agents',
      'list',
      { name: 'test' },
    ]);
    expect(agentQueryKeys.details()).toEqual(['agents', 'detail']);
    expect(agentQueryKeys.detail('123')).toEqual(['agents', 'detail', '123']);
  });
});
