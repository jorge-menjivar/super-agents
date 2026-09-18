import { BaseArmsParams } from '@api/optimization/base-arms';
import { generateSeedSystemPromptForSkill } from '@api/optimization/utils/system-prompt';
import type { AppEnv } from '@api/types/hono';
import { skillsRouter } from '@api/v1/super-agents/skills';
import { SystemSettingsOptions } from '@shared/types/data/system-settings';
import { Hono } from 'hono';
import { testClient } from 'hono/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the system prompt generation to avoid OpenAI API calls
vi.mock('@api/optimization/utils/system-prompt', () => ({
  generateSystemPromptForSkill: vi
    .fn()
    .mockResolvedValue('Generated system prompt'),
  generateSeedSystemPromptForSkill: vi
    .fn()
    .mockResolvedValue('Generated seed system prompt'),
  generateSeedSystemPromptWithContext: vi
    .fn()
    .mockResolvedValue('Generated seed system prompt'),
}));

// Create a mock UserDataStorageConnector with all required methods
const mockUserDataStorageConnector = {
  // Feedback methods
  getFeedback: vi.fn(),
  createFeedback: vi.fn(),
  deleteFeedback: vi.fn(),
  // Improved response methods
  getImprovedResponse: vi.fn(),
  createImprovedResponse: vi.fn(),
  updateImprovedResponse: vi.fn(),
  deleteImprovedResponse: vi.fn(),
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
  getModelById: vi.fn(),
  createModel: vi.fn(),
  updateModel: vi.fn(),
  deleteModel: vi.fn(),
  // Skill-Model relationship methods
  getSkillModels: vi.fn(),
  getSkillsByModelId: vi.fn(),
  addModelsToSkill: vi.fn(),
  removeModelsFromSkill: vi.fn(),
  // System Settings methods
  getSystemSettings: vi.fn(),
  updateSystemSettings: vi.fn(),
};

// Create a test app with the middleware that injects the mock connector
const app = new Hono<AppEnv>()
  .use('*', async (c, next) => {
    c.set('user_data_storage_connector', mockUserDataStorageConnector);
    await next();
  })
  .route('/', skillsRouter);

