import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  resetRouterMocks,
  routerMockState,
  setMockParams,
  setMockPathname,
} from '@/vitest.setup';

// TanStack Router is mocked globally in vitest.setup.tsx

import { EditSkillView } from '@web/components/agents/skills/edit-skill-view';
import { useAgents } from '@web/providers/agents';
import { useNavigation } from '@web/providers/navigation';
import { useSkills } from '@web/providers/skills';

// Mock agent and skill objects
const mockAgent = {
  id: 'agent-1',
  name: 'Test Agent 1',
  description: 'First test agent description',
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

const mockSkill = {
  id: 'skill-1',
  agent_id: 'agent-1',
  name: 'Test Skill 1',
  description: 'Test skill description',
  metadata: {},
  optimize: true,
  configuration_count: 15,
  auto_created: false,
  seed_system_prompt: null,
  created_at: '2023-01-01T10:30:00Z',
  updated_at: '2023-01-01T10:30:00Z',
  clustering_interval: 15,
  reflection_min_requests_per_arm: 3,
  exploration_temperature: 1.0,
  last_clustering_at: null,
  last_clustering_log_start_time: null,
  evaluations_regenerated_at: null,
  evaluation_lock_acquired_at: null,
  total_requests: 0,
  allowed_template_variables: ['datetime'],
};

// Mock the navigation provider with proper state
const mockNavigationState = {
  section: 'agents' as const,
  currentView: 'edit-skill' as const,
  selectedAgentName: 'Test Agent 1',
  selectedSkillName: 'Test Skill 1',
  breadcrumbs: [],
};

// Mock the skills API
vi.mock('@web/api/v1/super-agents/skills', () => {
  const mockUpdateSkill = vi.fn();

  return {
    updateSkill: mockUpdateSkill,
    getSkills: vi.fn().mockResolvedValue([]),
    createSkill: vi.fn(),
    deleteSkill: vi.fn(),
  };
});

// Mock sanitization utilities
vi.mock('@shared/utils/security', () => ({
  sanitizeDescription: (desc: string) => desc,
  sanitizeUserInput: (input: string) => input,
}));

// Mock the agents provider
vi.mock('@web/providers/agents', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@web/providers/agents')>();
  return {
    ...actual,
    useAgents: vi.fn(),
  };
});

// Mock the navigation provider
vi.mock('@web/providers/navigation', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@web/providers/navigation')>();
  return {
    ...actual,
    useNavigation: vi.fn(),
  };
});

// Mock the skills provider
vi.mock('@web/providers/skills', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@web/providers/skills')>();
  return {
    ...actual,
    useSkills: vi.fn(),
  };
});

