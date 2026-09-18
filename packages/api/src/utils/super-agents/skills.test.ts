import { createMockContext } from '@api/test-utils/mock-context';
import type { UserDataStorageConnector } from '@api/types/connector';
import { getSkill } from '@api/utils/super-agents/skills';
import type { Skill } from '@shared/types/data/skill';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockContext = createMockContext();

describe('getSkill', () => {
  let mockConnector: UserDataStorageConnector;
  const testAgentId = '550e8400-e29b-41d4-a716-446655440000';
  const testAgentName = 'test-agent';

  beforeEach(() => {
    vi.clearAllMocks();

    // Create a mock connector with all required methods
    mockConnector = {
      // Agent methods
      getAgents: vi.fn(),
      createAgent: vi.fn(),
      updateAgent: vi.fn(),
      deleteAgent: vi.fn(),

      // Skill methods
      getSkills: vi.fn(),
      createSkill: vi.fn(),
      updateSkill: vi.fn(),
      deleteSkill: vi.fn(),
      incrementSkillTotalRequests: vi.fn(),
      tryAcquireReclusteringLock: vi.fn(),

      // Feedback methods
      getFeedback: vi.fn(),
      createFeedback: vi.fn(),
      deleteFeedback: vi.fn(),

      // Improved response methods
      getImprovedResponse: vi.fn(),
      createImprovedResponse: vi.fn(),
      updateImprovedResponse: vi.fn(),
      deleteImprovedResponse: vi.fn(),

      // Tool methods
      getTools: vi.fn(),
      createTool: vi.fn(),
      deleteTool: vi.fn(),

      // Dataset methods
      getDatasets: vi.fn(),
      createDataset: vi.fn(),
      updateDataset: vi.fn(),
      deleteDataset: vi.fn(),

      // Evaluation runs
      // Log methods (required by interface)
      getLogs: vi.fn(),
      getLogSummaries: vi.fn(),
      deleteLog: vi.fn(),
      // Dataset-Log Bridge methods (required by interface)
      getDatasetLogs: vi.fn(),
      addLogsToDataset: vi.fn(),
      removeLogsFromDataset: vi.fn(),
      // Evaluation run methods
      getEvaluationRuns: vi.fn(),
      createEvaluationRun: vi.fn(),
      updateEvaluationRun: vi.fn(),
      deleteEvaluationRun: vi.fn(),
      // Log Output methods (required by interface)
      getLogOutputs: vi.fn(),
      createLogOutput: vi.fn(),
      deleteLogOutput: vi.fn(),
      // AI Provider API Key methods
      getAIProviderAPIKeys: vi.fn(),
      getAIProviderAPIKeyById: vi.fn(),
      createAIProvider: vi.fn(),
      updateAIProvider: vi.fn(),
      deleteAIProvider: vi.fn(),
      // Model methods
      getModels: vi.fn(),
      createModel: vi.fn(),
      updateModel: vi.fn(),
      deleteModel: vi.fn(),
      // Skill-Model relationship methods
      getSkillModels: vi.fn(),
          getSkillsByModelId: vi.fn(),
      addModelsToSkill: vi.fn(),
      removeModelsFromSkill: vi.fn(),
      // Skill Optimization Cluster methods
      getSkillOptimizationClusters: vi.fn(),
      createSkillOptimizationClusters: vi.fn(),
      updateSkillOptimizationCluster: vi.fn(),
      deleteSkillOptimizationCluster: vi.fn(),
      getSkillRoutings: vi.fn(),
      getAgentModels: vi.fn(),
      addModelsToAgent: vi.fn(),
      removeModelsFromAgent: vi.fn(),
      upsertSkillRouting: vi.fn(),
      claimSkillCreationLease: vi.fn(),
      releaseSkillCreationLease: vi.fn(),
      incrementClusterCounters: vi.fn(),
      // Skill Optimization Arm methods
      getSkillOptimizationArms: vi.fn(),
      getSkillOptimizationArmStats: vi.fn(),
      deleteSkillOptimizationArmStats: vi.fn(),
      createSkillOptimizationArms: vi.fn(),
      updateSkillOptimizationArm: vi.fn(),
      updateArmAndIncrementCounters: vi.fn(),
      deleteSkillOptimizationArm: vi.fn(),
      deleteSkillOptimizationArmsForSkill: vi.fn(),
      deleteSkillOptimizationArmsForCluster: vi.fn(),
      // Skill Optimization Evaluation methods
      getSkillOptimizationEvaluations: vi.fn(),
      createSkillOptimizationEvaluations: vi.fn(),
      deleteSkillOptimizationEvaluation: vi.fn(),
      updateSkillOptimizationEvaluation: vi.fn(),
      deleteSkillOptimizationEvaluationsForSkill: vi.fn(),
      // Skill Optimization Evaluation Run methods
      getSkillOptimizationEvaluationRuns: vi.fn(),
      getEvaluationScoresByTimeBucket: vi.fn(),
      createSkillOptimizationEvaluationRun: vi.fn(),
      deleteSkillOptimizationEvaluationRun: vi.fn(),
      getSkillEvents: vi.fn(),
      createSkillEvent: vi.fn(),
      // System Settings methods
      getSystemSettings: vi.fn(),
      updateSystemSettings: vi.fn(),
    } as UserDataStorageConnector;
  });

  describe('when skill exists', () => {
    it('should return existing skill', async () => {
      const existingSkill: Skill = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        agent_id: testAgentId,
        name: 'existing-skill',
        description: 'Existing skill description',
        metadata: {},
        configuration_count: 5,
        created_at: '2023-01-01T00:00:00.000Z',
        updated_at: '2023-01-01T00:00:00.000Z',
        optimize: false,
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
      };

      vi.mocked(mockConnector.getSkills).mockResolvedValue([existingSkill]);

      const result = await getSkill(
        mockContext,
        mockConnector,
        testAgentId,
        testAgentName,
        'existing-skill',
      );

      expect(result).toEqual(existingSkill);
      expect(mockConnector.getSkills).toHaveBeenCalledWith(mockContext, {
        name: 'existing-skill',
        agent_id: testAgentId,
      });
      expect(mockConnector.createSkill).not.toHaveBeenCalled();
    });

    it('should return first skill when multiple exist with same name', async () => {
      const skills: Skill[] = [
        {
          id: '123e4567-e89b-12d3-a456-426614174000',
          agent_id: testAgentId,
          name: 'duplicate-skill',
          description: 'First skill',
          metadata: {},
          configuration_count: 5,
          created_at: '2023-01-01T00:00:00.000Z',
          updated_at: '2023-01-01T00:00:00.000Z',
          optimize: false,
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
          id: '223e4567-e89b-12d3-a456-426614174000',
          agent_id: testAgentId,
          name: 'duplicate-skill',
          description: 'Second skill',
          metadata: {},
          configuration_count: 5,
          created_at: '2023-01-02T00:00:00.000Z',
          updated_at: '2023-01-02T00:00:00.000Z',
          optimize: false,
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

      vi.mocked(mockConnector.getSkills).mockResolvedValue(skills);

      const result = await getSkill(
        mockContext,
        mockConnector,
        testAgentId,
        testAgentName,
        'duplicate-skill',
      );

      expect(result).toEqual(skills[0]);
      expect(mockConnector.createSkill).not.toHaveBeenCalled();
    });
  });

  describe('when skill does not exist', () => {
    it('should return null', async () => {
      vi.mocked(mockConnector.getSkills).mockResolvedValue([]);

      const result = await getSkill(
        mockContext,
        mockConnector,
        testAgentId,
        testAgentName,
        'new-skill',
      );

      expect(result).toBeNull();
      expect(mockConnector.getSkills).toHaveBeenCalledWith(mockContext, {
        name: 'new-skill',
        agent_id: testAgentId,
      });
      expect(mockConnector.createSkill).not.toHaveBeenCalled();
    });

    it('should return null for empty skill name', async () => {
      vi.mocked(mockConnector.getSkills).mockResolvedValue([]);

      const result = await getSkill(
        mockContext,
        mockConnector,
        testAgentId,
        testAgentName,
        '',
      );

      expect(result).toBeNull();
      expect(mockConnector.getSkills).toHaveBeenCalledWith(mockContext, {
        name: '',
        agent_id: testAgentId,
      });
      expect(mockConnector.createSkill).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should propagate errors from getSkills', async () => {
      const error = new Error('Database connection failed');
      vi.mocked(mockConnector.getSkills).mockRejectedValue(error);

      await expect(
        getSkill(
          mockContext,
          mockConnector,
          testAgentId,
          testAgentName,
          'test-skill',
        ),
      ).rejects.toThrow('Database connection failed');
    });
  });

  describe('edge cases', () => {
    it('should handle special characters in skill name', async () => {
      const specialName = 'skill-with-special-chars_123@domain.com';
      const skill: Skill = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        agent_id: testAgentId,
        name: specialName,
        description: 'Special characters skill description',
        metadata: {},
        configuration_count: 5,
        created_at: '2023-01-01T00:00:00.000Z',
        updated_at: '2023-01-01T00:00:00.000Z',
        optimize: false,
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
      };

      vi.mocked(mockConnector.getSkills).mockResolvedValue([skill]);

      const result = await getSkill(
        mockContext,
        mockConnector,
        testAgentId,
        testAgentName,
        specialName,
      );

      expect(result).toEqual(skill);
      expect(mockConnector.getSkills).toHaveBeenCalledWith(mockContext, {
        name: specialName,
        agent_id: testAgentId,
      });
    });

    it('should handle very long skill names', async () => {
      const longName = 'a'.repeat(1000);

      vi.mocked(mockConnector.getSkills).mockResolvedValue([]);

      const result = await getSkill(
        mockContext,
        mockConnector,
        testAgentId,
        testAgentName,
        longName,
      );

      expect(result).toBeNull();
      expect(mockConnector.getSkills).toHaveBeenCalledWith(mockContext, {
        name: longName,
        agent_id: testAgentId,
      });
    });
  });

  describe('concurrent access', () => {
    it('should handle concurrent calls for same skill name', async () => {
      const skillName = 'concurrent-skill';
      const existingSkill: Skill = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        agent_id: testAgentId,
        name: skillName,
        description: 'Concurrent skill description',
        metadata: {},
        configuration_count: 5,
        created_at: '2023-01-01T00:00:00.000Z',
        updated_at: '2023-01-01T00:00:00.000Z',
        optimize: false,
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
      };

      vi.mocked(mockConnector.getSkills).mockResolvedValue([existingSkill]);

      const [result1, result2] = await Promise.all([
        getSkill(
          mockContext,
          mockConnector,
          testAgentId,
          testAgentName,
          skillName,
        ),
        getSkill(
          mockContext,
          mockConnector,
          testAgentId,
          testAgentName,
          skillName,
        ),
      ]);

      expect(result1).toEqual(existingSkill);
      expect(result2).toEqual(existingSkill);
      expect(mockConnector.getSkills).toHaveBeenCalledTimes(2);
      expect(mockConnector.createSkill).not.toHaveBeenCalled();
    });
  });
});
