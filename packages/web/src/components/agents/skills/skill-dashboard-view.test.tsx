import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { SkillDashboardView } from '@web/components/agents/skills/skill-dashboard-view';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock TanStack Router and params before importing component
const mockNavigate = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({
    navigate: mockNavigate,
    history: {
      back: vi.fn(),
      forward: vi.fn(),
    },
  }),
  useNavigate: () => mockNavigate,
  useParams: () => ({
    agentName: 'Test%20Agent',
    skillName: 'Test%20Skill',
  }),
  useLocation: () => ({ pathname: '/agents/Test%20Agent/Test%20Skill' }),
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

// Mock the skills API to prevent real HTTP calls
vi.mock('@web/api/v1/super-agents/skills', () => ({
  getSkillEvaluationScoresByTimeBucket: vi.fn().mockResolvedValue([]),
  getSkills: vi.fn().mockResolvedValue([]),
  getSkillClusterStates: vi.fn().mockResolvedValue([]),
  getSkillModels: vi.fn().mockResolvedValue([]),
  getSkillEvaluations: vi.fn().mockResolvedValue([]),
  getSkillEvaluationRuns: vi.fn().mockResolvedValue([]),
}));

// Mock agent and skill objects
const mockAgent = {
  id: 'agent-1',
  name: 'Test Agent',
  description: 'Test agent description',
  metadata: {},
  created_at: '2023-01-01T10:30:00Z',
  updated_at: '2023-01-01T10:30:00Z',
};

const mockSkill = {
  id: 'skill-1',
  agent_id: 'agent-1',
  name: 'Test Skill',
  description: 'Test skill description',
  metadata: {},
  optimize: true,
  configuration_count: 15,
  created_at: '2023-01-01T10:30:00Z',
  updated_at: '2023-01-01T10:30:00Z',
  clustering_interval: 15,
  reflection_min_requests_per_arm: 3,
  exploration_temperature: 1.0,
};

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

// Mock other providers
vi.mock('@web/providers/logs', () => ({
  useLogs: vi.fn(),
}));

vi.mock('@web/providers/models', () => ({
  useModels: vi.fn(),
}));

vi.mock('@web/providers/skill-optimization-clusters', () => ({
  useSkillOptimizationClusters: vi.fn(),
}));

vi.mock('@web/providers/skill-optimization-evaluation-runs', () => ({
  useSkillOptimizationEvaluationRuns: vi.fn(),
}));

vi.mock('@web/providers/skill-optimization-evaluations', () => ({
  useSkillOptimizationEvaluations: vi.fn(),
}));

vi.mock('@web/providers/skill-events', () => ({
  useSkillEvents: vi.fn(),
}));

// Mock dialog components
vi.mock('@web/components/agents/skills/manage-skill-models-dialog', () => ({
  ManageSkillModelsDialog: () => <div data-testid="manage-models-dialog" />,
}));

vi.mock(
  '@web/components/agents/skills/manage-skill-evaluations-dialog',
  () => ({
    ManageSkillEvaluationsDialog: () => (
      <div data-testid="manage-evaluations-dialog" />
    ),
  }),
);

// Mock the skill validation hook
vi.mock('@web/hooks/use-skill-validation', () => ({
  useSkillValidation: vi.fn(),
}));

import { useSkillValidation } from '@web/hooks/use-skill-validation';
import { useAgents } from '@web/providers/agents';
import { useLogs } from '@web/providers/logs';
import { useModels } from '@web/providers/models';
import { useNavigation } from '@web/providers/navigation';
import { useSkillEvents } from '@web/providers/skill-events';
import { useSkillOptimizationClusters } from '@web/providers/skill-optimization-clusters';
import { useSkillOptimizationEvaluationRuns } from '@web/providers/skill-optimization-evaluation-runs';
import { useSkillOptimizationEvaluations } from '@web/providers/skill-optimization-evaluations';
import { useSkills } from '@web/providers/skills';

const renderWithProviders = (component: React.ReactElement) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>{component}</QueryClientProvider>,
  );
};

