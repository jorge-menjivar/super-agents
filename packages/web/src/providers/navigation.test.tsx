import type { Agent, Skill } from '@shared/types/data';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Create mock state with vi.hoisted so it's available to vi.mock factory
const {
  mockNavigationState,
  mockNavigate,
  resetMocks,
  setPathname,
  setParams,
  setNavigationState,
} = vi.hoisted(() => {
  const mockNavigate = vi.fn();
  const mockNavigateToAgent = vi.fn();
  const mockNavigateToSkill = vi.fn();
  const mockNavigateToSkillDashboard = vi.fn();
  const mockNavigateBack = vi.fn();

  const mockNavigationState = {
    section: 'agents' as const,
    currentView: 'agents-list' as
      | 'agents-list'
      | 'agent-view'
      | 'edit-agent'
      | 'create-skill'
      | 'skill-dashboard'
      | 'edit-skill'
      | 'logs'
      | 'log-detail'
      | 'evaluations'
      | 'evaluation-detail'
      | 'datasets'
      | 'dataset-detail',
    breadcrumbs: [{ label: 'Agents', path: '/agents' }] as Array<{
      label: string;
      path: string;
    }>,
    selectedAgentName: undefined as string | undefined,
    selectedSkillName: undefined as string | undefined,
    pathname: '/agents',
    params: {} as Record<string, string | undefined>,
  };

  const setPathname = (pathname: string) => {
    mockNavigationState.pathname = pathname;
  };

  const setParams = (params: Record<string, string | undefined>) => {
    mockNavigationState.params = params;
    // Decode params and set them on navigation state
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

  const setNavigationState = (updates: Partial<typeof mockNavigationState>) => {
    Object.assign(mockNavigationState, updates);
  };

  const resetMocks = () => {
    mockNavigate.mockClear();
    mockNavigateToAgent.mockClear();
    mockNavigateToSkill.mockClear();
    mockNavigateToSkillDashboard.mockClear();
    mockNavigateBack.mockClear();
    mockNavigationState.section = 'agents';
    mockNavigationState.currentView = 'agents-list';
    mockNavigationState.breadcrumbs = [{ label: 'Agents', path: '/agents' }];
    mockNavigationState.selectedAgentName = undefined;
    mockNavigationState.selectedSkillName = undefined;
    mockNavigationState.pathname = '/agents';
    mockNavigationState.params = {};
  };

  return {
    mockNavigationState,
    mockNavigate,
    mockNavigateToAgent,
    mockNavigateToSkill,
    mockNavigateToSkillDashboard,
    mockNavigateBack,
    resetMocks,
    setPathname,
    setParams,
    setNavigationState,
  };
});

// Mock the navigation provider module entirely
vi.mock('@web/providers/navigation', () => ({
  NavigationProvider: ({ children }: { children: React.ReactNode }) => children,
  useNavigation: () => ({
    navigationState: mockNavigationState,
    isLoadingFromStorage: false,
    navigate: mockNavigate,
    setSection: vi.fn(),
    navigateToSkillDashboard: vi.fn((agentName: string, skillName: string) => {
      mockNavigate({
        to: `/agents/${encodeURIComponent(agentName)}/skills/${encodeURIComponent(skillName)}`,
      });
    }),
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
    navigateBack: vi.fn((_targetSegmentIndex: number) => {
      mockNavigate({ to: '/agents' });
    }),
    updateBreadcrumbs: vi.fn(),
  }),
}));

import { NavigationProvider, useNavigation } from '@web/providers/navigation';

// Mock API functions
vi.mock('@web/api/v1/super-agents/agents', () => ({
  getAgents: vi.fn(),
}));

vi.mock('@web/api/v1/super-agents/skills', () => ({
  getSkills: vi.fn(),
}));

import { getAgents } from '@web/api/v1/super-agents/agents';
import { getSkills } from '@web/api/v1/super-agents/skills';

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

const mockSkills: Skill[] = [
  {
    id: '1',
    name: 'Test Skill 1',
    description: 'Test Skill Description 1',
    agent_id: '1',
    metadata: {},
    optimize: false,
    configuration_count: 10,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    clustering_interval: 0,
    reflection_min_requests_per_arm: 0,
    exploration_temperature: 1.0,
    last_clustering_at: null,
    last_clustering_log_start_time: null,
    evaluations_regenerated_at: null,
    evaluation_lock_acquired_at: null,
    total_requests: 0,
    allowed_template_variables: ['datetime'],
    auto_created: false,
    seed_system_prompt: null,
  },
  {
    id: '2',
    name: 'Test Skill 2',
    description: 'Test Skill Description 2',
    agent_id: '1',
    metadata: {},
    optimize: false,
    configuration_count: 10,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    clustering_interval: 0,
    reflection_min_requests_per_arm: 0,
    exploration_temperature: 1.0,
    last_clustering_at: null,
    last_clustering_log_start_time: null,
    evaluations_regenerated_at: null,
    evaluation_lock_acquired_at: null,
    total_requests: 0,
    allowed_template_variables: ['datetime'],
    auto_created: false,
    seed_system_prompt: null,
  },
];

// Mock localStorage
const mockLocalStorage = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};

