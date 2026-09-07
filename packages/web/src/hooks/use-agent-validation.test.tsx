import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { useAgentValidation } from '@web/hooks/use-agent-validation';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetSkills = vi.fn();
const mockGetAgentModels = vi.fn();

vi.mock('@web/api/v1/super-agents/skills', () => ({
  getSkills: (...args: unknown[]) => mockGetSkills(...args),
}));
vi.mock('@web/api/v1/super-agents/agents', () => ({
  getAgentModels: (...args: unknown[]) => mockGetAgentModels(...args),
}));

describe('useAgentValidation', () => {
  let queryClient: QueryClient;

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  const agent = (auto_create_skills: boolean) =>
    ({
      id: 'agent-1',
      name: 'helper',
      description: 'Helps with things.',
      metadata: {},
      auto_create_skills,
      skill_match_threshold: 0.8,
      max_auto_created_skills: 10,
      skill_arbiter_model_id: null,
      skill_arbiter_timeout_ms: null,
      reviewer_agent_id: null,
      review_fail_closed: false,
      review_expose_reason: false,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    }) as const;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    vi.clearAllMocks();
  });

  it('is ready once an agent that keeps its skills has one', async () => {
    mockGetSkills.mockResolvedValue([{ id: 'skill-1' }]);

    const { result } = renderHook(() => useAgentValidation(agent(false)), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isReady).toBe(true);
    expect(result.current.skillsCount).toBe(1);
    expect(result.current.missingRequirements).toEqual([]);
  });

  it('asks for default models even when the agent has skills', async () => {
    mockGetSkills.mockResolvedValue([{ id: 'skill-1' }]);
    mockGetAgentModels.mockResolvedValue([]);

    const { result } = renderHook(() => useAgentValidation(agent(true)), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isReady).toBe(false);
    expect(result.current.missingRequirements[0]).toMatch(
      /^Add default models/,
    );
  });

  it('is ready without skills when the gateway can create them', async () => {
    mockGetSkills.mockResolvedValue([]);
    mockGetAgentModels.mockResolvedValue([{ id: 'model-1' }]);

    const { result } = renderHook(() => useAgentValidation(agent(true)), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isReady).toBe(true);
    expect(result.current.defaultModelsCount).toBe(1);
  });

  it('asks for default models when there is nothing to create skills with', async () => {
    mockGetSkills.mockResolvedValue([]);
    mockGetAgentModels.mockResolvedValue([]);

    const { result } = renderHook(() => useAgentValidation(agent(true)), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isReady).toBe(false);
    expect(result.current.missingRequirements[0]).toContain('default models');
  });

  it('does not look at default models for an agent that keeps its skills', async () => {
    mockGetSkills.mockResolvedValue([]);

    const { result } = renderHook(() => useAgentValidation(agent(false)), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isReady).toBe(false);
    expect(result.current.missingRequirements).toEqual([
      'At least one skill must be configured',
    ]);
    expect(mockGetAgentModels).not.toHaveBeenCalled();
  });
});