describe('SkillDashboardView', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup default mock implementations
    vi.mocked(useAgents).mockReturnValue({
      selectedAgent: mockAgent,
      agents: [mockAgent],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
      createAgent: vi.fn(),
      updateAgent: vi.fn(),
      deleteAgent: vi.fn(),
      isCreating: false,
      isUpdating: false,
      isDeleting: false,
      createError: null,
      updateError: null,
      deleteError: null,
      getAgentById: vi.fn(),
      setSelectedAgent: vi.fn(),
      refreshAgents: vi.fn(),
    } as unknown as never);

    vi.mocked(useNavigation).mockReturnValue({
      navigationState: {
        section: 'agents' as const,
        currentView: 'skill-dashboard' as const,
        selectedAgentName: 'Test Agent',
        selectedSkillName: 'Test Skill',
        breadcrumbs: [],
      },
      navigateToAgents: vi.fn(),
      navigateToAgentDetail: vi.fn(),
      navigateToSkillDashboard: vi.fn(),
      navigateToLogs: vi.fn(),
      navigateToClusters: vi.fn(),
      navigateToClusterArms: vi.fn(),
      navigateToArmDetail: vi.fn(),
    } as unknown as never);

    vi.mocked(useSkills).mockReturnValue({
      selectedSkill: mockSkill,
      skills: [mockSkill],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
      queryParams: {},
      setQueryParams: vi.fn(),
      setSelectedSkill: vi.fn(),
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
    } as unknown as never);

    vi.mocked(useLogs).mockReturnValue({
      logs: [],
      selectedLog: undefined,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
      agentId: null,
      setAgentId: vi.fn(),
      skillId: null,
      setSkillId: vi.fn(),
      setAgentWide: vi.fn(),
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      getLogById: vi.fn(),
      refreshLogs: vi.fn(),
    } as unknown as never);

    vi.mocked(useModels).mockReturnValue({
      skillModels: [],
      isLoadingSkillModels: false,
      setSkillId: vi.fn(),
    } as unknown as never);

    vi.mocked(useSkillOptimizationClusters).mockReturnValue({
      clusters: [],
      isLoading: false,
      setSkillId: vi.fn(),
      selectedCluster: null,
      setSelectedCluster: vi.fn(),
      refetch: vi.fn(),
    } as unknown as never);

    vi.mocked(useSkillOptimizationEvaluationRuns).mockReturnValue({
      evaluationRuns: [],
      isLoading: false,
      setSkillId: vi.fn(),
    } as unknown as never);

    vi.mocked(useSkillOptimizationEvaluations).mockReturnValue({
      evaluations: [],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
      setSkillId: vi.fn(),
    } as unknown as never);

    vi.mocked(useSkillValidation).mockReturnValue({
      isReady: true,
      missingRequirements: [],
    } as unknown as never);

    vi.mocked(useSkillEvents).mockReturnValue({
      events: [],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
      skillId: null,
      setSkillId: vi.fn(),
      clusterId: null,
      setClusterId: vi.fn(),
      eventType: null,
      setEventType: vi.fn(),
      scope: 'all',
      setScope: vi.fn(),
      page: 1,
      pageSize: 20,
      setPage: vi.fn(),
      setPageSize: vi.fn(),
      hasMore: false,
      getEventsByClusterId: vi.fn(() => []),
      getEventsBySkillId: vi.fn(() => []),
      clearFilters: vi.fn(),
    } as unknown as never);
  });

  it('renders skill dashboard with skill name', async () => {
    renderWithProviders(<SkillDashboardView />);

    await waitFor(() => {
      expect(screen.getByText('Test Skill')).toBeInTheDocument();
    });
  });

  it('displays DiceBear avatar in the page header', async () => {
    renderWithProviders(<SkillDashboardView />);

    await waitFor(() => {
      // Should find an image with the skill name in alt text
      const images = screen.getAllByRole('img');
      const skillAvatar = images.find(
        (img) =>
          img.getAttribute('alt')?.includes('Test Skill') &&
          img.getAttribute('alt')?.includes('icon'),
      );

      expect(skillAvatar).toBeTruthy();

      // Avatar should have SVG data (either base64 or URL-encoded)
      const src = skillAvatar?.getAttribute('src');
      expect(src).toContain('data:image/svg+xml');
    });
  });

  it('displays skill description', async () => {
    renderWithProviders(<SkillDashboardView />);

    await waitFor(() => {
      expect(screen.getByText('Test skill description')).toBeInTheDocument();
    });
  });

  it('reads its recent requests the way the logs page does', async () => {
    // The clock is frozen: a running request's elapsed time is read from
    // `Date.now()` when its cell first renders, and under coverage
    // instrumentation the render is slow enough for "4.0s" to drift to "4.1s".
    vi.useFakeTimers({ toFake: ['Date'] });
    // The card and the logs table render through the same cells, so a
    // request that failed, or one still running, reads the same on both.
    vi.mocked(useLogs).mockReturnValue({
      ...vi.mocked(useLogs)(),
      logs: [
        {
          id: 'log-done',
          cluster_id: 'cluster-1',
          function_name: 'chat_complete',
          model: 'glm-5.3',
          status: 200,
          start_time: new Date('2026-09-03T10:15:30Z').getTime(),
          end_time: new Date('2026-09-03T10:15:31Z').getTime(),
          duration: 900,
          avg_eval_score: 0.91,
        },
        {
          id: 'log-running',
          cluster_id: null,
          function_name: 'chat_complete',
          model: null,
          status: null,
          start_time: Date.now() - 4000,
          end_time: null,
          duration: null,
          avg_eval_score: null,
        },
      ],
    } as unknown as never);

    renderWithProviders(<SkillDashboardView />);

    await waitFor(() => {
      for (const header of ['Status', 'Eval', 'Model', 'Partition']) {
        expect(screen.getByText(header)).toBeInTheDocument();
      }
    });

    expect(screen.getByText('200')).toBeInTheDocument();
    expect(screen.getByText('91%')).toBeInTheDocument();
    expect(screen.getByText('900ms')).toBeInTheDocument();

    // And the one still running says so, counting up rather than showing a
    // status it has not got.
    expect(screen.getByTestId('running-log-row')).toBeInTheDocument();
    expect(screen.getByText('running')).toBeInTheDocument();
    expect(screen.getByText('4.0s')).toBeInTheDocument();
  });

  it('shows no skill selected message when skill is not available', async () => {
    vi.mocked(useSkills).mockReturnValue({
      selectedSkill: null,
      skills: [],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
      queryParams: {},
      setQueryParams: vi.fn(),
      setSelectedSkill: vi.fn(),
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
    } as unknown as never);

    renderWithProviders(<SkillDashboardView />);

    await waitFor(() => {
      expect(screen.getByText('Skill Dashboard')).toBeInTheDocument();
      const messages = screen.getAllByText(/no skill selected/i);
      expect(messages.length).toBeGreaterThan(0);
    });
  });
});
