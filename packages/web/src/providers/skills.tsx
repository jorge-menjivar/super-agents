'use client';

import type {
  Skill,
  SkillCreateParams,
  SkillQueryParams,
  SkillSummary,
  SkillUpdateParams,
} from '@shared/types/data/skill';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  createSkill,
  deleteSkill,
  getSkillSummaries,
  getSkills,
  updateSkill,
} from '@web/api/v1/super-agents/skills';
import { useToast } from '@web/hooks/use-toast';
import { useAgents } from '@web/providers/agents';
import { useNavigation } from '@web/providers/navigation';
import type React from 'react';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';

// Query keys for React Query caching
export const skillQueryKeys = {
  all: ['skills'] as const,
  lists: () => [...skillQueryKeys.all, 'list'] as const,
  list: (params: SkillQueryParams) =>
    [...skillQueryKeys.lists(), params] as const,
  details: () => [...skillQueryKeys.all, 'detail'] as const,
  detail: (id: string) => [...skillQueryKeys.details(), id] as const,
};

interface SkillsContextType {
  /**
   * Every skill of the agent, without the system prompts the gateway seeded
   * them from -- nothing that reads this list draws them, and they are almost
   * all of what it would weigh.
   */
  skills: SkillSummary[];
  /** The one skill a page is about, read whole. */
  selectedSkill?: Skill;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;

  // Query parameters
  queryParams: SkillQueryParams;
  setQueryParams: (params: SkillQueryParams) => void;

  // Skill mutation functions
  createSkill: (params: SkillCreateParams) => Promise<Skill>;
  updateSkill: (skillId: string, params: SkillUpdateParams) => Promise<void>;
  deleteSkill: (skillId: string) => Promise<void>;

  // Skill mutation states
  isCreating: boolean;
  isUpdating: boolean;
  isDeleting: boolean;
  createError: Error | null;
  updateError: Error | null;
  deleteError: Error | null;

  // Pagination
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;

  // Helper functions
  getSkillById: (id: string) => SkillSummary | undefined;
  refreshSkills: () => void;
}

const SkillsContext = createContext<SkillsContextType | undefined>(undefined);

