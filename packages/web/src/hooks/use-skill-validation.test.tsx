import type { Skill } from '@shared/types/data';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@web/api/v1/super-agents/agents', () => ({
  getAgentSkillReadiness: vi.fn(),
}));

// Import after mocking
import { getAgentSkillReadiness } from '@web/api/v1/super-agents/agents';
import { useSkillValidation } from '@web/hooks/use-skill-validation';

const mockGetAgentSkillReadiness = vi.mocked(getAgentSkillReadiness);

/** The agent's answer, as the readiness endpoint gives it. */
const readiness = (
  skillId: string,
  models: number,
  evaluations: number,
  optimize = false,
) => [
  {
    skill_id: skillId,
    model_count: models,
    evaluation_count: evaluations,
    optimize,
  },
];

describe('useSkillValidation', () => {
  let queryClient: QueryClient;

  const createWrapper = () => {
    return ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };

  const createMockSkill = (overrides: Partial<Skill> = {}): Skill =>
    ({
      id: 'skill-123',
      agent_id: 'agent-123',
      name: 'Test Skill',
      description: 'A test skill',
      metadata: {},
      optimize: false,
      configuration_count: 0,
      auto_created: false,
      seed_system_prompt: null,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
      clustering_interval: 0,
      reflection_min_requests_per_arm: 0,
      exploration_temperature: 1,
      last_clustering_at: null,
      last_clustering_log_start_time: null,
      evaluations_regenerated_at: null,
      evaluation_lock_acquired_at: null,
      total_requests: 0,
      allowed_template_variables: [],
      ...overrides,
    }) as Skill;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
    vi.clearAllMocks();
  });

  it('returns loading state initially', () => {
    mockGetAgentSkillReadiness.mockImplementation(
      () =>
        new Promise(() => {
          // Never resolves - simulates loading state
        }),
    );

    const { result } = renderHook(() => useSkillValidation(createMockSkill()), {
      wrapper: createWrapper(),
    });

    expect(result.current.isLoading).toBe(true);
  });

  it('returns ready state when skill has models (no optimization)', async () => {
    mockGetAgentSkillReadiness.mockResolvedValue(readiness('skill-123', 1, 0));

    const { result } = renderHook(
      () => useSkillValidation(createMockSkill({ optimize: false })),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.isReady).toBe(true);
    expect(result.current.modelsCount).toBe(1);
    expect(result.current.evaluationsCount).toBe(0);
    expect(result.current.missingRequirements).toEqual([]);
  });

  it('returns not ready when skill has no models', async () => {
    mockGetAgentSkillReadiness.mockResolvedValue(readiness('skill-123', 0, 0));

    const { result } = renderHook(() => useSkillValidation(createMockSkill()), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.isReady).toBe(false);
    expect(result.current.modelsCount).toBe(0);
    expect(result.current.missingRequirements).toContain(
      'At least one model must be configured',
    );
  });

  it('requires evaluations when optimization is enabled', async () => {
    mockGetAgentSkillReadiness.mockResolvedValue(readiness('skill-123', 1, 0));

    const { result } = renderHook(
      () => useSkillValidation(createMockSkill({ optimize: true })),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.isReady).toBe(false);
    expect(result.current.missingRequirements).toContain(
      'At least one evaluation must be configured',
    );
  });

  it('returns ready when optimization is enabled with models and evaluations', async () => {
    mockGetAgentSkillReadiness.mockResolvedValue(readiness('skill-123', 1, 1));

    const { result } = renderHook(
      () => useSkillValidation(createMockSkill({ optimize: true })),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.isReady).toBe(true);
    expect(result.current.modelsCount).toBe(1);
    expect(result.current.evaluationsCount).toBe(1);
    expect(result.current.missingRequirements).toEqual([]);
  });

  it('handles null skill', () => {
    const { result } = renderHook(() => useSkillValidation(null), {
      wrapper: createWrapper(),
    });

    expect(mockGetAgentSkillReadiness).not.toHaveBeenCalled();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isReady).toBe(false);
    expect(result.current.modelsCount).toBe(0);
    expect(result.current.evaluationsCount).toBe(0);
  });

  it('handles undefined skill', () => {
    const { result } = renderHook(() => useSkillValidation(undefined), {
      wrapper: createWrapper(),
    });

    expect(mockGetAgentSkillReadiness).not.toHaveBeenCalled();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isReady).toBe(false);
  });

  it('asks the skill’s agent once, not the skill', async () => {
    mockGetAgentSkillReadiness.mockResolvedValue(readiness('skill-xyz', 0, 0));

    renderHook(() => useSkillValidation(createMockSkill({ id: 'skill-xyz' })), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(mockGetAgentSkillReadiness).toHaveBeenCalledWith('agent-123');
    });
    expect(mockGetAgentSkillReadiness).toHaveBeenCalledTimes(1);
  });

  it('shows multiple missing requirements when both are missing', async () => {
    mockGetAgentSkillReadiness.mockResolvedValue(readiness('skill-123', 0, 0));

    const { result } = renderHook(
      () => useSkillValidation(createMockSkill({ optimize: true })),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.isReady).toBe(false);
    expect(result.current.missingRequirements).toHaveLength(2);
    expect(result.current.missingRequirements).toContain(
      'At least one model must be configured',
    );
    expect(result.current.missingRequirements).toContain(
      'At least one evaluation must be configured',
    );
  });

  it('counts multiple models and evaluations correctly', async () => {
    mockGetAgentSkillReadiness.mockResolvedValue(readiness('skill-123', 3, 2));

    const { result } = renderHook(
      () => useSkillValidation(createMockSkill({ optimize: true })),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.modelsCount).toBe(3);
    expect(result.current.evaluationsCount).toBe(2);
    expect(result.current.isReady).toBe(true);
  });

  it('reads as not ready for a skill the answer does not name', async () => {
    // A skill created since the agent was last asked: nothing is known about
    // it, and "nothing" is what not ready looks like.
    mockGetAgentSkillReadiness.mockResolvedValue(
      readiness('other-skill', 1, 1),
    );

    const { result } = renderHook(() => useSkillValidation(createMockSkill()), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.isReady).toBe(false);
    expect(result.current.modelsCount).toBe(0);
  });

  it('does not require evaluations when optimization is disabled', async () => {
    mockGetAgentSkillReadiness.mockResolvedValue(readiness('skill-123', 1, 0));

    const { result } = renderHook(
      () => useSkillValidation(createMockSkill({ optimize: false })),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.isReady).toBe(true);
    expect(result.current.missingRequirements).not.toContain(
      'At least one evaluation must be configured',
    );
  });
});
