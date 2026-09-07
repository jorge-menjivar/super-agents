import type { Agent, Skill } from '@shared/types/data';
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

vi.mock('@web/providers/logs', () => ({
  useLogs: vi.fn(),
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

import { getAgentModels, getAgents } from '@web/api/v1/super-agents/agents';
import { getSkills } from '@web/api/v1/super-agents/skills';
import { useLogs } from '@web/providers/logs';
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
  skill_arbiter_model_id: null,
  skill_arbiter_timeout_ms: null,
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

const createLogsCtx = (
  overrides: Partial<ReturnType<typeof useLogs>> = {},
): ReturnType<typeof useLogs> =>
  ({
    logs: [],
    selectedLog: undefined,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    agentId: null,
    setAgentId: vi.fn(),
    skillId: null,
    setSkillId: vi.fn(),
    agentWide: false,
    setAgentWide: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
    getLogById: vi.fn(),
    refreshLogs: vi.fn(),
    ...overrides,
  }) as unknown as ReturnType<typeof useLogs>;

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

describe('SkillsListView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRouterMocks();
    setMockParams({ agentName: 'Test%20Agent' });
    setMockPathname('/agents/Test%20Agent');
    vi.mocked(getAgents).mockResolvedValue([mockAgent]);
    vi.mocked(getSkills).mockResolvedValue(mockSkills);
    vi.mocked(useSkills).mockReturnValue(createSkillsCtx());
    vi.mocked(useLogs).mockReturnValue(createLogsCtx());
    mockLocalStorage.getItem.mockReturnValue(null);
  });

  it('renders skills list when agent is selected', async () => {
    renderWithProviders(<AgentView />);

    await waitFor(() => {
      expect(screen.getByText('Email Response')).toBeInTheDocument();
      expect(screen.getByText('Chat Support')).toBeInTheDocument();
    });
  });

  it('shows loading state', async () => {
    vi.mocked(useSkills).mockReturnValue(
      createSkillsCtx({ skills: [], isLoading: true }),
    );

    renderWithProviders(<AgentView />);

    // Loading state shows skeleton cards
    await waitFor(() => {
      const skeletons = document.querySelectorAll('[data-slot="skeleton"]');
      expect(skeletons.length).toBeGreaterThan(0);
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
      expect(screen.getByText(/no skills yet/i)).toBeInTheDocument();
      // Once in the callout at the top, once in the empty state.
      expect(
        screen.getAllByRole('button', { name: /add default models/i }),
      ).toHaveLength(2);
      expect(
        screen.getByRole('button', { name: /create a skill by hand/i }),
      ).toBeInTheDocument();
      expect(screen.queryByText(/create your first skill/i)).toBeNull();
    });

    it('explains that skills come from requests when the agent has default models', async () => {
      vi.mocked(getAgentModels).mockResolvedValue([{ id: 'model-1' } as never]);

      renderWithProviders(<AgentView />);

      await waitFor(() => {
        expect(screen.getByText(/no skills yet/i)).toBeInTheDocument();
      });
      await waitFor(() => {
        expect(
          screen.getByText(
            /the first request to this agent makes its first skill/i,
          ),
        ).toBeInTheDocument();
      });
      expect(screen.queryByText('This agent has no default models')).toBeNull();
      expect(
        screen.queryByRole('button', { name: /add default models/i }),
      ).toBeNull();
    });

    it('asks for a skill when the agent keeps its skills', async () => {
      vi.mocked(getAgents).mockResolvedValue([
        { ...mockAgent, auto_create_skills: false },
      ]);

      renderWithProviders(<AgentView />);

      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: /create your first skill/i }),
        ).toBeInTheDocument();
      });
      expect(screen.queryByText('This agent has no default models')).toBeNull();
      expect(getAgentModels).not.toHaveBeenCalled();
    });
  });

  it('points at the missing default models above the skills', async () => {
    vi.mocked(getAgentModels).mockResolvedValue([]);

    renderWithProviders(<AgentView />);

    await waitFor(() => {
      expect(
        screen.getByText('This agent has no default models'),
      ).toBeInTheDocument();
    });
    expect(screen.getByText('Email Response')).toBeInTheDocument();
  });

  it('shows message when no agent is selected', async () => {
    setMockParams({ agentName: undefined });

    renderWithProviders(<AgentView />);

    await waitFor(() => {
      expect(screen.getAllByText(/select an agent/i).length).toBeGreaterThan(0);
    });
  });

  it('displays skill descriptions', async () => {
    renderWithProviders(<AgentView />);

    await waitFor(() => {
      expect(screen.getByText('Handles email responses')).toBeInTheDocument();
      expect(
        screen.getByText('Provides live chat support'),
      ).toBeInTheDocument();
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

  it('displays DiceBear avatar for each skill', async () => {
    renderWithProviders(<AgentView />);

    await waitFor(() => {
      // Should find images for each skill
      const images = screen.getAllByRole('img');

      // Find skill avatars (excluding agent avatar in header)
      const emailSkillAvatar = images.find((img) =>
        img.getAttribute('alt')?.includes('Email Response'),
      );
      const chatSkillAvatar = images.find((img) =>
        img.getAttribute('alt')?.includes('Chat Support'),
      );

      expect(emailSkillAvatar).toBeTruthy();
      expect(chatSkillAvatar).toBeTruthy();

      // Avatars should have SVG data (URL-encoded or base64)
      expect(emailSkillAvatar?.getAttribute('src')).toContain(
        'data:image/svg+xml',
      );
      expect(chatSkillAvatar?.getAttribute('src')).toContain(
        'data:image/svg+xml',
      );
    });
  });

  it('marks the skills the gateway created', async () => {
    vi.mocked(useSkills).mockReturnValue(
      createSkillsCtx({
        skills: [{ ...mockSkills[0], auto_created: true }, mockSkills[1]],
      }),
    );

    renderWithProviders(<AgentView />);

    await waitFor(() => {
      expect(screen.getByText('Email Response')).toBeInTheDocument();
    });
    expect(screen.getAllByText('auto')).toHaveLength(1);
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
