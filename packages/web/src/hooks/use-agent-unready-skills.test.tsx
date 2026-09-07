import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { useAgentUnreadySkills } from '@web/hooks/use-agent-unready-skills';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the API functions
const mockGetSkills = vi.fn();
const mockGetSkillModels = vi.fn();
const mockGetSkillEvaluations = vi.fn();

vi.mock('@web/api/v1/super-agents/skills', () => ({
  getSkills: (...args: unknown[]) => mockGetSkills(...args),
  getSkillModels: (...args: unknown[]) => mockGetSkillModels(...args),
  getSkillEvaluations: (...args: unknown[]) => mockGetSkillEvaluations(...args),
}));

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
    skill_arbiter_model_id: null,
    skill_arbiter_timeout_ms: null,
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
    // Create a promise that never resolves to simulate loading state
    mockGetSkills.mockReturnValue(
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

    const { result } = renderHook(() => useAgentUnreadySkills(mockAgent), {
      wrapper,
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.hasUnreadySkills).toBe(false);
    expect(result.current.unreadySkillsCount).toBe(0);
  });

  it('should return false when all skills are ready (have models)', async () => {
    const mockSkills = [
      {
        id: 'skill-1',
        name: 'Skill 1',
        agent_id: 'agent-123',
        optimize: false,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      },
      {
        id: 'skill-2',
        name: 'Skill 2',
        agent_id: 'agent-123',
        optimize: false,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      },
    ];

    mockGetSkills.mockResolvedValue(mockSkills);
    mockGetSkillModels.mockResolvedValue([
      { id: 'model-1', model_name: 'gpt-4' },
    ]);
    mockGetSkillEvaluations.mockResolvedValue([]);

    const { result } = renderHook(() => useAgentUnreadySkills(mockAgent), {
      wrapper,
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.hasUnreadySkills).toBe(false);
    expect(result.current.unreadySkillsCount).toBe(0);
  });

  it('should return true when some skills are missing models', async () => {
    const mockSkills = [
      {
        id: 'skill-1',
        name: 'Skill 1',
        agent_id: 'agent-123',
        optimize: false,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      },
      {
        id: 'skill-2',
        name: 'Skill 2',
        agent_id: 'agent-123',
        optimize: false,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      },
    ];

    mockGetSkills.mockResolvedValue(mockSkills);
    // First skill has models, second doesn't
    mockGetSkillModels
      .mockResolvedValueOnce([{ id: 'model-1', model_name: 'gpt-4' }])
      .mockResolvedValueOnce([]);
    mockGetSkillEvaluations.mockResolvedValue([]);

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
    const mockSkills = [
      {
        id: 'skill-1',
        name: 'Skill 1',
        agent_id: 'agent-123',
        optimize: true,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      },
    ];

    mockGetSkills.mockResolvedValue(mockSkills);
    mockGetSkillModels.mockResolvedValue([
      { id: 'model-1', model_name: 'gpt-4' },
    ]);
    mockGetSkillEvaluations.mockResolvedValue([]); // No evaluations

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
    const mockSkills = [
      {
        id: 'skill-1',
        name: 'Skill 1',
        agent_id: 'agent-123',
        optimize: true,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      },
    ];

    mockGetSkills.mockResolvedValue(mockSkills);
    mockGetSkillModels.mockResolvedValue([
      { id: 'model-1', model_name: 'gpt-4' },
    ]);
    mockGetSkillEvaluations.mockResolvedValue([
      { id: 'eval-1', evaluation_method: 'TASK_COMPLETION' },
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

  it('should count multiple unready skills correctly', async () => {
    const mockSkills = [
      {
        id: 'skill-1',
        name: 'Skill 1',
        agent_id: 'agent-123',
        optimize: false,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      },
      {
        id: 'skill-2',
        name: 'Skill 2',
        agent_id: 'agent-123',
        optimize: false,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      },
      {
        id: 'skill-3',
        name: 'Skill 3',
        agent_id: 'agent-123',
        optimize: true,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      },
    ];

    mockGetSkills.mockResolvedValue(mockSkills);
    // All skills missing models
    mockGetSkillModels.mockResolvedValue([]);
    mockGetSkillEvaluations.mockResolvedValue([]);

    const { result } = renderHook(() => useAgentUnreadySkills(mockAgent), {
      wrapper,
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.hasUnreadySkills).toBe(true);
    expect(result.current.unreadySkillsCount).toBe(3);
  });
});
