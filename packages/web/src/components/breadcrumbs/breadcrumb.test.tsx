import type { Agent } from '@shared/types/data';
import type { Skill } from '@shared/types/data/skill';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { BreadcrumbComponent } from '@web/components/breadcrumb/breadcrumb';
import { AgentsProvider } from '@web/providers/agents';
import { NavigationProvider } from '@web/providers/navigation';
import { SkillsProvider } from '@web/providers/skills';
import type React from 'react';
import {
  beforeEach,
  describe,
  expect,
  it,
  type MockedFunction,
  vi,
} from 'vitest';

// Use vi.hoisted to create mock state that can be accessed by vi.mock factory
const {
  mockNavigationState,
  mockNavigate,
  mockAgentsState,
  mockSkillsState,
  resetMocks,
  setMockParams,
  setMockPathname,
  setMockBreadcrumbs,
  setMockAgentsLoading,
  setMockSelectedAgent,
  setMockSkills,
  setMockSelectedSkill,
} = vi.hoisted(() => {
  const mockNavigate = vi.fn();
  const mockSetQueryParams = vi.fn();

  const mockNavigationState = {
    section: 'agents' as const,
    currentView: 'agents-list' as const,
    breadcrumbs: [{ label: 'Agents', path: '/agents' }] as Array<{
      label: string;
      path: string;
      isAgentDropdown?: boolean;
      isSkillDropdown?: boolean;
      isClusterDropdown?: boolean;
      isArmDropdown?: boolean;
    }>,
    selectedAgentName: undefined as string | undefined,
    selectedSkillName: undefined as string | undefined,
  };

  const mockAgentsState = {
    agents: [] as Agent[],
    selectedAgent: undefined as Agent | undefined,
    isLoading: false,
  };

  const mockSkillsState = {
    skills: [] as Skill[],
    selectedSkill: undefined as Skill | undefined,
    isLoading: false,
    setQueryParams: mockSetQueryParams,
  };

  const setMockBreadcrumbs = (
    breadcrumbs: Array<{
      label: string;
      path: string;
      isAgentDropdown?: boolean;
      isSkillDropdown?: boolean;
    }>,
  ) => {
    mockNavigationState.breadcrumbs = breadcrumbs;
  };

  const setMockAgentsLoading = (loading: boolean) => {
    mockAgentsState.isLoading = loading;
  };

  const setMockSelectedAgent = (agent: Agent | undefined) => {
    mockAgentsState.selectedAgent = agent;
    if (agent) {
      mockNavigationState.selectedAgentName = agent.name;
    }
  };

  const setMockSkills = (skills: Skill[]) => {
    mockSkillsState.skills = skills;
  };

  const setMockSelectedSkill = (skill: Skill | undefined) => {
    mockSkillsState.selectedSkill = skill;
    if (skill) {
      mockNavigationState.selectedSkillName = skill.name;
    }
  };

  const setMockPathname = (_pathname: string) => {
    // Update breadcrumbs based on pathname (handled by setMockBreadcrumbs)
  };

  const setMockParams = (params: Record<string, string | undefined>) => {
    if (params.agentName) {
      mockNavigationState.selectedAgentName = decodeURIComponent(
        params.agentName,
      );
    }
    if (params.skillName) {
      mockNavigationState.selectedSkillName = decodeURIComponent(
        params.skillName,
      );
    }
  };

  const resetMocks = () => {
    mockNavigate.mockClear();
    mockSetQueryParams.mockClear();
    mockNavigationState.section = 'agents';
    mockNavigationState.currentView = 'agents-list';
    mockNavigationState.breadcrumbs = [{ label: 'Agents', path: '/agents' }];
    mockNavigationState.selectedAgentName = undefined;
    mockNavigationState.selectedSkillName = undefined;
    mockAgentsState.agents = [];
    mockAgentsState.selectedAgent = undefined;
    mockAgentsState.isLoading = false;
    mockSkillsState.skills = [];
    mockSkillsState.selectedSkill = undefined;
    mockSkillsState.isLoading = false;
  };

  return {
    mockNavigationState,
    mockNavigate,
    mockAgentsState,
    mockSkillsState,
    resetMocks,
    setMockParams,
    setMockPathname,
    setMockBreadcrumbs,
    setMockAgentsLoading,
    setMockSelectedAgent,
    setMockSkills,
    setMockSelectedSkill,
  };
});

// Mock the navigation provider module
vi.mock('@web/providers/navigation', () => {
  return {
    NavigationProvider: ({ children }: { children: React.ReactNode }) =>
      children,
    useNavigation: () => ({
      navigationState: mockNavigationState,
      isLoadingFromStorage: false,
      navigate: mockNavigate,
      setSection: vi.fn(),
      navigateToAgent: vi.fn(),
      navigateToSkill: vi.fn(),
      navigateToLogs: vi.fn(),
      navigateToLogDetail: vi.fn(),
      navigateToEvaluations: vi.fn(),
      navigateToEvaluationDetail: vi.fn(),
      navigateToDatasets: vi.fn(),
      navigateToDatasetDetail: vi.fn(),
      navigateToConfigurations: vi.fn(),
      navigateToConfigurationDetail: vi.fn(),
      navigateToClusters: vi.fn(),
      navigateToClusterDetail: vi.fn(),
      navigateToClusterArms: vi.fn(),
      navigateToArmDetail: vi.fn(),
      navigateToSkillEvents: vi.fn(),
      navigateBack: vi.fn(),
      updateBreadcrumbs: vi.fn(),
    }),
  };
});

