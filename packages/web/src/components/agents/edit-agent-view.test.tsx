import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AgentsProvider } from '@web/providers/agents';
import { NavigationProvider } from '@web/providers/navigation';
import { SkillsProvider } from '@web/providers/skills';
import type React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  resetRouterMocks,
  routerMockState,
  setMockParams,
  setMockPathname,
} from '@/vitest.setup';

// TanStack Router is mocked globally in vitest.setup.tsx

import { EditAgentView } from '@web/components/agents/edit-agent-view';
import { useAgents } from '@web/providers/agents';
import { useNavigation } from '@web/providers/navigation';

// Mock the navigation provider with proper state
const mockNavigationState = {
  section: 'agents' as const,
  currentView: 'edit-agent' as const,
  selectedAgentName: 'Test Agent 1',
  breadcrumbs: [],
};

// Mock agent object
const mockAgent = {
  id: 'agent-1',
  name: 'Test Agent 1',
  description: 'First test agent description with enough characters',
  metadata: {},
  auto_create_skills: true,
  skill_match_threshold: 0.8,
  max_auto_created_skills: 10,
  skill_arbiter_model_id: null,
  skill_arbiter_timeout_ms: null,
  reviewer_agent_id: null,
  review_fail_closed: false,
  review_expose_reason: false,
  created_at: '2023-01-01T10:30:00Z',
  updated_at: '2023-01-01T10:30:00Z',
};

// Mock the agents API
vi.mock('@web/api/v1/super-agents/agents', () => {
  const mockUpdateAgent = vi.fn();

  return {
    updateAgent: mockUpdateAgent,
    getAgents: vi.fn().mockResolvedValue([]),
    createAgent: vi.fn(),
    deleteAgent: vi.fn(),
  };
});

// Mock sanitization utilities
vi.mock('@shared/utils/security', () => ({
  sanitizeDescription: (desc: string) => desc,
  sanitizeUserInput: (input: string) => input,
}));

// Mock the navigation provider
vi.mock('@web/providers/navigation', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@web/providers/navigation')>();
  return {
    ...actual,
    useNavigation: vi.fn(),
  };
});

// Mock the agents provider
vi.mock('@web/providers/agents', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@web/providers/agents')>();
  return {
    ...actual,
    useAgents: vi.fn(),
  };
});

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

// The arbiter override lists the text models; none here.
vi.mock('@web/providers/models', () => ({
  useModels: vi.fn(() => ({
    models: [],
    isLoading: false,
    setQueryParams: vi.fn(),
  })),
}));

vi.mock('@web/providers/ai-providers', () => ({
  useAIProviders: vi.fn(() => ({ aiProviderConfigs: [] })),
}));