describe('EditSkillView', () => {
  let queryClient: QueryClient;
  const mockUpdateSkill = vi.fn();

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    vi.clearAllMocks();
    resetRouterMocks();
    setMockParams({ agentName: 'Test Agent 1', skillName: 'Test Skill 1' });
    setMockPathname('/agents/Test%20Agent%201/Test%20Skill%201/edit');
    mockUpdateSkill.mockClear();

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
      agents: [mockAgent],
      selectedAgent: mockAgent,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
      queryParams: {},
      setQueryParams: vi.fn(),
      createAgent: vi.fn(),
      updateAgent: vi.fn(),
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

    // Set default mock implementation for useSkills
    vi.mocked(useSkills).mockReturnValue({
      // Query state
      skills: [mockSkill],
      selectedSkill: mockSkill,
      isLoading: false,
      error: null,
      refetch: vi.fn(),

      // Query parameters
      queryParams: {},
      setQueryParams: vi.fn(),

      // Skill mutation functions
      createSkill: vi.fn(),
      updateSkill: mockUpdateSkill,
      deleteSkill: vi.fn(),

      // Skill mutation states
      isCreating: false,
      isUpdating: false,
      isDeleting: false,
      createError: null,
      updateError: null,
      deleteError: null,

      // Pagination
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),

      // Helper functions
      getSkillById: vi.fn(),
      refreshSkills: vi.fn(),
    });

    // Mock the skills provider context
    vi.mocked(mockUpdateSkill).mockResolvedValue(undefined);
  });

  const renderEditSkillView = () => {
    return render(
      <QueryClientProvider client={queryClient}>
        <EditSkillView />
      </QueryClientProvider>,
    );
  };

  describe('Rendering', () => {
    it('renders the edit skill form with correct title', () => {
      renderEditSkillView();
      expect(screen.getByText('Edit Skill')).toBeInTheDocument();
      expect(
        screen.getByText('Update settings for Test Skill 1'),
      ).toBeInTheDocument();
    });

    it('displays skill name field as disabled', () => {
      renderEditSkillView();
      const skillNameField = screen.getByLabelText('Skill Name');
      expect(skillNameField).toBeInTheDocument();
      expect(skillNameField).toHaveValue('Test Skill 1');
      expect(skillNameField).toBeDisabled();
      expect(
        screen.getByText(
          /The skill name cannot be changed after creation to maintain consistency/,
        ),
      ).toBeInTheDocument();
    });

    it('displays description field with current value', () => {
      renderEditSkillView();
      const descriptionField = screen.getByLabelText('Description (required)');
      expect(descriptionField).toBeInTheDocument();
      expect(descriptionField).toHaveValue('Test skill description');
    });

    it('displays max configurations field with current value', () => {
      renderEditSkillView();
      const maxConfigField = screen.getByLabelText('Number of Partitions');
      expect(maxConfigField).toBeInTheDocument();
      expect(maxConfigField).toHaveValue(15);
    });

    it('displays form action buttons', () => {
      renderEditSkillView();
      expect(
        screen.getByRole('button', { name: /cancel/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /update skill/i }),
      ).toBeInTheDocument();
    });

    it('displays tips section', () => {
      renderEditSkillView();
      expect(
        screen.getByText('Tips for Configuring Skills'),
      ).toBeInTheDocument();
      expect(screen.getByText(/skill name is permanent/i)).toBeInTheDocument();
      expect(
        screen.getByText(/set max configurations based on/i),
      ).toBeInTheDocument();
    });
  });

  describe('Form Validation', () => {
    it('has max configurations field with correct constraints', () => {
      renderEditSkillView();
      const maxConfigField = screen.getByLabelText('Number of Partitions');

      // Check field attributes for validation
      expect(maxConfigField).toHaveAttribute('type', 'number');
      expect(maxConfigField).toHaveValue(15); // Default from mock
    });

    it('allows valid input in max configurations field', () => {
      renderEditSkillView();
      const maxConfigField = screen.getByLabelText('Number of Partitions');

      // Test valid values (range is 1-25)
      fireEvent.change(maxConfigField, { target: { value: '10' } });
      expect(maxConfigField).toHaveValue(10);

      fireEvent.change(maxConfigField, { target: { value: '1' } });
      expect(maxConfigField).toHaveValue(1);

      fireEvent.change(maxConfigField, { target: { value: '25' } });
      expect(maxConfigField).toHaveValue(25);
    });

    it('has description field with correct constraints', () => {
      renderEditSkillView();
      const descriptionField = screen.getByLabelText('Description (required)');

      // Check that field can accept text input
      expect(descriptionField).toHaveValue('Test skill description');

      fireEvent.change(descriptionField, {
        target: {
          value:
            'This is a new description with enough characters to meet minimum',
        },
      });
      expect(descriptionField).toHaveValue(
        'This is a new description with enough characters to meet minimum',
      );
    });
  });

  describe('Form Interaction', () => {
    it('allows editing description', () => {
      renderEditSkillView();
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

    it('allows editing max configurations', () => {
      renderEditSkillView();
      const maxConfigField = screen.getByLabelText('Number of Partitions');

      fireEvent.change(maxConfigField, { target: { value: '25' } });

      expect(maxConfigField).toHaveValue(25);
    });

    it('navigates back when cancel button is clicked', () => {
      renderEditSkillView();
      const cancelButton = screen.getByRole('button', { name: /cancel/i });

      fireEvent.click(cancelButton);

      expect(routerMockState.navigate).toHaveBeenCalledTimes(1);
      expect(routerMockState.navigate).toHaveBeenCalledWith({
        to: '/agents/$agentName/skills/$skillName',
        params: { agentName: 'Test Agent 1', skillName: 'Test Skill 1' },
        replace: true,
      });
    });
  });

  describe('Form Submission', () => {
    it('has update skill button', () => {
      renderEditSkillView();

      const updateButton = screen.getByRole('button', {
        name: /update skill/i,
      });
      expect(updateButton).toBeInTheDocument();
      expect(updateButton).not.toBeDisabled();
    });

    it('has cancel button that works', () => {
      renderEditSkillView();

      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      expect(cancelButton).toBeInTheDocument();

      fireEvent.click(cancelButton);
      expect(routerMockState.navigate).toHaveBeenCalledTimes(1);
      expect(routerMockState.navigate).toHaveBeenCalledWith({
        to: '/agents/$agentName/skills/$skillName',
        params: { agentName: 'Test Agent 1', skillName: 'Test Skill 1' },
        replace: true,
      });
    });

    it('displays form with current skill data', () => {
      renderEditSkillView();

      const descriptionField = screen.getByLabelText('Description (required)');
      const maxConfigField = screen.getByLabelText('Number of Partitions');

      // Check that form is populated with current data
      expect(descriptionField).toHaveValue('Test skill description');
      expect(maxConfigField).toHaveValue(15);
    });
  });

  describe('Error States', () => {
    it('shows error state when agent is not found', () => {
      // Mock agents provider to return undefined selectedAgent
      vi.mocked(useAgents).mockReturnValue({
        agents: [],
        selectedAgent: undefined,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
        queryParams: {},
        setQueryParams: vi.fn(),
        createAgent: vi.fn(),
        updateAgent: vi.fn(),
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

      renderEditSkillView();

      expect(screen.getAllByText('Skill not found')).toHaveLength(2);
      expect(
        screen.getByText(
          'Unable to find the specified skill. Please ensure the skill exists and try again.',
        ),
      ).toBeInTheDocument();
    });

    it('shows error state when skill is not found', () => {
      // Mock skills provider to return undefined selectedSkill
      vi.mocked(useSkills).mockReturnValue({
        skills: [],
        selectedSkill: undefined,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
        queryParams: {},
        setQueryParams: vi.fn(),
        createSkill: vi.fn(),
        updateSkill: vi.fn(),
        deleteSkill: vi.fn(),
        isCreating: false,
        isUpdating: false,
        isDeleting: false,
        createError: null,
        updateError: null,
        deleteError: null,
        hasNextPage: false,
        isFetchingNextPage: false,
        fetchNextPage: vi.fn(),
        getSkillById: vi.fn(),
        refreshSkills: vi.fn(),
      });

      renderEditSkillView();

      expect(screen.getAllByText('Skill not found')).toHaveLength(2);
      expect(
        screen.getByText(
          'Unable to find the specified skill. Please ensure the skill exists and try again.',
        ),
      ).toBeInTheDocument();
    });
  });

  describe('Loading States', () => {
    it('renders form with enabled fields by default', () => {
      renderEditSkillView();

      const descriptionField = screen.getByLabelText('Description (required)');
      const maxConfigField = screen.getByLabelText('Number of Partitions');
      const updateButton = screen.getByRole('button', {
        name: /update skill/i,
      });
      const cancelButton = screen.getByRole('button', { name: /cancel/i });

      // Check that fields are enabled by default (not updating)
      expect(descriptionField).not.toBeDisabled();
      expect(maxConfigField).not.toBeDisabled();
      expect(updateButton).not.toBeDisabled();
      expect(cancelButton).not.toBeDisabled();
    });
  });

  describe('Accessibility', () => {
    it('has proper form labels', () => {
      renderEditSkillView();

      expect(
        screen.getByLabelText('Description (required)'),
      ).toBeInTheDocument();
      expect(screen.getByLabelText('Number of Partitions')).toBeInTheDocument();
    });

    it('has proper form descriptions', () => {
      renderEditSkillView();

      expect(
        screen.getByText(
          /provide additional context about the skill's functionality/i,
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/each request to the skill will be routed/i),
      ).toBeInTheDocument();
    });

    it('has proper button roles and accessibility', () => {
      renderEditSkillView();

      const updateButton = screen.getByRole('button', {
        name: /update skill/i,
      });
      const cancelButton = screen.getByRole('button', { name: /cancel/i });

      expect(updateButton).toBeInTheDocument();
      expect(cancelButton).toBeInTheDocument();
    });
  });
});