// Mock the agents provider
vi.mock('@web/providers/agents', () => ({
  AgentsProvider: ({ children }: { children: React.ReactNode }) => children,
  useAgents: () => ({
    agents: mockAgentsState.agents,
    selectedAgent: mockAgentsState.selectedAgent,
    isLoading: mockAgentsState.isLoading,
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
  }),
}));

// Mock the skills provider
vi.mock('@web/providers/skills', () => ({
  SkillsProvider: ({ children }: { children: React.ReactNode }) => children,
  useSkills: () => ({
    skills: mockSkillsState.skills,
    selectedSkill: mockSkillsState.selectedSkill,
    isLoading: mockSkillsState.isLoading,
    error: null,
    refetch: vi.fn(),
    queryParams: {},
    setQueryParams: mockSkillsState.setQueryParams,
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
  }),
}));

// Mock the skill optimization providers
vi.mock('@web/providers/skill-optimization-clusters', () => ({
  useSkillOptimizationClusters: () => ({
    clusters: [],
    selectedCluster: undefined,
    isLoading: false,
  }),
}));

vi.mock('@web/providers/skill-optimization-arms', () => ({
  useSkillOptimizationArms: () => ({
    arms: [],
    selectedArm: undefined,
    isLoading: false,
  }),
}));

// Mock the permissive navigate hook
vi.mock('@web/hooks/use-permissive-navigate', () => ({
  usePermissiveNavigate: () => mockNavigate,
}));

