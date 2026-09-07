import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import { AgentsView } from '@web/components/agents/agents-view';
import { AgentsProvider } from '@web/providers/agents';
import { NavigationProvider } from '@web/providers/navigation';
import { SkillsProvider } from '@web/providers/skills';
import type React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  resetRouterMocks,
  setMockParams,
  setMockPathname,
} from '@/vitest.setup';

// TanStack Router is mocked globally in vitest.setup.tsx

// Mock API functions
vi.mock('@web/api/v1/super-agents/agents', () => ({
  getAgents: vi.fn(),
}));

vi.mock('@web/api/v1/super-agents/skills', () => ({
  getSkills: vi.fn(),
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

// Mock all agent view components
vi.mock('@web/components/agents/agents-list-view', () => ({
  AgentsListView: () => <div data-testid="agents-list-view">Agents List</div>,
}));

vi.mock('@web/components/agents/edit-agent-view', () => ({
  EditAgentView: () => <div data-testid="edit-agent-view">Edit Agent</div>,
}));

vi.mock('@web/components/agents/agent-view', () => ({
  AgentView: () => <div data-testid="agent-view">Agent View</div>,
  SkillsListView: () => <div data-testid="agent-view">Agent View</div>,
}));

vi.mock('@web/components/agents/skills/skill-dashboard-view', () => ({
  SkillDashboardView: () => (
    <div data-testid="skill-dashboard-view">Skill Dashboard</div>
  ),
}));

vi.mock('@web/components/agents/skills/edit-skill-view', () => ({
  EditSkillView: () => <div data-testid="edit-skill-view">Edit Skill</div>,
}));

vi.mock('@web/components/agents/skills/logs/log-details-view', () => ({
  LogDetailsView: () => <div data-testid="log-details-view">Log Detail</div>,
}));

vi.mock('@web/components/agents/skills/clusters/clusters-view', () => ({
  ClustersView: () => <div data-testid="clusters-view">Clusters</div>,
}));

vi.mock('@web/components/agents/skills/clusters/cluster-arms-view', () => ({
  ClusterArmsView: () => (
    <div data-testid="cluster-arms-view">Cluster Arms</div>
  ),
}));

vi.mock('@web/components/agents/skills/arms/arm-detail-view', () => ({
  ArmDetailView: () => <div data-testid="arm-detail-view">Arm Detail</div>,
}));

vi.mock('@web/components/agents/skills/models/models-view', () => ({
  ModelsView: () => <div data-testid="models-view">Models</div>,
}));

import { getAgents } from '@web/api/v1/super-agents/agents';
import { getSkills } from '@web/api/v1/super-agents/skills';

// Mock localStorage
const mockLocalStorage = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
};

Object.defineProperty(window, 'localStorage', {
  value: mockLocalStorage,
});

const renderWithProviders = async (component: React.ReactElement) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return await act(() => {
    return render(
      <QueryClientProvider client={queryClient}>
        <NavigationProvider>
          <AgentsProvider>
            <SkillsProvider>{component}</SkillsProvider>
          </AgentsProvider>
        </NavigationProvider>
      </QueryClientProvider>,
    );
  });
};

describe('AgentsView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRouterMocks();
    setMockPathname('/agents');
    vi.mocked(getAgents).mockResolvedValue([]);
    vi.mocked(getSkills).mockResolvedValue([]);
    mockLocalStorage.getItem.mockReturnValue(null);
  });

  it('renders agents list view when path is /agents', async () => {
    setMockPathname('/agents');

    await renderWithProviders(<AgentsView />);

    expect(screen.getByTestId('agents-list-view')).toBeInTheDocument();
    expect(screen.getByText('Agents List')).toBeInTheDocument();
  });

  it('renders skills list view when agent is selected', async () => {
    setMockParams({ agentName: 'Test Agent' });
    setMockPathname('/agents/Test%20Agent');

    await renderWithProviders(<AgentsView />);

    expect(screen.getByTestId('agent-view')).toBeInTheDocument();
    expect(screen.getByText('Agent View')).toBeInTheDocument();
  });

  it('renders edit agent view when current view is edit-agent', async () => {
    setMockParams({ agentName: 'Test Agent' });
    setMockPathname('/agents/Test%20Agent/edit');

    await renderWithProviders(<AgentsView />);

    expect(screen.getByTestId('edit-agent-view')).toBeInTheDocument();
    expect(screen.getByText('Edit Agent')).toBeInTheDocument();
  });

  it('renders skill dashboard view when current view is skill-dashboard', async () => {
    setMockParams({ agentName: 'Test Agent', skillName: 'Test Skill' });
    setMockPathname('/agents/Test%20Agent/skills/Test%20Skill');

    // Mock agent and skill data for providers
    vi.mocked(getAgents).mockResolvedValue([
      {
        id: 'test-agent-id',
        name: 'Test Agent',
        description: 'Test Description',
        metadata: {},
        created_at: '2023-01-01T00:00:00Z',
        updated_at: '2023-01-01T00:00:00Z',
        auto_create_skills: true,
        skill_match_threshold: 0.8,
        max_auto_created_skills: 10,
        skill_arbiter_model_id: null,
        skill_arbiter_timeout_ms: null,
        reviewer_agent_id: null,
        review_fail_closed: false,
        review_expose_reason: false,
      },
    ]);
    vi.mocked(getSkills).mockResolvedValue([
      {
        id: 'test-skill-id',
        agent_id: 'test-agent-id',
        name: 'Test Skill',
        description: 'Test Skill Description',
        metadata: {},
        optimize: true,
        configuration_count: 15,
        created_at: '2023-01-01T00:00:00Z',
        updated_at: '2023-01-01T00:00:00Z',
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
      },
    ]);

    await renderWithProviders(<AgentsView />);

    expect(screen.getByTestId('skill-dashboard-view')).toBeInTheDocument();
  });

  it('renders edit skill view when current view is edit-skill', async () => {
    setMockParams({ agentName: 'Test Agent', skillName: 'Test Skill' });
    setMockPathname('/agents/Test%20Agent/skills/Test%20Skill/edit');

    await renderWithProviders(<AgentsView />);

    expect(screen.getByTestId('edit-skill-view')).toBeInTheDocument();
    expect(screen.getByText('Edit Skill')).toBeInTheDocument();
  });

  it('renders log detail view when current view is log-detail', async () => {
    setMockParams({
      agentName: 'Test Agent',
      logId: 'log-123',
    });
    setMockPathname('/agents/Test%20Agent/logs/log-123');

    await renderWithProviders(<AgentsView />);

    expect(screen.getByTestId('log-details-view')).toBeInTheDocument();
  });

  it.skip('renders clusters view when current view is clusters', async () => {
    // Clusters view component not yet implemented
    setMockParams({ agentName: 'Test Agent', skillName: 'Test Skill' });
    setMockPathname('/agents/Test%20Agent/skills/Test%20Skill/clusters');

    // Mock agent and skill data for providers
    vi.mocked(getAgents).mockResolvedValue([
      {
        id: 'test-agent-id',
        name: 'Test Agent',
        description: 'Test Description',
        metadata: {},
        created_at: '2023-01-01T00:00:00Z',
        updated_at: '2023-01-01T00:00:00Z',
        auto_create_skills: true,
        skill_match_threshold: 0.8,
        max_auto_created_skills: 10,
        skill_arbiter_model_id: null,
        skill_arbiter_timeout_ms: null,
        reviewer_agent_id: null,
        review_fail_closed: false,
        review_expose_reason: false,
      },
    ]);
    vi.mocked(getSkills).mockResolvedValue([
      {
        id: 'test-skill-id',
        agent_id: 'test-agent-id',
        name: 'Test Skill',
        description: 'Test Skill Description',
        metadata: {},
        optimize: true,
        configuration_count: 15,
        created_at: '2023-01-01T00:00:00Z',
        updated_at: '2023-01-01T00:00:00Z',
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
      },
    ]);

    await renderWithProviders(<AgentsView />);

    expect(screen.getByTestId('clusters-view')).toBeInTheDocument();
  });

  it('renders cluster arms view when current view is cluster-arms', async () => {
    setMockParams({
      agentName: 'Test Agent',
      skillName: 'Test Skill',
      clusterId: 'cluster-123',
    });
    setMockPathname(
      '/agents/Test%20Agent/skills/Test%20Skill/clusters/cluster-123/configurations',
    );

    // Mock agent and skill data for providers
    vi.mocked(getAgents).mockResolvedValue([
      {
        id: 'test-agent-id',
        name: 'Test Agent',
        description: 'Test Description',
        metadata: {},
        created_at: '2023-01-01T00:00:00Z',
        updated_at: '2023-01-01T00:00:00Z',
        auto_create_skills: true,
        skill_match_threshold: 0.8,
        max_auto_created_skills: 10,
        skill_arbiter_model_id: null,
        skill_arbiter_timeout_ms: null,
        reviewer_agent_id: null,
        review_fail_closed: false,
        review_expose_reason: false,
      },
    ]);
    vi.mocked(getSkills).mockResolvedValue([
      {
        id: 'test-skill-id',
        agent_id: 'test-agent-id',
        name: 'Test Skill',
        description: 'Test Skill Description',
        metadata: {},
        optimize: true,
        configuration_count: 15,
        created_at: '2023-01-01T00:00:00Z',
        updated_at: '2023-01-01T00:00:00Z',
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
      },
    ]);

    await renderWithProviders(<AgentsView />);

    expect(screen.getByTestId('cluster-arms-view')).toBeInTheDocument();
  });

  it('renders arm detail view when current view is arm-detail', async () => {
    setMockParams({
      agentName: 'Test Agent',
      skillName: 'Test Skill',
      clusterId: 'cluster-123',
      armId: 'arm-123',
    });
    setMockPathname(
      '/agents/Test%20Agent/skills/Test%20Skill/clusters/cluster-123/configurations/arm-123',
    );

    // Mock agent and skill data for providers
    vi.mocked(getAgents).mockResolvedValue([
      {
        id: 'test-agent-id',
        name: 'Test Agent',
        description: 'Test Description',
        metadata: {},
        created_at: '2023-01-01T00:00:00Z',
        updated_at: '2023-01-01T00:00:00Z',
        auto_create_skills: true,
        skill_match_threshold: 0.8,
        max_auto_created_skills: 10,
        skill_arbiter_model_id: null,
        skill_arbiter_timeout_ms: null,
        reviewer_agent_id: null,
        review_fail_closed: false,
        review_expose_reason: false,
      },
    ]);
    vi.mocked(getSkills).mockResolvedValue([
      {
        id: 'test-skill-id',
        agent_id: 'test-agent-id',
        name: 'Test Skill',
        description: 'Test Skill Description',
        metadata: {},
        optimize: true,
        configuration_count: 15,
        created_at: '2023-01-01T00:00:00Z',
        updated_at: '2023-01-01T00:00:00Z',
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
      },
    ]);

    await renderWithProviders(<AgentsView />);

    expect(screen.getByTestId('arm-detail-view')).toBeInTheDocument();
  });

  it('renders skills list view for invalid routes as fallback', async () => {
    setMockPathname('/agents/invalid/path/structure');

    await renderWithProviders(<AgentsView />);

    // Invalid routes default to agent-view
    expect(screen.getByTestId('agent-view')).toBeInTheDocument();
  });

  it('has proper layout structure with flex container', async () => {
    setMockPathname('/agents');

    await renderWithProviders(<AgentsView />);

    const container =
      screen.getByTestId('agents-list-view').parentElement?.parentElement;
    expect(container).toHaveClass('flex', 'flex-col', 'h-full');

    const contentWrapper = screen.getByTestId('agents-list-view').parentElement;
    expect(contentWrapper).toHaveClass('flex-1', 'overflow-auto');
  });
});
