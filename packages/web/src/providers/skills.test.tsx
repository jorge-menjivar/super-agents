import type { Skill } from '@shared/types/data/skill';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { SkillsProvider, useSkills } from '@web/providers/skills';
import type React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the navigation provider
vi.mock('@web/providers/navigation', () => ({
  useNavigation: vi.fn(() => ({
    navigationState: {
      section: 'agents',
      selectedAgentName: null,
      selectedSkillName: null,
    },
  })),
  NavigationProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// Mock the agents provider
vi.mock('@web/providers/agents', () => ({
  useAgents: vi.fn(() => ({
    selectedAgent: null,
  })),
  AgentsProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// Mock the API module
vi.mock('@web/api/v1/super-agents/skills', () => ({
  getSkills: vi.fn(),
  getSkillSummaries: vi.fn(),
  createSkill: vi.fn(),
  updateSkill: vi.fn(),
  deleteSkill: vi.fn(),
}));

import { getSkillSummaries } from '@web/api/v1/super-agents/skills';

const mockSkills: Skill[] = [
  {
    id: '1',
    agent_id: 'agent-1',
    name: 'Skill 1',
    description: 'Test skill 1',
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
    id: '2',
    agent_id: 'agent-2',
    name: 'Skill 2',
    description: 'Test skill 2',
    metadata: {},
    optimize: false,
    configuration_count: 10,
    created_at: '2024-01-02T00:00:00Z',
    updated_at: '2024-01-02T00:00:00Z',
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

describe('SkillsProvider', () => {
  let queryClient: QueryClient;

  const setupPaginationMock = () => {
    const firstPage = [mockSkills[0]];
    const secondPage = [mockSkills[1]];

    let callCount = 0;
    vi.mocked(getSkillSummaries).mockImplementation((params) => {
      callCount++;
      if (callCount === 1) {
        expect(params).toEqual({ limit: 20, offset: 0 });
        return Promise.resolve(mockSkills);
      } else if (callCount === 2) {
        expect(params).toEqual({ limit: 1, offset: 0 });
        return Promise.resolve(firstPage);
      } else if (callCount === 3) {
        expect(params).toEqual({ limit: 1, offset: 1 });
        return Promise.resolve(secondPage);
      }
      return Promise.resolve([]);
    });

    return { firstPage, secondPage };
  };

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          gcTime: 0,
          staleTime: 0,
        },
      },
    });
    vi.clearAllMocks();
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <SkillsProvider>{children}</SkillsProvider>
    </QueryClientProvider>
  );

  it('should fetch skills', async () => {
    vi.mocked(getSkillSummaries).mockResolvedValue(mockSkills);

    const { result } = renderHook(() => useSkills(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.skills).toEqual(mockSkills);
    expect(getSkillSummaries).toHaveBeenCalledWith({
      limit: 20,
      offset: 0,
    });
  });

  it('should fetch with custom limit', async () => {
    const firstPage = [mockSkills[0]];
    vi.mocked(getSkillSummaries).mockResolvedValue(firstPage);

    const { result } = renderHook(() => useSkills(), { wrapper });

    // Set custom limit
    act(() => {
      result.current.setQueryParams({ limit: 1 });
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.skills).toEqual(firstPage);
    expect(result.current.hasNextPage).toBe(true);
    expect(getSkillSummaries).toHaveBeenCalledWith({
      limit: 1,
      offset: 0,
    });
  });

  it('should fetch next page', async () => {
    const { firstPage } = setupPaginationMock();

    const { result } = renderHook(() => useSkills(), { wrapper });

    // Wait for initial load
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Set query params to trigger new query
    act(() => {
      result.current.setQueryParams({ limit: 1 });
    });

    // Wait for the query with new params to complete
    await waitFor(() => {
      expect(result.current.skills).toEqual(firstPage);
    });

    // Fetch next page
    act(() => {
      result.current.fetchNextPage();
    });

    await waitFor(() => {
      expect(result.current.isFetchingNextPage).toBe(false);
      expect(result.current.skills).toEqual(mockSkills);
    });

    expect(getSkillSummaries).toHaveBeenCalledTimes(3);
  });

  it('should handle pagination with no more pages', async () => {
    const lastPage: Skill[] = [];
    vi.mocked(getSkillSummaries).mockResolvedValue(lastPage);

    const { result } = renderHook(() => useSkills(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.skills).toEqual([]);
    expect(result.current.hasNextPage).toBe(false);
  });

  it('should filter skills by agent_id', async () => {
    const filteredSkills = [mockSkills[0]];
    vi.mocked(getSkillSummaries).mockResolvedValue(filteredSkills);

    const { result } = renderHook(() => useSkills(), { wrapper });

    // Set query params to filter by agent_id
    act(() => {
      result.current.setQueryParams({ agent_id: 'agent-1' });
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.skills).toEqual(filteredSkills);
    expect(getSkillSummaries).toHaveBeenCalledWith({
      agent_id: 'agent-1',
      limit: 20,
      offset: 0,
    });
  });

  it('should filter skills by name', async () => {
    const filteredSkills = [mockSkills[0]];
    vi.mocked(getSkillSummaries).mockResolvedValue(filteredSkills);

    const { result } = renderHook(() => useSkills(), { wrapper });

    // Set query params to filter by name
    act(() => {
      result.current.setQueryParams({ name: 'Skill 1' });
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.skills).toEqual(filteredSkills);
    expect(getSkillSummaries).toHaveBeenCalledWith({
      name: 'Skill 1',
      limit: 20,
      offset: 0,
    });
  });

  it('should get skill by id', async () => {
    vi.mocked(getSkillSummaries).mockResolvedValue(mockSkills);

    const { result } = renderHook(() => useSkills(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    const skill = result.current.getSkillById('1');
    expect(skill).toEqual(mockSkills[0]);

    const nonExistentSkill = result.current.getSkillById('999');
    expect(nonExistentSkill).toBeUndefined();
  });

  it('should throw error when used outside provider', () => {
    expect(() => {
      renderHook(() => useSkills());
    }).toThrow('useSkills must be used within a SkillsProvider');
  });
});
