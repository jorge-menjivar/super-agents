import { AgentOptions } from '@shared/types/data';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { useAgentUnreadySkills } from '@web/hooks/use-agent-unready-skills';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetSkills = vi.fn();
const mockGetAgentSkillReadiness = vi.fn();

vi.mock('@web/api/v1/super-agents/skills', () => ({
  getSkills: (...args: unknown[]) => mockGetSkills(...args),
}));

vi.mock('@web/api/v1/super-agents/agents', () => ({
  getAgentSkillReadiness: (...args: unknown[]) =>
    mockGetAgentSkillReadiness(...args),
}));

const skill = (id: string, optimize: boolean) => ({
  id,
  name: id,
  agent_id: 'agent-123',
  optimize,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
});

const counts = (
  skillId: string,
  models: number,
  evaluations: number,
  optimize = false,
) => ({
  skill_id: skillId,
  model_count: models,
  evaluation_count: evaluations,
  optimize,
});

describe('useAgentUnreadySkills', () => {
  let queryClient: QueryClient;

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  const mockAgent = {
    id: 'agent-123',
    name: 'Test Agent',
    description: 'Test description',
    metadata: {},
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
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  };

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
    vi.clearAllMocks();
  });

  it('should return loading state initially', () => {
    mockGetSkills.mockReturnValue(
      new Promise(() => {
        /* Never resolves */
      }),
    );
    mockGetAgentSkillReadiness.mockReturnValue(
      new Promise(() => {
        /* Never resolves */
      }),
    );

    const { result } = renderHook(() => useAgentUnreadySkills(mockAgent), {
      wrapper,
    });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.hasUnreadySkills).toBe(false);
    expect(result.current.unreadySkillsCount).toBe(0);
  });

  it('should return false when agent has no skills', async () => {
    mockGetSkills.mockResolvedValue([]);
    mockGetAgentSkillReadiness.mockResolvedValue([]);

    const { result } = renderHook(() => useAgentUnreadySkills(mockAgent), {
      wrapper,
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.hasUnreadySkills).toBe(false);
    expect(result.current.unreadySkillsCount).toBe(0);
  });

  it('asks once for the whole agent, not once per skill', async () => {
    mockGetSkills.mockResolvedValue([
      skill('skill-1', false),
      skill('skill-2', false),
    ]);
    mockGetAgentSkillReadiness.mockResolvedValue([
      counts('skill-1', 1, 0),
      counts('skill-2', 1, 0),
    ]);

    const { result } = renderHook(() => useAgentUnreadySkills(mockAgent), {
      wrapper,
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(mockGetAgentSkillReadiness).toHaveBeenCalledTimes(1);
    expect(mockGetAgentSkillReadiness).toHaveBeenCalledWith('agent-123');
    expect(result.current.hasUnreadySkills).toBe(false);
  });

  it('should return true when some skills are missing models', async () => {
    mockGetSkills.mockResolvedValue([
      skill('skill-1', false),
      skill('skill-2', false),
    ]);
    mockGetAgentSkillReadiness.mockResolvedValue([
      counts('skill-1', 1, 0),
      counts('skill-2', 0, 0),
    ]);

    const { result } = renderHook(() => useAgentUnreadySkills(mockAgent), {
      wrapper,
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.hasUnreadySkills).toBe(true);
    expect(result.current.unreadySkillsCount).toBe(1);
  });

  it('should return true when optimization is enabled but evaluations are missing', async () => {
    mockGetSkills.mockResolvedValue([skill('skill-1', true)]);
    mockGetAgentSkillReadiness.mockResolvedValue([
      counts('skill-1', 1, 0, true),
    ]);

    const { result } = renderHook(() => useAgentUnreadySkills(mockAgent), {
      wrapper,
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.hasUnreadySkills).toBe(true);
    expect(result.current.unreadySkillsCount).toBe(1);
  });

  it('should return false when optimization is enabled and evaluations exist', async () => {
    mockGetSkills.mockResolvedValue([skill('skill-1', true)]);
    mockGetAgentSkillReadiness.mockResolvedValue([
      counts('skill-1', 1, 1, true),
    ]);

    const { result } = renderHook(() => useAgentUnreadySkills(mockAgent), {
      wrapper,
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.hasUnreadySkills).toBe(false);
    expect(result.current.unreadySkillsCount).toBe(0);
  });

  it('counts nothing for a skill the readiness answer does not name', async () => {
    // A skill created between the two reads: not ready is a claim about what
    // it has, and nothing here says anything about it yet.
    mockGetSkills.mockResolvedValue([
      skill('skill-1', false),
      skill('skill-2', false),
    ]);
    mockGetAgentSkillReadiness.mockResolvedValue([counts('skill-1', 1, 0)]);

    const { result } = renderHook(() => useAgentUnreadySkills(mockAgent), {
      wrapper,
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.unreadySkillsCount).toBe(0);
  });

  it('should handle null agent gracefully', () => {
    const { result } = renderHook(() => useAgentUnreadySkills(null), {
      wrapper,
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.hasUnreadySkills).toBe(false);
    expect(result.current.unreadySkillsCount).toBe(0);
  });

  it('should handle undefined agent gracefully', () => {
    const { result } = renderHook(() => useAgentUnreadySkills(undefined), {
      wrapper,
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.hasUnreadySkills).toBe(false);
    expect(result.current.unreadySkillsCount).toBe(0);
  });
});