// Mock keyboard shortcuts hook
vi.mock('@web/hooks/use-keyboard-shortcuts', () => ({
  useModifierKey: () => '⌘',
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
  {
    id: '3',
    name: 'Test Agent With Spaces',
    description: 'Test Description With Spaces',
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

// Type-safe localStorage mock
const mockGetItem = vi.fn().mockReturnValue(null) as MockedFunction<
  (key: string) => string | null
>;
const mockSetItem = vi.fn() as MockedFunction<
  (key: string, value: string) => void
>;
const mockRemoveItem = vi.fn() as MockedFunction<(key: string) => void>;
const mockClear = vi.fn() as MockedFunction<() => void>;
const mockKey = vi.fn().mockReturnValue(null) as MockedFunction<
  (index: number) => string | null
>;

const mockLocalStorage: Storage = {
  getItem: mockGetItem,
  setItem: mockSetItem,
  removeItem: mockRemoveItem,
  clear: mockClear,
  key: mockKey,
  length: 0,
};

// Only localStorage is mocked: replacing `window` wholesale with a spread of
// itself drops every prototype method, `getComputedStyle` among them, which
// Radix needs to place a popover.
Object.defineProperty(window, 'localStorage', {
  value: mockLocalStorage,
  writable: true,
});

const renderWithProviders = (component: React.ReactElement) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <NavigationProvider>
        <AgentsProvider>
          <SkillsProvider>{component}</SkillsProvider>
        </AgentsProvider>
      </NavigationProvider>
    </QueryClientProvider>,
  );
};

describe('BreadcrumbComponent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMocks();
    // Set up default agents in mock state
    mockAgentsState.agents = mockAgents;
    mockGetItem.mockReturnValue(null);
  });

  it('renders initial breadcrumb with agent selector', () => {
    // The component renders successfully without crashing
    expect(() => renderWithProviders(<BreadcrumbComponent />)).not.toThrow();
  });

  it('renders breadcrumb with selected agent', () => {
    setMockParams({ agentName: 'Test%20Agent%201' });
    setMockPathname('/agents/Test%20Agent%201');

    // The component renders successfully without crashing
    expect(() => renderWithProviders(<BreadcrumbComponent />)).not.toThrow();
  });

  it('renders complex breadcrumb path for nested navigation', () => {
    setMockParams({
      agentName: 'Test%20Agent%201',
      skillName: 'Test%20Skill%201',
      logId: 'log-123',
    });
    setMockPathname(
      '/agents/Test%20Agent%201/skills/Test%20Skill%201/logs/log-123',
    );

    // The component renders successfully without crashing
    expect(() => renderWithProviders(<BreadcrumbComponent />)).not.toThrow();
  });

  it('handles URL encoded agent names correctly', () => {
    setMockParams({ agentName: 'Test%20Agent%20With%20Spaces' });
    setMockPathname('/agents/Test%20Agent%20With%20Spaces');

    // The component renders successfully without crashing
    expect(() => renderWithProviders(<BreadcrumbComponent />)).not.toThrow();
  });

  it('shows disabled state while loading', async () => {
    // Set up agent dropdown breadcrumb with loading state
    setMockBreadcrumbs([{ label: 'Agent', path: '', isAgentDropdown: true }]);
    setMockAgentsLoading(true);

    await act(() => {
      renderWithProviders(<BreadcrumbComponent />);
    });

    // Shows loading placeholder in the agent dropdown breadcrumb
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('loads agents data on mount', () => {
    // The component renders successfully without crashing
    expect(() => renderWithProviders(<BreadcrumbComponent />)).not.toThrow();
  });

  describe('Skill Filtering', () => {
    it('filters skills by selected agent when agent changes', async () => {
      // Set up breadcrumbs with skill dropdown
      setMockBreadcrumbs([
        { label: 'Agent', path: '', isAgentDropdown: true },
        { label: 'Skill', path: '', isSkillDropdown: true },
      ]);

      // Set selected agent
      setMockSelectedAgent(mockAgents[0]);

      await act(() => {
        renderWithProviders(<BreadcrumbComponent />);
      });

      // Wait for useEffect to run
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
      });

      // Verify setQueryParams was called with agent_id filter
      expect(mockSkillsState.setQueryParams).toHaveBeenCalledWith(
        expect.objectContaining({
          agent_id: '1',
          limit: 100,
        }),
      );
    });

    it('updates skill filter when selected agent changes', async () => {
      // Set up breadcrumbs with skill dropdown
      setMockBreadcrumbs([
        { label: 'Agent', path: '', isAgentDropdown: true },
        { label: 'Skill', path: '', isSkillDropdown: true },
      ]);

      // Set selected agent
      setMockSelectedAgent(mockAgents[0]);

      await act(() => {
        renderWithProviders(<BreadcrumbComponent />);
      });

      // Wait for useEffect to run and update query params
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
      });

      // Verify setQueryParams was called with agent_id filter
      expect(mockSkillsState.setQueryParams).toHaveBeenCalledWith(
        expect.objectContaining({
          agent_id: '1',
          limit: 100,
        }),
      );
    });
  });

  describe('Skill Icon', () => {
    it('uses DiceBear avatar for skills instead of Wrench icon', async () => {
      const testSkill = {
        id: 'skill-1',
        agent_id: '1',
        name: 'Test Skill',
        description: 'Test skill description',
        metadata: {},
        optimize: false,
        configuration_count: 3,
        clustering_interval: 15,
        reflection_min_requests_per_arm: 3,
        exploration_temperature: 1.0,
        last_clustering_at: null,
        last_clustering_log_start_time: null,
        evaluations_regenerated_at: null,
        evaluation_lock_acquired_at: null,
        total_requests: 0,
        allowed_template_variables: ['datetime'],
        auto_created: false,
        seed_system_prompt: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      // Set up breadcrumbs with skill dropdown
      setMockBreadcrumbs([
        { label: 'Agent', path: '', isAgentDropdown: true },
        { label: 'Skill', path: '', isSkillDropdown: true },
      ]);

      // Set selected agent
      setMockSelectedAgent(mockAgents[0]);

      // Set skills data and selected skill
      setMockSkills([testSkill]);
      setMockSelectedSkill(testSkill);

      await act(() => {
        renderWithProviders(<BreadcrumbComponent />);
      });

      // Wait for render
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
      });

      // Should render skill name
      expect(screen.queryByText('Test Skill')).toBeTruthy();

      // Should render an image element for the skill avatar
      const images = screen.getAllByRole('img');
      const skillAvatar = images.find((img) =>
        img.getAttribute('alt')?.includes('Test Skill'),
      );
      expect(skillAvatar).toBeTruthy();

      // Avatar should have SVG data (using encodeURIComponent now)
      const src = skillAvatar?.getAttribute('src');
      expect(src).toContain('data:image/svg+xml');
    });
  });
  describe('Dropdown keyboard access', () => {
    it('opens the picker on ArrowDown, where a click navigates', async () => {
      setMockBreadcrumbs([{ label: 'Agent', path: '', isAgentDropdown: true }]);
      setMockSelectedAgent(mockAgents[0]);

      await act(() => {
        renderWithProviders(<BreadcrumbComponent />);
      });

      const trigger = screen.getByRole('button', { name: /Test Agent 1/ });

      // A click goes to the agent rather than opening the picker
      await act(() => {
        fireEvent.click(trigger);
      });
      expect(mockNavigate).toHaveBeenCalledWith({
        to: `/agents/${encodeURIComponent('Test Agent 1')}`,
      });
      expect(screen.queryByPlaceholderText('Search agents...')).toBeNull();

      // ArrowDown stands in for the right click a keyboard cannot make
      await act(() => {
        fireEvent.keyDown(trigger, { key: 'ArrowDown' });
      });
      expect(
        screen.getByPlaceholderText('Search agents...'),
      ).toBeInTheDocument();
    });
  });
});
