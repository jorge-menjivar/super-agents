import type { AppEnv } from '@api/types/hono';
import { adoptDefaultModels } from '@api/utils/super-agents/skill-creation';
import { agentsRouter } from '@api/v1/super-agents/agents';
import { Hono } from 'hono';
import { testClient } from 'hono/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@api/utils/super-agents/skill-creation', () => ({
  adoptDefaultModels: vi.fn().mockResolvedValue([]),
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
  .route('/', agentsRouter);

describe('Agents API Status Codes', () => {
  const client = testClient(app);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /', () => {
    it('should return 200 on successful fetch', async () => {
      const mockAgents = [
        { id: 'a3b4c5d6-e7f8-4012-8345-67890abcdef02', name: 'test-agent' },
      ];
      mockUserDataStorageConnector.getAgents.mockResolvedValue(mockAgents);

      const res = await client.index.$get({
        query: { name: 'test' },
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual(mockAgents);
    });

    it('should return 500 on error', async () => {
      mockUserDataStorageConnector.getAgents.mockRejectedValue(
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

  describe('PATCH /:agentId', () => {
    it('should return 200 on successful update', async () => {
      const mockAgent = {
        id: 'c13d1678-150a-466b-804f-ecc82de3680e',
        name: 'test-agent',
        description: 'updated description',
      };
      mockUserDataStorageConnector.updateAgent.mockResolvedValue(mockAgent);

      const res = await client[':agentId'].$patch({
        param: { agentId: 'c13d1678-150a-466b-804f-ecc82de3680e' },
        json: { description: 'updated description' },
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual(mockAgent);
    });

    it('should return 500 on update error', async () => {
      mockUserDataStorageConnector.updateAgent.mockRejectedValue(
        new Error('Update failed'),
      );

      const res = await client[':agentId'].$patch({
        param: { agentId: 'c13d1678-150a-466b-804f-ecc82de3680e' },
        json: { description: 'updated description' },
      });

      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data).toEqual({
        error: 'An unexpected database error occurred. Please try again.',
      });
    });

    it('should return 400 for invalid UUID', async () => {
      const res = await client[':agentId'].$patch({
        param: { agentId: 'invalid-uuid' },
        json: { description: 'updated description' },
      });

      expect(res.status).toBe(400);
      expect(mockUserDataStorageConnector.updateAgent).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /:agentId', () => {
    it('should return 204 on successful deletion', async () => {
      mockUserDataStorageConnector.deleteAgent.mockResolvedValue(undefined);

      const res = await client[':agentId'].$delete({
        param: { agentId: 'c13d1678-150a-466b-804f-ecc82de3680e' },
      });

      expect(res.status).toBe(204);
      expect(await res.text()).toBe('');
    });

    it('should return 500 on deletion error', async () => {
      mockUserDataStorageConnector.deleteAgent.mockRejectedValue(
        new Error('Delete failed'),
      );

      const res = await client[':agentId'].$delete({
        param: { agentId: 'c13d1678-150a-466b-804f-ecc82de3680e' },
      });

      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data).toEqual({
        error: 'An unexpected database error occurred. Please try again.',
      });
    });

    it('should return 400 for invalid UUID', async () => {
      const res = await client[':agentId'].$delete({
        param: { agentId: 'invalid-uuid' },
      });

      expect(res.status).toBe(400);
      expect(mockUserDataStorageConnector.deleteAgent).not.toHaveBeenCalled();
    });
  });

  describe('/:agentId/skill-routings', () => {
    const agentId = '123e4567-e89b-12d3-a456-426614174000';

    it('should list the routing rows of the agent skills', async () => {
      const row = { skill_id: 'skill-1', agent_id: agentId, sample_count: 3 };
      mockUserDataStorageConnector.getSkillRoutings.mockResolvedValue([row]);

      const res = await app.request(`/${agentId}/skill-routings`);

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual([row]);
      expect(
        mockUserDataStorageConnector.getSkillRoutings,
      ).toHaveBeenCalledWith(expect.anything(), { agent_id: agentId });
    });

    it('should reject an invalid agent id', async () => {
      const res = await app.request('/not-a-uuid/skill-routings');

      expect(res.status).toBe(400);
      expect(
        mockUserDataStorageConnector.getSkillRoutings,
      ).not.toHaveBeenCalled();
    });

    it('should return 500 when listing fails', async () => {
      mockUserDataStorageConnector.getSkillRoutings.mockRejectedValue(
        new Error('Database error'),
      );

      const res = await app.request(`/${agentId}/skill-routings`);

      expect(res.status).toBe(500);
    });
  });

  describe('/:agentId/models', () => {
    const agentId = '123e4567-e89b-12d3-a456-426614174000';
    const modelId = '123e4567-e89b-12d3-a456-426614174001';

    it('should list the agent default models', async () => {
      const model = { id: modelId, model_name: 'gpt-5' };
      mockUserDataStorageConnector.getAgentModels.mockResolvedValue([model]);

      const res = await app.request(`/${agentId}/models`);

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual([model]);
      expect(mockUserDataStorageConnector.getAgentModels).toHaveBeenCalledWith(
        expect.anything(),
        agentId,
      );
    });

    it('should return 500 when listing fails', async () => {
      mockUserDataStorageConnector.getAgentModels.mockRejectedValue(
        new Error('Database error'),
      );

      const res = await app.request(`/${agentId}/models`);

      expect(res.status).toBe(500);
    });

    it('should add models to an existing agent', async () => {
      mockUserDataStorageConnector.getAgents.mockResolvedValue([
        { id: agentId },
      ]);
      mockUserDataStorageConnector.addModelsToAgent.mockResolvedValue(
        undefined,
      );

      const res = await app.request(`/${agentId}/models`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ modelIds: [modelId] }),
      });

      expect(res.status).toBe(201);
      expect(
        mockUserDataStorageConnector.addModelsToAgent,
      ).toHaveBeenCalledWith(expect.anything(), agentId, [modelId]);
      // The automatic skills created while the agent had no defaults get them.
      expect(adoptDefaultModels).toHaveBeenCalledWith(
        expect.anything(),
        mockUserDataStorageConnector,
        { id: agentId },
        [modelId],
      );
    });

    it('should return 404 when adding models to an unknown agent', async () => {
      mockUserDataStorageConnector.getAgents.mockResolvedValue([]);

      const res = await app.request(`/${agentId}/models`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ modelIds: [modelId] }),
      });

      expect(res.status).toBe(404);
      expect(
        mockUserDataStorageConnector.addModelsToAgent,
      ).not.toHaveBeenCalled();
    });

    it('should return 400 for a malformed model list', async () => {
      const res = await app.request(`/${agentId}/models`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ modelIds: ['not-a-uuid'] }),
      });

      expect(res.status).toBe(400);
    });

    it('should remove the models named in the query', async () => {
      mockUserDataStorageConnector.removeModelsFromAgent.mockResolvedValue(
        undefined,
      );

      const res = await app.request(
        `/${agentId}/models?ids=${modelId},${agentId}`,
        { method: 'DELETE' },
      );

      expect(res.status).toBe(200);
      expect(
        mockUserDataStorageConnector.removeModelsFromAgent,
      ).toHaveBeenCalledWith(expect.anything(), agentId, [modelId, agentId]);
    });
  });

  describe('GET /:agentId/skills', () => {
    it('should return 200 on successful fetch', async () => {
      const mockSkills = [
        { id: 'b4c5d6e7-f8a9-4123-8456-7890abcdef023', name: 'test-skill' },
      ];
      mockUserDataStorageConnector.getSkills.mockResolvedValue(mockSkills);

      const res = await client[':agentId'].skills.$get({
        param: { agentId: 'c13d1678-150a-466b-804f-ecc82de3680e' },
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual(mockSkills);
      expect(mockUserDataStorageConnector.getSkills).toHaveBeenCalledWith(
        expect.anything(),
        {
          agent_id: 'c13d1678-150a-466b-804f-ecc82de3680e',
        },
      );
    });

    it('should return 500 on error', async () => {
      mockUserDataStorageConnector.getSkills.mockRejectedValue(
        new Error('Fetch failed'),
      );

      const res = await client[':agentId'].skills.$get({
        param: { agentId: 'c13d1678-150a-466b-804f-ecc82de3680e' },
      });

      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data).toEqual({
        error: 'An unexpected database error occurred. Please try again.',
      });
    });

    it('should return 400 for invalid UUID', async () => {
      const res = await client[':agentId'].skills.$get({
        param: { agentId: 'invalid-uuid' },
      });

      expect(res.status).toBe(400);
      expect(mockUserDataStorageConnector.getSkills).not.toHaveBeenCalled();
    });
  });
});

describe('Agents API reviewer_agent_id', () => {
  const client = testClient(app);
  const agentId = 'c13d1678-150a-466b-804f-ecc82de3680e';
  const reviewerId = '6f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('refuses a reviewer that does not exist', async () => {
    mockUserDataStorageConnector.getAgents.mockResolvedValue([]);

    const res = await client.index.$post({
      json: {
        name: 'reviewed',
        description: 'An agent whose answers another agent reviews first.',
        reviewer_agent_id: reviewerId,
      },
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'The reviewer agent does not exist.',
    });
    expect(mockUserDataStorageConnector.createAgent).not.toHaveBeenCalled();
  });

  it('refuses an agent as its own reviewer', async () => {
    const res = await client[':agentId'].$patch({
      param: { agentId },
      json: { reviewer_agent_id: agentId },
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'An agent cannot be its own reviewer.',
    });
    expect(mockUserDataStorageConnector.updateAgent).not.toHaveBeenCalled();
  });

  it('sets a reviewer that exists', async () => {
    mockUserDataStorageConnector.getAgents.mockResolvedValue([
      { id: reviewerId, name: 'guard' },
    ]);
    mockUserDataStorageConnector.updateAgent.mockResolvedValue({
      id: agentId,
      reviewer_agent_id: reviewerId,
    });

    const res = await client[':agentId'].$patch({
      param: { agentId },
      json: { reviewer_agent_id: reviewerId },
    });

    expect(res.status).toBe(200);
    expect(mockUserDataStorageConnector.updateAgent).toHaveBeenCalledWith(
      expect.anything(),
      agentId,
      { reviewer_agent_id: reviewerId },
    );
  });

  it('clears a reviewer without looking one up', async () => {
    mockUserDataStorageConnector.updateAgent.mockResolvedValue({
      id: agentId,
      reviewer_agent_id: null,
      review_fail_closed: false,
      review_expose_reason: false,
    });

    const res = await client[':agentId'].$patch({
      param: { agentId },
      json: { reviewer_agent_id: null },
    });

    expect(res.status).toBe(200);
    expect(mockUserDataStorageConnector.getAgents).not.toHaveBeenCalled();
  });
});
