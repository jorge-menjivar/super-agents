import type { Agent, Skill } from '@shared/types/data';
import { AgentOptions } from '@shared/types/data';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SkillsView } from '@web/components/agents/skills/skills-view';
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

/**
 * The skills page: an agent's skills as cards, each with the shape of its
 * recent scores, and the window controls that belong to them.
 */

vi.mock('@web/api/v1/super-agents/agents', () => ({
  getAgents: vi.fn(),
  getAgentModels: vi.fn().mockResolvedValue([]),
  getAgentSkillReadiness: vi.fn().mockResolvedValue([]),
}));

vi.mock('@web/api/v1/super-agents/skills', () => ({
  getSkills: vi.fn(),
  getSkillEvaluationScoresByTimeBucket: vi.fn().mockResolvedValue([]),
}));

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

vi.mock('@web/providers/skills', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@web/providers/skills')>();
  return {
    ...actual,
    useSkills: vi.fn(),
  };
});

import { getAgents } from '@web/api/v1/super-agents/agents';
import {
  getSkillEvaluationScoresByTimeBucket,
  getSkills,
} from '@web/api/v1/super-agents/skills';
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

const skill = (id: string, name: string, description: string): Skill =>
  ({
    id,
    name,
    description,
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
  }) as Skill;

const mockSkills: Skill[] = [
  skill('skill-1', 'Email Response', 'Handles email responses'),
  skill('skill-2', 'Chat Support', 'Provides live chat support'),
];

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
    getSkillById: vi.fn(() => undefined),
    refreshSkills: vi.fn(),
    ...overrides,
  }) as unknown as ReturnType<typeof useSkills>;

const renderWithProviders = (component: React.ReactElement) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
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

describe('SkillsView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRouterMocks();
    setMockParams({ agentName: 'Test%20Agent' });
    setMockPathname('/agents/Test%20Agent/skills');
    vi.mocked(getAgents).mockResolvedValue([mockAgent]);
    vi.mocked(getSkills).mockResolvedValue(mockSkills);
    vi.mocked(useSkills).mockReturnValue(createSkillsCtx());
    vi.mocked(getSkillEvaluationScoresByTimeBucket).mockResolvedValue([]);
  });

  it('lists the agent’s skills with their descriptions', async () => {
    renderWithProviders(<SkillsView />);

    await waitFor(() => {
      expect(screen.getByText('Email Response')).toBeInTheDocument();
    });
    expect(screen.getByText('Chat Support')).toBeInTheDocument();
    expect(screen.getByText('Handles email responses')).toBeInTheDocument();
    expect(screen.getByText('Provides live chat support')).toBeInTheDocument();
  });

  it('gives each skill an avatar of its own', async () => {
    renderWithProviders(<SkillsView />);

    await waitFor(() => {
      expect(screen.getByText('Email Response')).toBeInTheDocument();
    });

    const images = screen.getAllByRole('img');
    for (const name of ['Email Response', 'Chat Support']) {
      const avatar = images.find((img) =>
        img.getAttribute('alt')?.includes(name),
      );
      expect(avatar?.getAttribute('src')).toContain('data:image/svg+xml');
    }
  });

  it('marks the skills the gateway created', async () => {
    vi.mocked(useSkills).mockReturnValue(
      createSkillsCtx({
        skills: [{ ...mockSkills[0], auto_created: true }, mockSkills[1]],
      }),
    );

    renderWithProviders(<SkillsView />);

    await waitFor(() => {
      expect(screen.getByText('Email Response')).toBeInTheDocument();
    });
    expect(screen.getAllByText('auto')).toHaveLength(1);
  });

  it('narrows the list by name or description', async () => {
    renderWithProviders(<SkillsView />);

    await waitFor(() => {
      expect(screen.getByText('Email Response')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText('Search skills...'), {
      target: { value: 'chat' },
    });

    await waitFor(() => {
      expect(screen.queryByText('Email Response')).toBeNull();
    });
    expect(screen.getByText('Chat Support')).toBeInTheDocument();
  });

  it('draws one chart per skill, over the chosen window', async () => {
    renderWithProviders(<SkillsView />);

    await waitFor(() => {
      expect(getSkillEvaluationScoresByTimeBucket).toHaveBeenCalledTimes(2);
    });
    // The default is one-hour buckets, thirty of them.
    expect(getSkillEvaluationScoresByTimeBucket).toHaveBeenCalledWith(
      'skill-1',
      expect.objectContaining({ interval_minutes: 60 }),
    );
  });

  it('opens a skill', async () => {
    const { user } = renderWithProviders(<SkillsView />);

    await waitFor(() => {
      expect(screen.getByText('Chat Support')).toBeInTheDocument();
    });
    await user.click(screen.getByText('Chat Support'));

    await waitFor(() => {
      expect(routerMockState.navigate).toHaveBeenCalledWith(
        expect.objectContaining({
          to: '/agents/Test%20Agent/skills/Chat%20Support',
        }),
      );
    });
  });

  describe('without skills', () => {
    beforeEach(() => {
      vi.mocked(useSkills).mockReturnValue(
        createSkillsCtx({ skills: [], isLoading: false }),
      );
    });

    it('explains that skills come from requests', async () => {
      renderWithProviders(<SkillsView />);

      await waitFor(() => {
        expect(screen.getByText(/no skills yet/i)).toBeInTheDocument();
      });
      expect(
        screen.getByText(
          /the first request to this agent makes its first skill/i,
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /create a skill by hand/i }),
      ).toBeInTheDocument();
    });

    it('asks for the first skill when the agent keeps its own', async () => {
      vi.mocked(getAgents).mockResolvedValue([
        { ...mockAgent, auto_create_skills: false },
      ]);

      renderWithProviders(<SkillsView />);

      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: /create your first skill/i }),
        ).toBeInTheDocument();
      });
    });
  });
});