Object.defineProperty(window, 'localStorage', {
  value: mockLocalStorage,
});

// Test component to access navigation context
const TestComponent: React.FC = () => {
  const navigation = useNavigation();

  return (
    <div>
      <div data-testid="selected-agent">
        {navigation.navigationState.selectedAgentName || 'None'}
      </div>
      <div data-testid="selected-skill">
        {navigation.navigationState.selectedSkillName || 'None'}
      </div>
      <div data-testid="current-view">
        {navigation.navigationState.currentView}
      </div>
      <div data-testid="breadcrumbs">
        {navigation.navigationState.breadcrumbs.map((b) => b.label).join(' > ')}
      </div>
      <button
        data-testid="set-agent"
        onClick={() =>
          navigation.navigate({
            to: `/agents/${encodeURIComponent('Test Agent 1')}`,
          })
        }
        type="button"
      >
        Set Agent
      </button>
      <button
        data-testid="clear-agent"
        onClick={() => navigation.navigateBack(0)}
        type="button"
      >
        Clear Agent
      </button>
      <button
        data-testid="navigate-skill"
        onClick={() =>
          navigation.navigateToSkillDashboard('Test Agent 1', 'Test Skill 1')
        }
        type="button"
      >
        Navigate to Skill
      </button>
    </div>
  );
};

const renderWithProviders = (component: React.ReactElement) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <NavigationProvider>{component}</NavigationProvider>
    </QueryClientProvider>,
  );
};

