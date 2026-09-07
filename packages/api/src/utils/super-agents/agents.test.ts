import { createMockContext } from '@api/test-utils/mock-context';
import type { UserDataStorageConnector } from '@api/types/connector';
import { getAgent } from '@api/utils/super-agents/agents';
import type { Agent } from '@shared/types/data/agent';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockContext = createMockContext();

describe('getAgent', () => {
  let mockConnector: UserDataStorageConnector;

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

      // System prompt methods
      getSystemPrompts: vi.fn(),
      createSystemPrompt: vi.fn(),
      updateSystemPrompt: vi.fn(),
      deleteSystemPrompt: vi.fn(),

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

      // Log methods (required by interface)
      getLogs: vi.fn(),
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
      getModelById: vi.fn(),
      createModel: vi.fn(),
      updateModel: vi.fn(),
      deleteModel: vi.fn(),
      // Skill-Model relationship methods
      getSkillModels: vi.fn(),
      getSkillsByModelId: vi.fn(),
      addModelsToSkill: vi.fn(),
      removeModelsFromSkill: vi.fn(),
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

  describe('when agent exists', () => {
    it('should return existing agent', async () => {
      const existingAgent: Agent = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        name: 'existing-agent',
        description: 'Existing agent description',
        metadata: { version: '1.0' },
        created_at: '2023-01-01T00:00:00.000Z',
        updated_at: '2023-01-01T00:00:00.000Z',
        auto_create_skills: true,
        skill_match_threshold: 0.8,
        max_auto_created_skills: 10,
        skill_arbiter_model_id: null,
        skill_arbiter_timeout_ms: null,
        reviewer_agent_id: null,
        review_fail_closed: false,
        review_expose_reason: false,
      };

      vi.mocked(mockConnector.getAgents).mockResolvedValue([existingAgent]);

      const result = await getAgent(
        mockContext,
        mockConnector,
        'existing-agent',
      );

      expect(result).toEqual(existingAgent);
      expect(mockConnector.getAgents).toHaveBeenCalledWith(mockContext, {
        name: 'existing-agent',
      });
      expect(mockConnector.createAgent).not.toHaveBeenCalled();
    });

    it('should return first agent when multiple exist with same name', async () => {
      const agents: Agent[] = [
        {
          id: '123e4567-e89b-12d3-a456-426614174000',
          name: 'duplicate-agent',
          description: 'First agent',
          metadata: { version: '1.0' },
          created_at: '2023-01-01T00:00:00.000Z',
          updated_at: '2023-01-01T00:00:00.000Z',
          auto_create_skills: true,
          skill_match_threshold: 0.8,
          max_auto_created_skills: 10,
          skill_arbiter_model_id: null,
          skill_arbiter_timeout_ms: null,
          reviewer_agent_id: null,
          review_fail_closed: false,
          review_expose_reason: false,
        },
        {
          id: '223e4567-e89b-12d3-a456-426614174000',
          name: 'duplicate-agent',
          description: 'Second agent',
          metadata: { version: '2.0' },
          created_at: '2023-01-02T00:00:00.000Z',
          updated_at: '2023-01-02T00:00:00.000Z',
          auto_create_skills: true,
          skill_match_threshold: 0.8,
          max_auto_created_skills: 10,
          skill_arbiter_model_id: null,
          skill_arbiter_timeout_ms: null,
          reviewer_agent_id: null,
          review_fail_closed: false,
          review_expose_reason: false,
        },
      ];

      vi.mocked(mockConnector.getAgents).mockResolvedValue(agents);

      const result = await getAgent(
        mockContext,
        mockConnector,
        'duplicate-agent',
      );

      expect(result).toEqual(agents[0]);
      expect(mockConnector.createAgent).not.toHaveBeenCalled();
    });
  });

  describe('when agent does not exist', () => {
    it('should auto-create agent when not found for super-agents', async () => {
      const newAgent: Agent = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        name: 'super-agents',
        description: 'The Super Agents internal agent',
        metadata: {},
        created_at: '2023-01-01T00:00:00.000Z',
        updated_at: '2023-01-01T00:00:00.000Z',
        auto_create_skills: true,
        skill_match_threshold: 0.8,
        max_auto_created_skills: 10,
        skill_arbiter_model_id: null,
        skill_arbiter_timeout_ms: null,
        reviewer_agent_id: null,
        review_fail_closed: false,
        review_expose_reason: false,
      };

      vi.mocked(mockConnector.getAgents).mockResolvedValue([]);
      vi.mocked(mockConnector.createAgent).mockResolvedValue(newAgent);

      const result = await getAgent(mockContext, mockConnector, 'super-agents');

      expect(result).toEqual(newAgent);
      expect(mockConnector.getAgents).toHaveBeenCalledWith(mockContext, {
        name: 'super-agents',
      });
      expect(mockConnector.createAgent).toHaveBeenCalledWith(mockContext, {
        name: 'super-agents',
        description: 'The Super Agents internal agent',
        metadata: {},
        auto_create_skills: false,
        skill_match_threshold: 0.8,
        max_auto_created_skills: 0,
        review_fail_closed: false,
        review_expose_reason: false,
      });
    });

    it('should reject invalid agent names (too short)', async () => {
      await expect(getAgent(mockContext, mockConnector, '')).rejects.toThrow();
      await expect(
        getAgent(mockContext, mockConnector, 'ab'),
      ).rejects.toThrow();
    });
  });

  describe('error handling', () => {
    it('should propagate errors from getAgents', async () => {
      const error = new Error('Database connection failed');
      vi.mocked(mockConnector.getAgents).mockRejectedValue(error);

      await expect(
        getAgent(mockContext, mockConnector, 'test-agent'),
      ).rejects.toThrow('Database connection failed');
    });
  });

  describe('edge cases', () => {
    it('should handle hyphens and underscores in agent name', async () => {
      const specialName = 'agent-with-underscores_123';
      const agent: Agent = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        name: specialName,
        description: 'Agent with hyphens and underscores',
        metadata: {},
        created_at: '2023-01-01T00:00:00.000Z',
        updated_at: '2023-01-01T00:00:00.000Z',
        auto_create_skills: true,
        skill_match_threshold: 0.8,
        max_auto_created_skills: 10,
        skill_arbiter_model_id: null,
        skill_arbiter_timeout_ms: null,
        reviewer_agent_id: null,
        review_fail_closed: false,
        review_expose_reason: false,
      };

      vi.mocked(mockConnector.getAgents).mockResolvedValue([agent]);

      const result = await getAgent(mockContext, mockConnector, specialName);

      expect(result).toEqual(agent);
      expect(mockConnector.getAgents).toHaveBeenCalledWith(mockContext, {
        name: specialName,
      });
    });

    it('should reject names with invalid characters', async () => {
      await expect(
        getAgent(mockContext, mockConnector, 'agent@domain.com'),
      ).rejects.toThrow();
      await expect(
        getAgent(mockContext, mockConnector, 'Agent With Spaces'),
      ).rejects.toThrow();
      await expect(
        getAgent(mockContext, mockConnector, 'AgentWithCaps'),
      ).rejects.toThrow();
    });

    it('should reject agent names that are too long (>100 chars)', async () => {
      const longName = 'a'.repeat(101);

      await expect(
        getAgent(mockContext, mockConnector, longName),
      ).rejects.toThrow();
    });

    it('should accept maximum length agent names (100 chars)', async () => {
      const maxLengthName = 'a'.repeat(100);
      const agent: Agent = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        name: maxLengthName,
        description: 'Agent with max length name',
        metadata: {},
        created_at: '2023-01-01T00:00:00.000Z',
        updated_at: '2023-01-01T00:00:00.000Z',
        auto_create_skills: true,
        skill_match_threshold: 0.8,
        max_auto_created_skills: 10,
        skill_arbiter_model_id: null,
        skill_arbiter_timeout_ms: null,
        reviewer_agent_id: null,
        review_fail_closed: false,
        review_expose_reason: false,
      };

      vi.mocked(mockConnector.getAgents).mockResolvedValue([agent]);

      const result = await getAgent(mockContext, mockConnector, maxLengthName);

      expect(result).toEqual(agent);
      expect(mockConnector.getAgents).toHaveBeenCalledWith(mockContext, {
        name: maxLengthName,
      });
    });
  });

  describe('concurrent access', () => {
    it('should handle concurrent calls for same agent name', async () => {
      const agentName = 'concurrent-agent';
      const existingAgent: Agent = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        name: agentName,
        description: 'Concurrent agent',
        metadata: {},
        created_at: '2023-01-01T00:00:00.000Z',
        updated_at: '2023-01-01T00:00:00.000Z',
        auto_create_skills: true,
        skill_match_threshold: 0.8,
        max_auto_created_skills: 10,
        skill_arbiter_model_id: null,
        skill_arbiter_timeout_ms: null,
        reviewer_agent_id: null,
        review_fail_closed: false,
        review_expose_reason: false,
      };

      vi.mocked(mockConnector.getAgents).mockResolvedValue([existingAgent]);

      const [result1, result2] = await Promise.all([
        getAgent(mockContext, mockConnector, agentName),
        getAgent(mockContext, mockConnector, agentName),
      ]);

      expect(result1).toEqual(existingAgent);
      expect(result2).toEqual(existingAgent);
      expect(mockConnector.getAgents).toHaveBeenCalledTimes(2);
      expect(mockConnector.createAgent).not.toHaveBeenCalled();
    });
  });
});