describe('Skills API Status Codes', () => {
  const client = testClient(app);

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock getSystemSettings to return empty (no embedding model configured)
    // This allows skills to be created without embedding model
    mockUserDataStorageConnector.getSystemSettings.mockResolvedValue({
      embedding_model_id: null,
      judge_model_id: null,
      system_prompt_reflection_model_id: null,
      evaluation_generation_model_id: null,
      skill_arbiter_model_id: null,
      intent_compaction_model_id: null,
      options: SystemSettingsOptions.parse({
        intent_compaction: { timeout_ms: 15_000 },
      }),
    });
  });

  describe('POST /', () => {
    it('should return 201 on successful creation', async () => {
      const mockSkill = {
        id: 'c13d1678-150a-466b-804f-ecc82de3680e',
        agent_id: 'c13d1678-150a-466b-804f-ecc82de3680e',
        name: 'test-skill',
        description:
          'This is a test skill description with at least 25 characters',
        metadata: { test: true },
        max_configurations: 10,
        num_system_prompts: 5,
        created_at: '2023-01-01T00:00:00.000Z',
        updated_at: '2023-01-01T00:00:00.000Z',
      };
      mockUserDataStorageConnector.createSkill.mockResolvedValue(mockSkill);
      mockUserDataStorageConnector.createSkillOptimizationClusters.mockResolvedValue(
        [],
      );

      const res = await client.index.$post({
        json: {
          agent_id: 'c13d1678-150a-466b-804f-ecc82de3680e',
          name: 'test-skill',
          description:
            'This is a test skill description with at least 25 characters',
          metadata: {},
          optimize: false,
        },
      });

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data).toEqual(mockSkill);
    });

    it('should return 500 on creation error', async () => {
      mockUserDataStorageConnector.createSkill.mockRejectedValue(
        new Error('Creation failed'),
      );

      const res = await client.index.$post({
        json: {
          agent_id: 'c13d1678-150a-466b-804f-ecc82de3680e',
          name: 'test-skill',
          description:
            'This is a test skill description with at least 25 characters',
          metadata: {},
          optimize: false,
        },
      });

      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data).toEqual({
        error: 'An unexpected database error occurred. Please try again.',
      });
    });

    it('should return 400 for invalid input', async () => {
      const res = await client.index.$post({
        // @ts-expect-error - Intentionally invalid input for testing
        json: {
          // Missing required agent_id field
          name: 'test-skill',
        },
      });

      expect(res.status).toBe(400);
      expect(mockUserDataStorageConnector.createSkill).not.toHaveBeenCalled();
    });
  });

  describe('GET /', () => {
    it('should return 200 on successful fetch', async () => {
      const mockSkills = [
        {
          id: 'c13d1678-150a-466b-804f-ecc82de3680e',
          agent_id: 'c13d1678-150a-466b-804f-ecc82de3680e',
          name: 'test-skill',
          description:
            'This is a test skill description with at least 25 characters',
          metadata: { test: true },
          max_configurations: 10,
          num_system_prompts: 5,
          created_at: '2023-01-01T00:00:00.000Z',
          updated_at: '2023-01-01T00:00:00.000Z',
        },
      ];
      mockUserDataStorageConnector.getSkills.mockResolvedValue(mockSkills);

      const res = await client.index.$get({
        query: {
          agent_id: 'c13d1678-150a-466b-804f-ecc82de3680e',
          limit: '10',
          offset: '0',
        },
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual(mockSkills);
    });

    it('should return 500 on error', async () => {
      mockUserDataStorageConnector.getSkills.mockRejectedValue(
        new Error('DB error'),
      );

      const res = await client.index.$get({
        query: {},
      });

      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data).toEqual({
        error: 'An unexpected database error occurred. Please try again.',
      });
    });
  });

  describe('PATCH /:skillId', () => {
    it('should return 200 on successful update', async () => {
      const mockSkill = {
        id: 'c13d1678-150a-466b-804f-ecc82de3680e',
        agent_id: 'c13d1678-150a-466b-804f-ecc82de3680e',
        name: 'test-skill',
        description:
          'This is an updated skill description with at least 25 characters',
        metadata: { test: true },
        max_configurations: 10,
        num_system_prompts: 5,
        created_at: '2023-01-01T00:00:00.000Z',
        updated_at: '2023-01-02T00:00:00.000Z',
      };
      const mockCluster = {
        id: 'cluster-1',
        agent_id: 'c13d1678-150a-466b-804f-ecc82de3680e',
        skill_id: 'c13d1678-150a-466b-804f-ecc82de3680e',
        name: 'Cluster 1',
        total_steps: 0,
        observability_total_requests: 0,
        allowed_template_variables: ['datetime'],
        centroid: [0.5],
        created_at: '2023-01-01T00:00:00.000Z',
        updated_at: '2023-01-01T00:00:00.000Z',
      };
      const mockModel = {
        id: 'model-1',
        ai_provider: 'anthropic',
        name: 'claude-3-sonnet',
        created_at: '2023-01-01T00:00:00.000Z',
        updated_at: '2023-01-01T00:00:00.000Z',
      };

      // Mocks for updateSkill operation
      mockUserDataStorageConnector.updateSkill.mockResolvedValue(mockSkill);

      // Mocks for handleGenerateArms operation (called when description is updated)
      mockUserDataStorageConnector.getSkills.mockResolvedValue([mockSkill]);
      mockUserDataStorageConnector.deleteSkillOptimizationArmsForSkill.mockResolvedValue(
        undefined,
      );
      mockUserDataStorageConnector.getSkillOptimizationClusters.mockResolvedValue(
        [mockCluster],
      );
      mockUserDataStorageConnector.updateSkillOptimizationCluster.mockResolvedValue(
        mockCluster,
      );
      mockUserDataStorageConnector.getSkillModels.mockResolvedValue([
        mockModel,
      ]);
      mockUserDataStorageConnector.createSkillOptimizationArms.mockResolvedValue(
        [],
      );

      const res = await client[':skillId'].$patch({
        param: { skillId: 'c13d1678-150a-466b-804f-ecc82de3680e' },
        json: {
          description:
            'This is an updated skill description with at least 25 characters',
        },
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual(mockSkill);
    });

    it('should return 500 on update error', async () => {
      mockUserDataStorageConnector.updateSkill.mockRejectedValue(
        new Error('Update failed'),
      );

      const res = await client[':skillId'].$patch({
        param: { skillId: 'c13d1678-150a-466b-804f-ecc82de3680e' },
        json: {
          description:
            'This is an updated skill description with at least 25 characters',
        },
      });

      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data).toEqual({
        error: 'An unexpected database error occurred. Please try again.',
      });
    });

    it('should return 400 for invalid UUID', async () => {
      const res = await client[':skillId'].$patch({
        param: { skillId: 'invalid-uuid' },
        json: {
          description:
            'This is an updated skill description with at least 25 characters',
        },
      });

      expect(res.status).toBe(400);
      expect(mockUserDataStorageConnector.updateSkill).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /:skillId', () => {
    it('should return 204 on successful deletion', async () => {
      mockUserDataStorageConnector.deleteSkill.mockResolvedValue(undefined);

      const res = await client[':skillId'].$delete({
        param: { skillId: 'c13d1678-150a-466b-804f-ecc82de3680e' },
      });

      expect(res.status).toBe(204);
      expect(await res.text()).toBe('');
    });

    it('should return 500 on deletion error', async () => {
      mockUserDataStorageConnector.deleteSkill.mockRejectedValue(
        new Error('Delete failed'),
      );

      const res = await client[':skillId'].$delete({
        param: { skillId: 'c13d1678-150a-466b-804f-ecc82de3680e' },
      });

      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data).toEqual({
        error: 'An unexpected database error occurred. Please try again.',
      });
    });

    it('should return 400 for invalid UUID', async () => {
      const res = await client[':skillId'].$delete({
        param: { skillId: 'invalid-uuid' },
      });

      expect(res.status).toBe(400);
      expect(mockUserDataStorageConnector.deleteSkill).not.toHaveBeenCalled();
    });
  });

  describe('POST /:skillId/models - Arm Generation', () => {
    const skillId = 'c13d1678-150a-466b-804f-ecc82de3680e';
    const agentId = 'a13d1678-150a-466b-804f-ecc82de3680e';
    const model1Id = '11111111-1111-4111-8111-111111111111';
    const model2Id = '22222222-2222-4222-8222-222222222222';
    const cluster1Id = '33333333-3333-4333-8333-333333333333';
    const cluster2Id = '44444444-4444-4444-8444-444444444444';

    const mockSkill = {
      id: skillId,
      agent_id: agentId,
      name: 'test-skill',
      description: 'Test skill description with enough characters',
      metadata: {},
      configuration_count: 2,
      optimize: true,
      created_at: '2023-01-01T00:00:00.000Z',
      updated_at: '2023-01-01T00:00:00.000Z',
    };

    const mockClusters = [
      {
        id: cluster1Id,
        agent_id: agentId,
        skill_id: skillId,
        name: '1',
        total_steps: 0,
        observability_total_requests: 0,
        centroid: [0.5],
        created_at: '2023-01-01T00:00:00.000Z',
        updated_at: '2023-01-01T00:00:00.000Z',
      },
      {
        id: cluster2Id,
        agent_id: agentId,
        skill_id: skillId,
        name: '2',
        total_steps: 0,
        observability_total_requests: 0,
        centroid: [0.5],
        created_at: '2023-01-01T00:00:00.000Z',
        updated_at: '2023-01-01T00:00:00.000Z',
      },
    ];

    const mockModel1 = {
      id: model1Id,
      ai_provider_id: 'provider-1',
      model_name: 'model-1',
      model_type: 'text',
      created_at: '2023-01-01T00:00:00.000Z',
      updated_at: '2023-01-01T00:00:00.000Z',
    };

    const mockModel2 = {
      id: model2Id,
      ai_provider_id: 'provider-2',
      model_name: 'model-2',
      model_type: 'text',
      created_at: '2023-01-01T00:00:00.000Z',
      updated_at: '2023-01-01T00:00:00.000Z',
    };

    beforeEach(() => {
      mockUserDataStorageConnector.getSkills.mockResolvedValue([mockSkill]);
      mockUserDataStorageConnector.getSkillOptimizationClusters.mockResolvedValue(
        mockClusters,
      );
      mockUserDataStorageConnector.addModelsToSkill.mockResolvedValue(
        undefined,
      );
      mockUserDataStorageConnector.getModels.mockResolvedValue([mockModel1]);
      mockUserDataStorageConnector.createSkillEvent.mockResolvedValue({});
      mockUserDataStorageConnector.updateSkillOptimizationCluster.mockResolvedValue(
        {},
      );
      mockUserDataStorageConnector.updateSkillOptimizationArm.mockResolvedValue(
        {},
      );
      mockUserDataStorageConnector.deleteSkillOptimizationArmStats.mockResolvedValue(
        undefined,
      );
      mockUserDataStorageConnector.deleteSkillOptimizationArm.mockResolvedValue(
        undefined,
      );
      mockUserDataStorageConnector.getSkillOptimizationEvaluations.mockResolvedValue(
        [],
      );
    });

    it('should seed every arm with the skill seed prompt instead of asking a model', async () => {
      // A skill the gateway created keeps its caller's prompt; on day one the
      // arms are that prompt verbatim, with no model call to write one.
      mockUserDataStorageConnector.getSkills.mockResolvedValue([
        { ...mockSkill, seed_system_prompt: 'You are the caller.' },
      ]);
      mockUserDataStorageConnector.getSkillOptimizationArms.mockResolvedValue(
        [],
      );
      mockUserDataStorageConnector.getSkillModels.mockResolvedValue([
        mockModel1,
      ]);
      const created: Array<{ params: { system_prompt: string } }> = [];
      mockUserDataStorageConnector.createSkillOptimizationArms.mockImplementation(
        (_c: unknown, params: Array<{ params: { system_prompt: string } }>) => {
          created.push(...params);
          return Promise.resolve(
            params.map((p, i) => ({ ...p, id: `arm-${i}` })),
          );
        },
      );
      vi.mocked(generateSeedSystemPromptForSkill).mockClear();

      const res = await app.request(`/${skillId}/models`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelIds: [model1Id] }),
      });

      expect(res.status).toBe(201);
      expect(created.length).toBeGreaterThan(0);
      for (const arm of created) {
        expect(arm.params.system_prompt).toBe('You are the caller.');
      }
      expect(generateSeedSystemPromptForSkill).not.toHaveBeenCalled();
    });

    it('should create equal number of arms per cluster when adding a model', async () => {
      // No existing arms
      mockUserDataStorageConnector.getSkillOptimizationArms.mockResolvedValue(
        [],
      );
      mockUserDataStorageConnector.getSkillModels.mockResolvedValue([
        mockModel1,
      ]);

      const createdArms: Array<{
        id: string;
        cluster_id: string;
        name: string;
      }> = [];
      mockUserDataStorageConnector.createSkillOptimizationArms.mockImplementation(
        (_c: unknown, params: Array<{ cluster_id: string; name: string }>) => {
          const arms = params.map((p, idx) => ({
            id: `arm-${createdArms.length + idx}`,
            cluster_id: p.cluster_id,
            name: p.name,
          }));
          createdArms.push(...arms);
          return Promise.resolve(arms);
        },
      );

      // Use direct route access for nested path
      const res = await app.request(`/${skillId}/models`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelIds: [model1Id] }),
      });

      expect(res.status).toBe(201);

      // Count arms per cluster
      const armsPerCluster = new Map<string, number>();
      for (const arm of createdArms) {
        armsPerCluster.set(
          arm.cluster_id,
          (armsPerCluster.get(arm.cluster_id) || 0) + 1,
        );
      }

      // Each cluster should have the same number of arms
      const armCounts = [...armsPerCluster.values()];
      expect(armCounts.length).toBe(2); // 2 clusters
      expect(armCounts[0]).toBe(armCounts[1]); // Same count per cluster
      expect(armCounts[0]).toBe(BaseArmsParams.length); // 1 model × base arm count
    });

    it('should create equal number of arms per cluster when adding second model', async () => {
      // Existing arms for model1 in both clusters
      const existingArms = [];
      for (let c = 0; c < 2; c++) {
        for (let a = 0; a < BaseArmsParams.length; a++) {
          existingArms.push({
            id: `existing-arm-c${c}-a${a}`,
            cluster_id: c === 0 ? cluster1Id : cluster2Id,
            name: `${a + 1}`,
            params: {
              ...BaseArmsParams[a],
              model_id: model1Id,
              system_prompt: 'test',
            },
            agent_id: agentId,
            skill_id: skillId,
            created_at: '2023-01-01T00:00:00.000Z',
            updated_at: '2023-01-01T00:00:00.000Z',
          });
        }
      }

      mockUserDataStorageConnector.getSkillOptimizationArms.mockResolvedValue(
        existingArms,
      );
      mockUserDataStorageConnector.getSkillModels.mockResolvedValue([
        mockModel1,
        mockModel2,
      ]);
      mockUserDataStorageConnector.getModels.mockResolvedValue([mockModel2]);

      const createdArms: Array<{
        id: string;
        cluster_id: string;
        name: string;
      }> = [];
      mockUserDataStorageConnector.createSkillOptimizationArms.mockImplementation(
        (_c: unknown, params: Array<{ cluster_id: string; name: string }>) => {
          const arms = params.map((p, idx) => ({
            id: `new-arm-${createdArms.length + idx}`,
            cluster_id: p.cluster_id,
            name: p.name,
          }));
          createdArms.push(...arms);
          return Promise.resolve(arms);
        },
      );

      // Use direct route access for nested path
      const res = await app.request(`/${skillId}/models`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelIds: [model2Id] }),
      });

      expect(res.status).toBe(201);

      // Count created arms per cluster (new arms only)
      const newArmsPerCluster = new Map<string, number>();
      for (const arm of createdArms) {
        newArmsPerCluster.set(
          arm.cluster_id,
          (newArmsPerCluster.get(arm.cluster_id) || 0) + 1,
        );
      }

      // Each cluster should have the same number of NEW arms
      const newArmCounts = [...newArmsPerCluster.values()];
      expect(newArmCounts.length).toBe(2); // 2 clusters
      expect(newArmCounts[0]).toBe(newArmCounts[1]); // Same count per cluster
      expect(newArmCounts[0]).toBe(BaseArmsParams.length); // 1 new model × base arm count
    });

    it('should not create duplicate arm names within a cluster', async () => {
      // No existing arms
      mockUserDataStorageConnector.getSkillOptimizationArms.mockResolvedValue(
        [],
      );
      mockUserDataStorageConnector.getSkillModels.mockResolvedValue([
        mockModel1,
        mockModel2,
      ]);
      mockUserDataStorageConnector.getModels.mockResolvedValue([
        mockModel1,
        mockModel2,
      ]);

      const createdArms: Array<{
        id: string;
        cluster_id: string;
        name: string;
      }> = [];
      mockUserDataStorageConnector.createSkillOptimizationArms.mockImplementation(
        (_c: unknown, params: Array<{ cluster_id: string; name: string }>) => {
          const arms = params.map((p, idx) => ({
            id: `arm-${createdArms.length + idx}`,
            cluster_id: p.cluster_id,
            name: p.name,
          }));
          createdArms.push(...arms);
          return Promise.resolve(arms);
        },
      );

      // Use direct route access for nested path
      const res = await app.request(`/${skillId}/models`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelIds: [model1Id, model2Id] }),
      });

      expect(res.status).toBe(201);

      // Check for duplicate names within each cluster
      const namesPerCluster = new Map<string, Set<string>>();
      for (const arm of createdArms) {
        if (!namesPerCluster.has(arm.cluster_id)) {
          namesPerCluster.set(arm.cluster_id, new Set());
        }
        const names = namesPerCluster.get(arm.cluster_id)!;

        // This would fail if there are duplicate names
        expect(names.has(arm.name)).toBe(false);
        names.add(arm.name);
      }

      // Each cluster should have 2 models × base arm count arms
      for (const names of namesPerCluster.values()) {
        expect(names.size).toBe(BaseArmsParams.length * 2);
      }
    });

    it('should delete orphaned arms when they no longer match expected structure', async () => {
      // Simulate arms ordered by created_at desc (newest first) - the bug scenario
      // Cluster 2 arms come before cluster 1 arms in the result
      const existingArms = [];
      // Add cluster 2 arms first (as if they were created more recently)
      for (let a = 0; a < BaseArmsParams.length; a++) {
        existingArms.push({
          id: `arm-c2-${a}`,
          cluster_id: cluster2Id,
          name: `${a + 1}`,
          params: {
            ...BaseArmsParams[a],
            model_id: model1Id,
            system_prompt: 'test',
          },
          agent_id: agentId,
          skill_id: skillId,
          created_at: '2023-01-02T00:00:00.000Z', // newer
          updated_at: '2023-01-02T00:00:00.000Z',
        });
      }
      // Then cluster 1 arms
      for (let a = 0; a < BaseArmsParams.length; a++) {
        existingArms.push({
          id: `arm-c1-${a}`,
          cluster_id: cluster1Id,
          name: `${a + 1}`,
          params: {
            ...BaseArmsParams[a],
            model_id: model1Id,
            system_prompt: 'test',
          },
          agent_id: agentId,
          skill_id: skillId,
          created_at: '2023-01-01T00:00:00.000Z', // older
          updated_at: '2023-01-01T00:00:00.000Z',
        });
      }

      mockUserDataStorageConnector.getSkillOptimizationArms.mockResolvedValue(
        existingArms,
      );
      // Only model1 is associated (we're not adding any new models, just regenerating)
      mockUserDataStorageConnector.getSkillModels.mockResolvedValue([
        mockModel1,
      ]);
      mockUserDataStorageConnector.getModels.mockResolvedValue([mockModel1]);

      mockUserDataStorageConnector.createSkillOptimizationArms.mockResolvedValue(
        [],
      );

      // Use direct route access for nested path
      const res = await app.request(`/${skillId}/models`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelIds: [model1Id] }),
      });

      expect(res.status).toBe(201);

      // The key assertion: updateSkillOptimizationArm should be called for all existing arms
      // (reusing them by cluster), not creating new ones and leaving orphans
      const updateCalls =
        mockUserDataStorageConnector.updateSkillOptimizationArm.mock.calls;
      const deleteCalls =
        mockUserDataStorageConnector.deleteSkillOptimizationArm.mock.calls;

      // All existing arms should be updated (reused), none should be deleted
      expect(updateCalls.length).toBe(existingArms.length);
      expect(deleteCalls.length).toBe(0);

      // Verify arms were updated grouped by cluster
      const updatedArmIds = updateCalls.map((call) => call[1]);
      const cluster1Updates = updatedArmIds.filter((id: string) =>
        id.startsWith('arm-c1'),
      );
      const cluster2Updates = updatedArmIds.filter((id: string) =>
        id.startsWith('arm-c2'),
      );

      expect(cluster1Updates.length).toBe(BaseArmsParams.length);
      expect(cluster2Updates.length).toBe(BaseArmsParams.length);
    });
  });
});