export const SkillsProvider = ({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { navigationState } = useNavigation();
  const { selectedAgent } = useAgents();

  const [queryParams, setQueryParams] = useState<SkillQueryParams>({});

  // Skills infinite query for pagination
  const {
    data,
    isLoading,
    error,
    refetch,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useInfiniteQuery({
    queryKey: skillQueryKeys.list(queryParams),
    queryFn: ({ pageParam = 0 }) =>
      getSkillSummaries({
        ...queryParams,
        limit: queryParams.limit || 20,
        offset: pageParam,
      }),
    getNextPageParam: (lastPage, allPages) => {
      const currentLength = allPages.flat().length;
      if (lastPage.length < (queryParams.limit || 20)) {
        return undefined;
      }
      return currentLength;
    },
    initialPageParam: 0,
  });

  // Flatten pages into single array
  const skills: SkillSummary[] = data?.pages?.flat() ?? [];

  // Fetch individual skill by name when URL has a selected skill
  const { data: selectedSkillData } = useQuery({
    queryKey: [
      'skill',
      'by-name',
      navigationState.selectedSkillName,
      selectedAgent?.id,
    ],
    queryFn: async () => {
      if (!selectedAgent?.id) return undefined;
      const results = await getSkills({
        name: navigationState.selectedSkillName,
        agent_id: selectedAgent.id,
        limit: 1,
      });
      return results.length > 0 ? results[0] : undefined;
    },
    enabled: !!navigationState.selectedSkillName && !!selectedAgent?.id,
    staleTime: 0, // Refetch immediately when invalidated
  });

  // Resolve selectedSkill from navigationState.selectedSkillName
  const selectedSkill = useMemo(() => {
    if (!navigationState.selectedSkillName) return undefined;
    return selectedSkillData;
  }, [navigationState.selectedSkillName, selectedSkillData]);

  // Create skill mutation
  const createSkillMutation = useMutation({
    mutationFn: (params: SkillCreateParams) => createSkill(params),
    onSuccess: (newSkill) => {
      // Invalidate all lists to ensure consistency
      queryClient.invalidateQueries({ queryKey: skillQueryKeys.lists() });

      toast({
        title: 'Skill created',
        description: `${newSkill.name} has been created successfully.`,
      });
    },
    onError: (error) => {
      console.error('Error creating skill:', error);
      toast({
        title: 'Error creating skill',
        description: 'Please try again later',
        variant: 'destructive',
      });
    },
  });

  // Update skill mutation
  const updateSkillMutation = useMutation({
    mutationFn: ({
      skillId,
      params,
    }: {
      skillId: string;
      params: SkillUpdateParams;
    }) => updateSkill(skillId, params),
    onSuccess: (updatedSkill: Skill) => {
      // Invalidate all skill queries to ensure UI reflects changes
      queryClient.invalidateQueries({ queryKey: skillQueryKeys.all });

      toast({
        title: 'Skill updated',
        description: `${updatedSkill.name} has been updated successfully.`,
      });
    },
    onError: (error) => {
      console.error('Error updating skill:', error);
      toast({
        title: 'Error updating skill',
        description: 'Please try again later',
        variant: 'destructive',
      });
    },
  });

  // Delete skill mutation
  const deleteSkillMutation = useMutation({
    mutationFn: (skillId: string) => deleteSkill(skillId),
    onSuccess: () => {
      // Invalidate lists to ensure consistency
      queryClient.invalidateQueries({ queryKey: skillQueryKeys.lists() });

      toast({
        title: 'Skill deleted',
        description: 'Skill has been deleted successfully.',
      });
    },
    onError: (error) => {
      console.error('Error deleting skill:', error);
      toast({
        title: 'Error deleting skill',
        description: 'Please try again later',
        variant: 'destructive',
      });
    },
  });

  // Helper functions
  const getSkillById = useCallback(
    (id: string): SkillSummary | undefined => {
      return skills?.find((skill) => skill.id === id);
    },
    [skills],
  );

  const refreshSkills = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: skillQueryKeys.all });
  }, [queryClient]);

  // Simplified mutation functions
  const createSkillHandler = useCallback(
    (params: SkillCreateParams): Promise<Skill> => {
      return createSkillMutation.mutateAsync(params);
    },
    [createSkillMutation],
  );

  const updateSkillHandler = useCallback(
    async (skillId: string, params: SkillUpdateParams): Promise<void> => {
      await updateSkillMutation.mutateAsync({ skillId, params });
    },
    [updateSkillMutation],
  );

  const deleteSkillHandler = useCallback(
    async (skillId: string): Promise<void> => {
      await deleteSkillMutation.mutateAsync(skillId);
    },
    [deleteSkillMutation],
  );

  const contextValue: SkillsContextType = {
    // Query state
    skills,
    selectedSkill,
    isLoading,
    error,
    refetch,

    // Query parameters
    queryParams,
    setQueryParams,

    // Skill mutation functions
    createSkill: createSkillHandler,
    updateSkill: updateSkillHandler,
    deleteSkill: deleteSkillHandler,

    // Skill mutation states
    isCreating: createSkillMutation.isPending,
    isUpdating: updateSkillMutation.isPending,
    isDeleting: deleteSkillMutation.isPending,
    createError: createSkillMutation.error,
    updateError: updateSkillMutation.error,
    deleteError: deleteSkillMutation.error,

    // Pagination
    hasNextPage: hasNextPage ?? false,
    isFetchingNextPage,
    fetchNextPage,

    // Helper functions
    getSkillById,
    refreshSkills,
  };

  return (
    <SkillsContext.Provider value={contextValue}>
      {children}
    </SkillsContext.Provider>
  );
};

export const useSkills = (): SkillsContextType => {
  const context = useContext(SkillsContext);
  if (!context) {
    throw new Error('useSkills must be used within a SkillsProvider');
  }
  return context;
};
