import type { Agent, Skill } from '@shared/types/data';
import { AgentOptions } from '@shared/types/data';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AgentView } from '@web/components/agents/agent-view';
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

// Mock API functions and providers
vi.mock('@web/api/v1/super-agents/agents', () => ({
  getAgents: vi.fn(),
  getAgentModels: vi.fn().mockResolvedValue([]),
  getAgentSkillReadiness: vi.fn().mockResolvedValue([]),
  getAgentEvaluationScoresByTimeBucket: vi.fn().mockResolvedValue([]),
}));

vi.mock('@web/api/v1/super-agents/skills', () => ({
  getSkills: vi.fn(),
  getSkillEvaluationScoresByTimeBucket: vi.fn().mockResolvedValue([]),
  getSkillClusterStates: vi.fn().mockResolvedValue([]),
  getSkillModels: vi.fn().mockResolvedValue([]),
  getSkillEvaluations: vi.fn().mockResolvedValue([]),
}));

vi.mock('@web/api/v1/super-agents/skill-events', () => ({
  getSkillEvents: vi.fn().mockResolvedValue([]),
}));

vi.mock('@web/providers/skills', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@web/providers/skills')>();
  return {
    ...actual,
    useSkills: vi.fn(),
  };
});

vi.mock('@web/hooks/use-recent-logs', () => ({
  useRecentLogs: () => ({ logs: [], isLoading: false }),
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

import {
  getAgentModels,
  getAgentSkillReadiness,
  getAgents,
} from '@web/api/v1/super-agents/agents';
import { getSkills } from '@web/api/v1/super-agents/skills';
import { useSkills } from '@web/providers/skills';

const mockAgent: Agent = {
  id: 'agent-1',
  name: 'Test Agent',
  description: 'Test Description',
  metadata: {},
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  auto_create_skills: true,
  skill_match_threshold: 0.8,
  max_auto_created_skills: 10,
  system_prompt_reflection_model_id: null,
  evaluation_generation_model_id: null,
  embedding_model_id: null,
  judge_model_id: null,
  skill_arbiter_model_id: null,
  intent_compaction_model_id: null,
  options: AgentOptions.parse({}),
  reviewer_agent_id: null,
  review_fail_closed: false,
  review_expose_reason: false,
};

const mockSkills: Skill[] = [
  {
    id: 'skill-1',
    name: 'Email Response',
    description: 'Handles email responses',
    agent_id: 'agent-1',
    metadata: {},
    optimize: false,
    configuration_count: 10,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
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
    id: 'skill-2',
    name: 'Chat Support',
    description: 'Provides live chat support',
    agent_id: 'agent-1',
    metadata: {},
    optimize: false,
    configuration_count: 10,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
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
};

Object.defineProperty(window, 'localStorage', {
  value: mockLocalStorage,
});

// Helper factories to satisfy provider hook return types
const createSkillsCtx = (
  overrides: Partial<ReturnType<typeof useSkills>> = {},
): ReturnType<typeof useSkills> =>
  ({
    skills: mockSkills,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    queryParams: {},
    setQueryParams: vi.fn(),
    selectedSkill: null,
    setSelectedSkill: vi.fn(),
    createSkill: vi.fn(async () => mockSkills[0]!),
    updateSkill: vi.fn(async () => {
      /* noop */
    }),
    deleteSkill: vi.fn(async () => {
      /* noop */
    }),
    isCreating: false,
    isUpdating: false,
    isDeleting: false,
    createError: null,
    updateError: null,
    deleteError: null,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
    getSkillById: vi.fn(() => undefined),
    refreshSkills: vi.fn(),
    ...overrides,
  }) as unknown as ReturnType<typeof useSkills>;

const renderWithProviders = (component: React.ReactElement) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return {
    user: userEvent.setup(),
    ...render(
      <QueryClientProvider client={queryClient}>
        <NavigationProvider>
          <AgentsProvider>
            <SkillsProvider>{component}</SkillsProvider>
          </AgentsProvider>
        </NavigationProvider>
      </QueryClientProvider>,
    ),
  };
};

describe('AgentView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRouterMocks();
    setMockParams({ agentName: 'Test%20Agent' });
    setMockPathname('/agents/Test%20Agent');
    vi.mocked(getAgents).mockResolvedValue([mockAgent]);
    vi.mocked(getSkills).mockResolvedValue(mockSkills);
    vi.mocked(getAgentSkillReadiness).mockResolvedValue([]);
    vi.mocked(useSkills).mockReturnValue(createSkillsCtx());
    mockLocalStorage.getItem.mockReturnValue(null);
  });

  it('counts the skills and opens the page they live on', async () => {
    const { user } = renderWithProviders(<AgentView />);

    await waitFor(() => {
      expect(screen.getByText('2 skills')).toBeInTheDocument();
    });
    // The cards themselves are a page of their own: fifteen skills under a
    // chart of the same data was fifteen more charts to draw.
    expect(screen.queryByText('Email Response')).toBeNull();

    await user.click(screen.getByRole('button', { name: /view skills/i }));
    expect(routerMockState.navigate).toHaveBeenCalledWith({
      to: '/agents/Test%20Agent/skills',
    });
  });

  it('says how many of them are not ready', async () => {
    vi.mocked(getAgentSkillReadiness).mockResolvedValue([
      {
        skill_id: 'skill-1',
        model_count: 1,
        evaluation_count: 0,
        optimize: false,
      },
      {
        skill_id: 'skill-2',
        model_count: 0,
        evaluation_count: 0,
        optimize: false,
      },
    ]);

    renderWithProviders(<AgentView />);

    await waitFor(() => {
      expect(screen.getByText('2 skills, 1 not ready')).toBeInTheDocument();
    });
  });

  describe('without skills', () => {
    beforeEach(() => {
      vi.mocked(useSkills).mockReturnValue(
        createSkillsCtx({ skills: [], isLoading: false }),
      );
    });

    it('asks for default models first when the agent has none', async () => {
      vi.mocked(getAgentModels).mockResolvedValue([]);

      renderWithProviders(<AgentView />);

      // The verdict waits for the default models to load.
      await waitFor(() => {
        expect(
          screen.getByText('This agent has no default models'),
        ).toBeInTheDocument();
      });
      expect(
        screen.getByRole('button', { name: /add default models/i }),
      ).toBeInTheDocument();
    });

    it('says where the first skill will come from', async () => {
      vi.mocked(getAgentModels).mockResolvedValue([{ id: 'model-1' } as never]);

      renderWithProviders(<AgentView />);

      await waitFor(() => {
        expect(
          screen.getByText(/the first request to this agent makes one/i),
        ).toBeInTheDocument();
      });
      expect(screen.queryByText('This agent has no default models')).toBeNull();
    });

    it('says only that there are none when the agent keeps its skills', async () => {
      vi.mocked(getAgents).mockResolvedValue([
        { ...mockAgent, auto_create_skills: false },
      ]);

      renderWithProviders(<AgentView />);

      await waitFor(() => {
        expect(screen.getByText('None yet')).toBeInTheDocument();
      });
      expect(screen.queryByText('This agent has no default models')).toBeNull();
      expect(getAgentModels).not.toHaveBeenCalled();
    });
  });

  it('points at the missing default models above everything else', async () => {
    vi.mocked(getAgentModels).mockResolvedValue([]);

    renderWithProviders(<AgentView />);

    await waitFor(() => {
      expect(
        screen.getByText('This agent has no default models'),
      ).toBeInTheDocument();
    });
    expect(screen.getByText('2 skills')).toBeInTheDocument();
  });

  it('shows message when no agent is selected', async () => {
    setMockParams({ agentName: undefined });

    renderWithProviders(<AgentView />);

    await waitFor(() => {
      expect(screen.getAllByText(/select an agent/i).length).toBeGreaterThan(0);
    });
  });

  it('shows create skill button', async () => {
    renderWithProviders(<AgentView />);

    await waitFor(() => {
      expect(screen.getByText(/create skill/i)).toBeInTheDocument();
    });
  });

  it('shows more options button', async () => {
    renderWithProviders(<AgentView />);

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /more options/i }),
      ).toBeInTheDocument();
    });
  });

  it('navigates to edit agent page when edit agent menu item is clicked', async () => {
    const { user } = renderWithProviders(<AgentView />);

    await waitFor(() => {
      const moreOptionsButton = screen.getByRole('button', {
        name: /more options/i,
      });
      expect(moreOptionsButton).toBeInTheDocument();
    });

    // Open the dropdown menu
    const moreOptionsButton = screen.getByRole('button', {
      name: /more options/i,
    });
    await user.click(moreOptionsButton);

    // Click the edit menu item
    await waitFor(() => {
      const editMenuItem = screen.getByRole('menuitem', {
        name: /edit agent/i,
      });
      expect(editMenuItem).toBeInTheDocument();
    });

    const editMenuItem = screen.getByRole('menuitem', { name: /edit agent/i });
    await user.click(editMenuItem);

    // Check that navigate was called with correct path
    // Component uses direct path navigation with encodeURIComponent
    await waitFor(() => {
      expect(routerMockState.navigate).toHaveBeenCalledWith({
        to: '/agents/Test%20Agent/edit',
      });
    });
  });

  it('does not show more options button when no agent is selected', async () => {
    setMockParams({ agentName: undefined });

    renderWithProviders(<AgentView />);

    await waitFor(() => {
      expect(
        screen.queryByRole('button', { name: /more options/i }),
      ).not.toBeInTheDocument();
    });
  });

  it('offers the default models dialog from the agent menu', async () => {
    const { user } = renderWithProviders(<AgentView />);

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /more options/i }),
      ).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /more options/i }));

    await waitFor(() => {
      expect(
        screen.getByRole('menuitem', { name: /default models/i }),
      ).toBeInTheDocument();
    });
  });
});