describe('EditAgentView', () => {
  let queryClient: QueryClient;
  const mockUpdateAgent = vi.fn();

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    vi.clearAllMocks();
    resetRouterMocks();
    setMockParams({ agentName: 'Test%20Agent%201' });
    setMockPathname('/agents/Test%20Agent%201/edit');
    mockUpdateAgent.mockClear();

    // Set default mock implementation for useNavigation
    vi.mocked(useNavigation).mockReturnValue({
      navigationState: mockNavigationState,
      isLoadingFromStorage: false,
      navigate: routerMockState.navigate,
      setSection: vi.fn(),
      navigateToSkillDashboard: vi.fn(),
      navigateToLogs: vi.fn(),
      navigateToLogDetail: vi.fn(),
      replaceToLogDetail: vi.fn(),
      navigateToEvaluations: vi.fn(),
      navigateToEvaluationDetail: vi.fn(),
      navigateToEditEvaluation: vi.fn(),
      navigateToCreateEvaluation: vi.fn(),
      replaceToEvaluations: vi.fn(),
      navigateToDatasets: vi.fn(),
      replaceToDatasets: vi.fn(),
      navigateToDatasetDetail: vi.fn(),
      navigateToCreateDataset: vi.fn(),
      navigateToConfigurations: vi.fn(),
      navigateToModels: vi.fn(),
      navigateToClusters: vi.fn(),
      navigateToClusterArms: vi.fn(),
      navigateToArmDetail: vi.fn(),
      navigateBack: vi.fn(),
      updateBreadcrumbs: vi.fn(),
    });

    // Set default mock implementation for useAgents
    vi.mocked(useAgents).mockReturnValue({
      agents: [],
      selectedAgent: mockAgent,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
      queryParams: {},
      setQueryParams: vi.fn(),
      createAgent: vi.fn(),
      updateAgent: mockUpdateAgent,
      deleteAgent: vi.fn(),
      isCreating: false,
      isUpdating: false,
      isDeleting: false,
      createError: null,
      updateError: null,
      deleteError: null,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      getAgentById: vi.fn(),
      refreshAgents: vi.fn(),
      isCreateAgentDialogOpen: false,
      setIsCreateAgentDialogOpen: vi.fn(),
    });

    // Mock the agents provider context
    vi.mocked(mockUpdateAgent).mockResolvedValue(undefined);
  });

  const renderEditAgentView = () => {
    return render(
      <QueryClientProvider client={queryClient}>
        <NavigationProvider>
          <AgentsProvider>
            <SkillsProvider>
              <EditAgentView />
            </SkillsProvider>
          </AgentsProvider>
        </NavigationProvider>
      </QueryClientProvider>,
    );
  };

  describe('Rendering', () => {
    it('renders the edit agent form with correct title', () => {
      renderEditAgentView();
      expect(screen.getByText('Edit Agent')).toBeInTheDocument();
      expect(
        screen.getByText('Update Test Agent 1 configuration'),
      ).toBeInTheDocument();
    });

    it('displays agent name as read-only', () => {
      renderEditAgentView();
      expect(screen.getByText('Agent Name')).toBeInTheDocument();
      const agentNameInput = screen.getByDisplayValue('Test Agent 1');
      expect(agentNameInput).toBeInTheDocument();
      expect(agentNameInput).toBeDisabled();
      expect(
        screen.getByText('Agent name cannot be changed after creation'),
      ).toBeInTheDocument();
    });

    it('displays description field with current value', () => {
      renderEditAgentView();
      const descriptionField = screen.getByLabelText('Description (required)');
      expect(descriptionField).toBeInTheDocument();
      expect(descriptionField).toHaveValue(
        'First test agent description with enough characters',
      );
    });

    it('displays form action buttons', () => {
      renderEditAgentView();
      expect(
        screen.getByRole('button', { name: /cancel/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /save changes/i }),
      ).toBeInTheDocument();
    });
  });

  describe('Form Validation', () => {
    it('has description field with correct constraints', () => {
      renderEditAgentView();
      const descriptionField = screen.getByLabelText('Description (required)');

      // Check that field can accept text input
      expect(descriptionField).toHaveValue(
        'First test agent description with enough characters',
      );

      fireEvent.change(descriptionField, {
        target: {
          value:
            'This is a new description with enough characters to meet minimum requirement',
        },
      });
      expect(descriptionField).toHaveValue(
        'This is a new description with enough characters to meet minimum requirement',
      );
    });
  });

  describe('Form Interaction', () => {
    it('allows editing description', () => {
      renderEditAgentView();
      const descriptionField = screen.getByLabelText('Description (required)');

      fireEvent.change(descriptionField, {
        target: {
          value:
            'Updated description with enough characters to meet the minimum requirement',
        },
      });

      expect(descriptionField).toHaveValue(
        'Updated description with enough characters to meet the minimum requirement',
      );
    });

    it('navigates back when cancel button is clicked', () => {
      renderEditAgentView();
      const cancelButton = screen.getByRole('button', { name: /cancel/i });

      fireEvent.click(cancelButton);

      // TanStack Router uses typed params
      expect(routerMockState.navigate).toHaveBeenCalledWith({
        to: '/agents/$agentName',
        params: { agentName: 'Test%20Agent%201' },
      });
    });
  });

  describe('Form Submission', () => {
    it('has save changes button', () => {
      renderEditAgentView();

      const saveButton = screen.getByRole('button', {
        name: /save changes/i,
      });
      expect(saveButton).toBeInTheDocument();
      // Button is disabled by default when form is not dirty
      expect(saveButton).toBeDisabled();
    });

    it('has cancel button that works', () => {
      renderEditAgentView();

      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      expect(cancelButton).toBeInTheDocument();

      fireEvent.click(cancelButton);
      // TanStack Router uses typed params
      expect(routerMockState.navigate).toHaveBeenCalledWith({
        to: '/agents/$agentName',
        params: { agentName: 'Test%20Agent%201' },
      });
    });

    it('displays form with current agent data', () => {
      renderEditAgentView();

      const descriptionField = screen.getByLabelText('Description (required)');

      // Check that form is populated with current data
      expect(descriptionField).toHaveValue(
        'First test agent description with enough characters',
      );
    });
  });

  describe('Error States', () => {
    it('shows error state when agent is not found', () => {
      // Mock navigation state without agent
      vi.mocked(useNavigation).mockReturnValue({
        navigationState: {
          ...mockNavigationState,
          selectedAgentName: undefined,
        },
        isLoadingFromStorage: false,
        navigate: routerMockState.navigate,
        setSection: vi.fn(),
        navigateToSkillDashboard: vi.fn(),
        navigateToLogs: vi.fn(),
        navigateToLogDetail: vi.fn(),
        replaceToLogDetail: vi.fn(),
        navigateToEvaluations: vi.fn(),
        navigateToEvaluationDetail: vi.fn(),
        navigateToEditEvaluation: vi.fn(),
        navigateToCreateEvaluation: vi.fn(),
        replaceToEvaluations: vi.fn(),
        navigateToDatasets: vi.fn(),
        replaceToDatasets: vi.fn(),
        navigateToDatasetDetail: vi.fn(),
        navigateToCreateDataset: vi.fn(),
        navigateToConfigurations: vi.fn(),
        navigateToModels: vi.fn(),
        navigateToClusters: vi.fn(),
        navigateToClusterArms: vi.fn(),
        navigateToArmDetail: vi.fn(),
        navigateBack: vi.fn(),
        updateBreadcrumbs: vi.fn(),
      });

      // Mock useAgents to return undefined selectedAgent
      vi.mocked(useAgents).mockReturnValue({
        agents: [],
        selectedAgent: undefined,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
        queryParams: {},
        setQueryParams: vi.fn(),
        createAgent: vi.fn(),
        updateAgent: mockUpdateAgent,
        deleteAgent: vi.fn(),
        isCreating: false,
        isUpdating: false,
        isDeleting: false,
        createError: null,
        updateError: null,
        deleteError: null,
        hasNextPage: false,
        isFetchingNextPage: false,
        fetchNextPage: vi.fn(),
        getAgentById: vi.fn(),
        refreshAgents: vi.fn(),
        isCreateAgentDialogOpen: false,
        setIsCreateAgentDialogOpen: vi.fn(),
      });

      renderEditAgentView();

      expect(screen.getAllByText('Agent not found')).toHaveLength(2);
      expect(
        screen.getByText(
          'Unable to find the specified agent. Please ensure the agent exists and try again.',
        ),
      ).toBeInTheDocument();
    });
  });

  describe('Loading States', () => {
    it('renders form with enabled fields by default', () => {
      renderEditAgentView();

      const descriptionField = screen.getByLabelText('Description (required)');
      const saveButton = screen.getByRole('button', {
        name: /save changes/i,
      });
      const cancelButton = screen.getByRole('button', { name: /cancel/i });

      // Check that fields are enabled by default (not updating)
      expect(descriptionField).not.toBeDisabled();
      // Button is disabled when form is not dirty
      expect(saveButton).toBeDisabled();
      expect(cancelButton).not.toBeDisabled();
    });

    it('disables form when updating', () => {
      vi.mocked(useAgents).mockReturnValue({
        agents: [],
        selectedAgent: mockAgent,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
        queryParams: {},
        setQueryParams: vi.fn(),
        createAgent: vi.fn(),
        updateAgent: mockUpdateAgent,
        deleteAgent: vi.fn(),
        isCreating: false,
        isUpdating: true, // Set to updating
        isDeleting: false,
        createError: null,
        updateError: null,
        deleteError: null,
        hasNextPage: false,
        isFetchingNextPage: false,
        fetchNextPage: vi.fn(),
        getAgentById: vi.fn(),
        refreshAgents: vi.fn(),
        isCreateAgentDialogOpen: false,
        setIsCreateAgentDialogOpen: vi.fn(),
      });

      renderEditAgentView();

      const descriptionField = screen.getByLabelText('Description (required)');
      const saveButton = screen.getByRole('button', {
        name: /saving/i,
      });

      // Check that fields are disabled when updating
      expect(descriptionField).toBeDisabled();
      expect(saveButton).toBeDisabled();
    });
  });

  describe('Accessibility', () => {
    it('has proper form labels', () => {
      renderEditAgentView();

      expect(
        screen.getByLabelText('Description (required)'),
      ).toBeInTheDocument();
    });

    it('has proper form descriptions', () => {
      renderEditAgentView();

      expect(
        screen.getByText(/provide a detailed description of what this agent/i),
      ).toBeInTheDocument();
    });

    it('has proper button roles and accessibility', () => {
      renderEditAgentView();

      const saveButton = screen.getByRole('button', {
        name: /save changes/i,
      });
      const cancelButton = screen.getByRole('button', { name: /cancel/i });

      expect(saveButton).toBeInTheDocument();
      expect(cancelButton).toBeInTheDocument();
    });

    it('has unique ID for agent name input', () => {
      renderEditAgentView();

      const agentNameInput = screen.getByDisplayValue('Test Agent 1');
      const inputId = agentNameInput.getAttribute('id');

      // Verify it has an ID (from useId)
      expect(inputId).toBeTruthy();
      expect(inputId).not.toBe('agent-name'); // Should not be static

      // Verify label has matching htmlFor
      const label = screen.getByText('Agent Name');
      expect(label.getAttribute('for')).toBe(inputId);
    });
  });

  describe('Automatic skills', () => {
    it('shows the agent routing settings with their current values', () => {
      renderEditAgentView();

      expect(screen.getByText('Automatic skills')).toBeInTheDocument();
      expect(
        screen.getByRole('switch', { name: 'Create skills automatically' }),
      ).toBeChecked();
      expect(screen.getByLabelText('Match threshold')).toHaveValue(0.8);
      expect(screen.getByLabelText('Maximum automatic skills')).toHaveValue(10);
    });

    it('saves the routing settings alongside the description', async () => {
      renderEditAgentView();

      fireEvent.click(
        screen.getByRole('switch', { name: 'Create skills automatically' }),
      );
      fireEvent.change(screen.getByLabelText('Maximum automatic skills'), {
        target: { value: '3' },
      });
      fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

      await waitFor(() => {
        expect(mockUpdateAgent).toHaveBeenCalledWith('agent-1', {
          description: 'First test agent description with enough characters',
          auto_create_skills: false,
          skill_match_threshold: 0.8,
          max_auto_created_skills: 3,
          skill_arbiter_model_id: null,
          skill_arbiter_timeout_ms: null,
          reviewer_agent_id: null,
          review_fail_closed: false,
          review_expose_reason: false,
        });
      });
    });

    it('saves an arbiter timeout of its own in milliseconds, and clears it when emptied', async () => {
      renderEditAgentView();

      const timeout = screen.getByLabelText('Arbiter timeout (seconds)');
      expect(timeout).toHaveValue(null);

      fireEvent.change(timeout, { target: { value: '30' } });
      fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

      await waitFor(() => {
        expect(mockUpdateAgent).toHaveBeenCalledWith(
          'agent-1',
          expect.objectContaining({ skill_arbiter_timeout_ms: 30_000 }),
        );
      });

      fireEvent.change(timeout, { target: { value: '' } });
      fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

      await waitFor(() => {
        expect(mockUpdateAgent).toHaveBeenLastCalledWith(
          'agent-1',
          expect.objectContaining({ skill_arbiter_timeout_ms: null }),
        );
      });
    });

    it('refuses a threshold outside 0 to 1', async () => {
      renderEditAgentView();

      const threshold = screen.getByLabelText('Match threshold');
      fireEvent.change(threshold, { target: { value: '1.5' } });
      // Submitted directly: jsdom would otherwise stop at the input's own
      // `max`, which a browser shows as a tooltip rather than as our message.
      fireEvent.submit(threshold.closest('form') as HTMLFormElement);

      expect(
        await screen.findByText('Must be between 0 and 1'),
      ).toBeInTheDocument();
      expect(mockUpdateAgent).not.toHaveBeenCalled();
    });
  });

  describe('Response review', () => {
    const guard = {
      ...mockAgent,
      id: 'agent-2',
      name: 'guard',
      reviewer_agent_id: null,
      review_fail_closed: false,
      review_expose_reason: false,
    };
    const internal = {
      ...mockAgent,
      id: 'agent-sa',
      name: 'super-agents',
      reviewer_agent_id: null,
      review_fail_closed: false,
      review_expose_reason: false,
    };

    it('offers the review setting', () => {
      renderEditAgentView();

      expect(screen.getByText('Response review')).toBeInTheDocument();
      expect(screen.getByText('Reviewer agent')).toBeInTheDocument();
      // Radix shows the chosen item in the trigger as well as in the list.
      expect(screen.getAllByText('No review').length).toBeGreaterThan(0);
    });

    it('shows the current reviewer and keeps it when saving', async () => {
      vi.mocked(useAgents).mockReturnValue({
        ...vi.mocked(useAgents)(),
        agents: [mockAgent, guard, internal],
        selectedAgent: { ...mockAgent, reviewer_agent_id: 'agent-2' },
      });
      renderEditAgentView();

      // The other agent is offered by name; the agent itself and the
      // internal one are not.
      expect(screen.getAllByText('guard').length).toBeGreaterThan(0);
      expect(screen.queryByText('super-agents')).not.toBeInTheDocument();

      fireEvent.change(screen.getByLabelText('Maximum automatic skills'), {
        target: { value: '4' },
      });
      fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

      await waitFor(() => {
        expect(mockUpdateAgent).toHaveBeenCalledWith(
          'agent-1',
          expect.objectContaining({ reviewer_agent_id: 'agent-2' }),
        );
      });
    });

    it('cannot fail closed or explain denials without a reviewer', () => {
      renderEditAgentView();
      expect(
        screen.getByRole('switch', { name: 'Fail closed' }),
      ).toBeDisabled();
      expect(
        screen.getByRole('switch', { name: 'Explain denials' }),
      ).toBeDisabled();
    });

    it('saves the choice to fail closed', async () => {
      vi.mocked(useAgents).mockReturnValue({
        ...vi.mocked(useAgents)(),
        agents: [mockAgent, guard],
        selectedAgent: { ...mockAgent, reviewer_agent_id: 'agent-2' },
      });
      renderEditAgentView();

      const failClosed = screen.getByRole('switch', { name: 'Fail closed' });
      expect(failClosed).toBeEnabled();
      expect(failClosed).not.toBeChecked();

      fireEvent.click(failClosed);
      fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

      await waitFor(() => {
        expect(mockUpdateAgent).toHaveBeenCalledWith(
          'agent-1',
          expect.objectContaining({
            reviewer_agent_id: 'agent-2',
            review_fail_closed: true,
          }),
        );
      });
    });

    it('saves the choice to explain denials', async () => {
      vi.mocked(useAgents).mockReturnValue({
        ...vi.mocked(useAgents)(),
        agents: [mockAgent, guard],
        selectedAgent: { ...mockAgent, reviewer_agent_id: 'agent-2' },
      });
      renderEditAgentView();

      const explain = screen.getByRole('switch', { name: 'Explain denials' });
      expect(explain).toBeEnabled();
      expect(explain).not.toBeChecked();

      fireEvent.click(explain);
      fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

      await waitFor(() => {
        expect(mockUpdateAgent).toHaveBeenCalledWith(
          'agent-1',
          expect.objectContaining({
            reviewer_agent_id: 'agent-2',
            review_expose_reason: true,
          }),
        );
      });
    });
  });
});