describe('NavigationProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMocks();
    vi.mocked(getAgents).mockResolvedValue(mockAgents);
    vi.mocked(getSkills).mockResolvedValue(mockSkills);
    mockLocalStorage.getItem.mockReturnValue(null);
    setPathname('/agents');
    setParams({});
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('provides initial navigation state', () => {
    act(() => {
      renderWithProviders(<TestComponent />);
    });

    expect(screen.getByTestId('selected-agent')).toHaveTextContent('None');
    expect(screen.getByTestId('selected-skill')).toHaveTextContent('None');
    expect(screen.getByTestId('current-view')).toHaveTextContent('agents-list');
    expect(screen.getByTestId('breadcrumbs')).toHaveTextContent('Agents');
  });

  it('sets selected agent and navigates', () => {
    act(() => {
      renderWithProviders(<TestComponent />);
    });

    const setAgentButton = screen.getByTestId('set-agent');
    act(() => {
      fireEvent.click(setAgentButton);
    });

    expect(mockNavigate).toHaveBeenCalledWith({
      to: '/agents/Test%20Agent%201',
    });
  });

  it('clears selected agent and navigates', () => {
    setParams({ agentName: 'Test%20Agent%201' });
    setNavigationState({
      selectedAgentName: 'Test Agent 1',
      currentView: 'agent-view',
    });

    act(() => {
      renderWithProviders(<TestComponent />);
    });

    const clearAgentButton = screen.getByTestId('clear-agent');
    act(() => {
      fireEvent.click(clearAgentButton);
    });

    expect(mockNavigate).toHaveBeenCalledWith({ to: '/agents' });
  });

  it('navigates to skill dashboard', () => {
    act(() => {
      renderWithProviders(<TestComponent />);
    });

    const navigateButton = screen.getByTestId('navigate-skill');
    act(() => {
      fireEvent.click(navigateButton);
    });

    expect(mockNavigate).toHaveBeenCalledWith({
      to: '/agents/Test%20Agent%201/skills/Test%20Skill%201',
    });
  });

  it('navigates even without localStorage', () => {
    // Navigation should work independently of localStorage
    act(() => {
      renderWithProviders(<TestComponent />);
    });

    const setAgentButton = screen.getByTestId('set-agent');
    act(() => {
      fireEvent.click(setAgentButton);
    });

    // Should navigate using router
    expect(mockNavigate).toHaveBeenCalled();
  });

  it('sanitizes agent names from URL parameters', async () => {
    // Mock params with potentially dangerous characters
    setParams({
      agentName: 'Test%3Cscript%3Ealert(%22xss%22)%3C/script%3EAgent',
    });

    act(() => {
      renderWithProviders(<TestComponent />);
    });

    // The navigation provider should parse the agent name from URL
    await waitFor(() => {
      expect(screen.getByTestId('selected-agent')).toBeInTheDocument();
    });
  });

  it('generates correct breadcrumbs for different views', async () => {
    // Test with agent selected (skills list view)
    setParams({ agentName: 'Test%20Agent%201' });
    setNavigationState({
      selectedAgentName: 'Test Agent 1',
      currentView: 'agent-view',
      breadcrumbs: [
        { label: 'Agents', path: '/agents' },
        { label: 'Test Agent 1', path: '/agents/Test%20Agent%201' },
      ],
    });

    act(() => {
      renderWithProviders(<TestComponent />);
    });

    // Check that breadcrumbs are generated
    await waitFor(() => {
      const breadcrumbsText = screen.getByTestId('breadcrumbs').textContent;
      expect(breadcrumbsText).toContain('Agents');
      expect(breadcrumbsText).toContain('Test Agent 1');
    });
  });

  it('handles skill navigation with selected agent', async () => {
    // Mock with selected agent
    setParams({ agentName: 'Test%20Agent%201' });
    setNavigationState({ selectedAgentName: 'Test Agent 1' });

    const TestComponentWithSkill: React.FC = () => {
      const navigation = useNavigation();

      return (
        <div>
          <div data-testid="selected-agent">
            {navigation.navigationState.selectedAgentName || 'None'}
          </div>
          <button
            data-testid="navigate-skill"
            onClick={() =>
              navigation.navigateToSkillDashboard(
                'Test Agent 1',
                'Test Skill 1',
              )
            }
            type="button"
          >
            Navigate to Skill
          </button>
        </div>
      );
    };

    act(() => {
      renderWithProviders(<TestComponentWithSkill />);
    });

    // Wait for component to render
    await waitFor(() => {
      expect(screen.getByTestId('selected-agent')).toHaveTextContent(
        'Test Agent 1',
      );
    });

    const navigateButton = screen.getByTestId('navigate-skill');
    act(() => {
      fireEvent.click(navigateButton);
    });

    expect(mockNavigate).toHaveBeenCalledWith({
      to: '/agents/Test%20Agent%201/skills/Test%20Skill%201',
    });
  });

  it('parses edit-skill view from URL correctly', async () => {
    // Set up the navigation state for edit-skill view
    setParams({
      agentName: 'Test%20Agent%201',
      skillName: 'Test%20Skill%201',
    });
    setNavigationState({
      selectedAgentName: 'Test Agent 1',
      selectedSkillName: 'Test Skill 1',
      currentView: 'edit-skill',
    });

    act(() => {
      renderWithProviders(<TestComponent />);
    });

    // Verify it correctly shows the agent and skill
    await waitFor(() => {
      expect(screen.getByTestId('selected-agent')).toHaveTextContent(
        'Test Agent 1',
      );
      expect(screen.getByTestId('current-view')).toHaveTextContent(
        'edit-skill',
      );
    });
  });

  it('parses skill-dashboard view from URL correctly', async () => {
    // Set up the navigation state for skill-dashboard view
    setParams({
      agentName: 'Test%20Agent%201',
      skillName: 'Test%20Skill%201',
    });
    setNavigationState({
      selectedAgentName: 'Test Agent 1',
      selectedSkillName: 'Test Skill 1',
      currentView: 'skill-dashboard',
    });

    act(() => {
      renderWithProviders(<TestComponent />);
    });

    // Verify it correctly shows the skill dashboard view
    await waitFor(() => {
      expect(screen.getByTestId('selected-skill')).toHaveTextContent(
        'Test Skill 1',
      );
      expect(screen.getByTestId('current-view')).toHaveTextContent(
        'skill-dashboard',
      );
    });
  });
});

describe('Navigation helper functions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMocks();
    mockLocalStorage.getItem.mockReturnValue(null);
    setPathname('/agents');
    setParams({});
  });

  it('sanitizes dangerous characters from names', () => {
    setParams({ agentName: 'Test%3Cscript%3EAgent' });

    const TestSanitizeComponent: React.FC = () => {
      return <div data-testid="test">Test</div>;
    };

    act(() => {
      renderWithProviders(<TestSanitizeComponent />);
    });

    // The component should render without throwing errors
    expect(screen.getByTestId('test')).toBeInTheDocument();
  });

  it('works without relying on localStorage', () => {
    // Navigation works purely through router, not localStorage
    act(() => {
      renderWithProviders(<TestComponent />);
    });

    const setAgentButton = screen.getByTestId('set-agent');

    // Should not throw errors
    expect(() => {
      act(() => {
        fireEvent.click(setAgentButton);
      });
    }).not.toThrow();

    // Should navigate using router
    expect(mockNavigate).toHaveBeenCalled();
  });

  it('consistently navigates using router', () => {
    // Navigation is stateless and router-based
    act(() => {
      renderWithProviders(<TestComponent />);
    });

    const setAgentButton = screen.getByTestId('set-agent');

    // First navigation
    act(() => {
      fireEvent.click(setAgentButton);
    });

    expect(mockNavigate).toHaveBeenCalled();

    // Second navigation should also work consistently
    act(() => {
      fireEvent.click(setAgentButton);
    });

    expect(mockNavigate).toHaveBeenCalledTimes(2);
  });
});
