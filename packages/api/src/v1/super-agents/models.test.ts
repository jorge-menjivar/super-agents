import { getAuthJwtSecret } from '@api/constants';
import { authenticatedMiddleware } from '@api/middlewares/auth';
import { createMockContext } from '@api/test-utils/mock-context';
import type { AppEnv } from '@api/types/hono';
import { modelsRouter } from '@api/v1/super-agents/models';
import type { Model } from '@shared/types/data/model';
import { SystemSettingsOptions } from '@shared/types/data/system-settings';
import { Hono } from 'hono';
import { createFactory } from 'hono/factory';
import { sign } from 'hono/jwt';
import { testClient } from 'hono/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Hoist the test constants so they're available during mock setup
const { TEST_BEARER_TOKEN, TEST_JWT_SECRET } = vi.hoisted(() => ({
  TEST_BEARER_TOKEN: 'test-bearer-token',
  TEST_JWT_SECRET: 'test-jwt-secret-for-testing',
}));

// Mock the constants module to provide test values
vi.mock('@api/constants', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@api/constants')>();
  return {
    ...actual,
    getAccessPassword: () => undefined,
    getBearerToken: () => TEST_BEARER_TOKEN,
    getAuthJwtSecret: () => TEST_JWT_SECRET,
  };
});

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
  getSkillReadiness: vi.fn(),
  getRecentSkills: vi.fn(),
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
  .route('/', modelsRouter);

describe('Models API Status Codes', () => {
  const client = testClient(app);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /', () => {
    it('should return 200 on successful fetch', async () => {
      const mockModels: Model[] = [
        {
          id: '123e4567-e89b-12d3-a456-426614174000',
          ai_provider_id: '550e8400-e29b-41d4-a716-446655440000',
          model_name: 'gpt-4',
          model_type: 'text',
          embedding_dimensions: null,
          created_at: '2023-01-01T00:00:00.000Z',
          updated_at: '2023-01-01T00:00:00.000Z',
        },
      ];
      mockUserDataStorageConnector.getModels.mockResolvedValue(mockModels);

      const res = await client.index.$get({
        query: { model_name: 'gpt-4' },
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual(mockModels);
    });

    it('should return 200 with empty array when no models found', async () => {
      mockUserDataStorageConnector.getModels.mockResolvedValue([]);

      const res = await client.index.$get();

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual([]);
    });

    it('should return 500 on database error', async () => {
      mockUserDataStorageConnector.getModels.mockRejectedValue(
        new Error('Database connection failed'),
      );

      const res = await client.index.$get();

      expect(res.status).toBe(500);
    });

    it('should handle invalid query parameters', async () => {
      const res = await client.index.$get({
        query: { limit: 'invalid' },
      });

      expect(res.status).toBe(500);
    });
  });

  describe('GET /:id', () => {
    it('should return 404 when model not found', async () => {
      mockUserDataStorageConnector.getModels.mockResolvedValue([]);

      const res = await client[':id'].$get({
        param: { id: '123e4567-e89b-12d3-a456-426614174000' },
      });

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data).toEqual({ error: 'Model not found' });
    });

    it('should return 400 for invalid UUID', async () => {
      const res = await client[':id'].$get({
        param: { id: 'invalid-uuid' },
      });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /', () => {
    it('should return 400 for invalid request body', async () => {
      const res = await client.index.$post({
        json: {
          ai_provider_id: '550e8400-e29b-41d4-a716-446655440000',
          model_name: '', // Invalid: empty string
        },
      });

      expect(res.status).toBe(400);
    });

    it('should return 400 for missing required fields', async () => {
      const res = await client.index.$post({
        json: {
          model_name: 'gpt-4',
          // Missing ai_provider_id - this will be handled by Zod validation
        } as { ai_provider_id: string; model_name: string },
      });

      expect(res.status).toBe(400);
    });

    it('should return 400 for invalid UUID in ai_provider_id', async () => {
      const res = await client.index.$post({
        json: {
          ai_provider_id: 'invalid-uuid',
          model_name: 'gpt-4',
        },
      });

      expect(res.status).toBe(400);
    });
  });

  describe('PATCH /:id', () => {
    it('should return 400 for invalid UUID in param', async () => {
      const res = await client[':id'].$patch({
        param: { id: 'invalid-uuid' },
        json: { model_name: 'gpt-4-turbo' },
      });

      expect(res.status).toBe(400);
    });

    it('should return 400 for invalid request body', async () => {
      const res = await client[':id'].$patch({
        param: { id: '123e4567-e89b-12d3-a456-426614174000' },
        json: { model_name: '' }, // Invalid: empty string
      });

      expect(res.status).toBe(400);
    });

    it('should return 400 for empty update body', async () => {
      const res = await client[':id'].$patch({
        param: { id: '123e4567-e89b-12d3-a456-426614174000' },
        json: {},
      });

      expect(res.status).toBe(400);
    });
  });

  describe('DELETE /:id', () => {
    const modelId = '123e4567-e89b-12d3-a456-426614174000';

    const systemSettings = {
      id: '9f6e6c1e-1f3e-4a2a-9a5f-2f2b1c9d4e10',
      system_prompt_reflection_model_id: null,
      evaluation_generation_model_id: null,
      embedding_model_id: null,
      judge_model_id: null,
      skill_arbiter_model_id: null,
      intent_compaction_model_id: null,
      options: SystemSettingsOptions.parse({
        intent_compaction: { timeout_ms: 15_000 },
      }),
      created_at: '2023-01-01T00:00:00.000Z',
      updated_at: '2023-01-01T00:00:00.000Z',
    };

    it('should return 400 for invalid UUID', async () => {
      const res = await client[':id'].$delete({
        param: { id: 'invalid-uuid' },
      });

      expect(res.status).toBe(400);
    });

    it('should return 409 naming the settings that use the model', async () => {
      mockUserDataStorageConnector.getSystemSettings.mockResolvedValue({
        ...systemSettings,
        system_prompt_reflection_model_id: modelId,
        judge_model_id: modelId,
        skill_arbiter_model_id: modelId,
      });

      const res = await client[':id'].$delete({ param: { id: modelId } });

      expect(res.status).toBe(409);
      const data = (await res.json()) as { error: string };
      expect(data.error).toContain(
        'System Prompt Reflection, Judge and Skill Arbiter model',
      );
    });

    it('should leave the skills alone when the delete is refused', async () => {
      mockUserDataStorageConnector.getSystemSettings.mockResolvedValue({
        ...systemSettings,
        embedding_model_id: modelId,
      });

      await client[':id'].$delete({ param: { id: modelId } });

      expect(
        mockUserDataStorageConnector.getSkillsByModelId,
      ).not.toHaveBeenCalled();
      expect(
        mockUserDataStorageConnector.removeModelsFromSkill,
      ).not.toHaveBeenCalled();
      expect(mockUserDataStorageConnector.deleteModel).not.toHaveBeenCalled();
    });

    it('should delete a model no system setting uses', async () => {
      mockUserDataStorageConnector.getSystemSettings.mockResolvedValue(
        systemSettings,
      );
      mockUserDataStorageConnector.getSkillsByModelId.mockResolvedValue([]);
      mockUserDataStorageConnector.deleteModel.mockResolvedValue(undefined);

      const res = await client[':id'].$delete({ param: { id: modelId } });

      expect(res.status).toBe(200);
      expect(mockUserDataStorageConnector.deleteModel).toHaveBeenCalledWith(
        expect.anything(),
        modelId,
      );
    });
  });

  describe('Error Handling', () => {
    it('should handle database connection failures gracefully', async () => {
      mockUserDataStorageConnector.getModels.mockRejectedValue(
        new Error('Connection timeout'),
      );

      const res = await client.index.$get();

      expect(res.status).toBe(500);
    });

    it('should handle malformed JSON in POST requests', async () => {
      const res = await client.index.$post({
        json: null as unknown as {
          ai_provider_id: string;
          model_name: string;
        },
      });

      expect(res.status).toBe(400);
    });

    it('should handle malformed JSON in PATCH requests', async () => {
      const res = await client[':id'].$patch({
        param: { id: '123e4567-e89b-12d3-a456-426614174000' },
        json: null as unknown as { model_name?: string | undefined },
      });

      expect(res.status).toBe(400);
    });
  });
});

/**
 * Authentication Integration Tests for Models API
 *
 * These tests verify that the models endpoints are properly protected
 * by the authenticatedMiddleware when deployed in production.
 */
describe('Models API - Authentication Integration', () => {
  const factory = createFactory<AppEnv>();

  // Create app with auth middleware to test authentication
  const createAuthenticatedApp = () => {
    return new Hono<AppEnv>()
      .use('*', authenticatedMiddleware(factory))
      .use('*', async (c, next) => {
        c.set('user_data_storage_connector', mockUserDataStorageConnector);
        await next();
      })
      .route('/models', modelsRouter);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockUserDataStorageConnector.getModels.mockResolvedValue([]);
  });

  describe('GET /models', () => {
    it('should reject requests without any authentication', async () => {
      const app = createAuthenticatedApp();
      const req = new Request('http://localhost/models');
      const response = await app.fetch(req);

      expect(response.status).toBe(401);
      const text = await response.text();
      expect(text).toBe('Unauthorized');
    });

    it('should reject requests with invalid bearer token', async () => {
      const app = createAuthenticatedApp();
      const req = new Request('http://localhost/models', {
        headers: {
          Authorization: 'Bearer invalid-token-12345',
        },
      });
      const response = await app.fetch(req);

      expect(response.status).toBe(401);
    });

    it('should accept requests with valid bearer token', async () => {
      const app = createAuthenticatedApp();
      const req = new Request('http://localhost/models', {
        headers: {
          Authorization: `Bearer ${TEST_BEARER_TOKEN}`,
        },
      });
      const response = await app.fetch(req);

      expect(response.status).not.toBe(401);
      expect(response.status).toBe(200);
    });

    it('should accept requests with valid JWT cookie', async () => {
      const token = await sign(
        { sub: 'test-user-123', exp: Math.floor(Date.now() / 1000) + 3600 },
        getAuthJwtSecret(createMockContext()),
      );

      const app = createAuthenticatedApp();
      const req = new Request('http://localhost/models', {
        headers: {
          Cookie: `access_token=${token}`,
        },
      });
      const response = await app.fetch(req);

      expect(response.status).not.toBe(401);
      expect(response.status).toBe(200);
    });
  });

  describe('POST /models', () => {
    it('should reject unauthenticated POST requests', async () => {
      const app = createAuthenticatedApp();
      const req = new Request('http://localhost/models', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ai_provider_id: '550e8400-e29b-41d4-a716-446655440000',
          model_name: 'gpt-4',
        }),
      });
      const response = await app.fetch(req);

      expect(response.status).toBe(401);
    });

    it('should accept authenticated POST requests', async () => {
      const mockModel: Model = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        ai_provider_id: '550e8400-e29b-41d4-a716-446655440000',
        model_name: 'gpt-4',
        model_type: 'text',
        embedding_dimensions: null,
        created_at: '2023-01-01T00:00:00.000Z',
        updated_at: '2023-01-01T00:00:00.000Z',
      };
      mockUserDataStorageConnector.createModel.mockResolvedValue(mockModel);

      const app = createAuthenticatedApp();
      const req = new Request('http://localhost/models', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${TEST_BEARER_TOKEN}`,
        },
        body: JSON.stringify({
          ai_provider_id: '550e8400-e29b-41d4-a716-446655440000',
          model_name: 'gpt-4',
        }),
      });
      const response = await app.fetch(req);

      expect(response.status).not.toBe(401);
    });
  });

  describe('PATCH /models/:id', () => {
    it('should reject unauthenticated PATCH requests', async () => {
      const app = createAuthenticatedApp();
      const req = new Request(
        'http://localhost/models/123e4567-e89b-12d3-a456-426614174000',
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model_name: 'gpt-4-turbo',
          }),
        },
      );
      const response = await app.fetch(req);

      expect(response.status).toBe(401);
    });

    it('should accept authenticated PATCH requests', async () => {
      const mockModel: Model = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        ai_provider_id: '550e8400-e29b-41d4-a716-446655440000',
        model_name: 'gpt-4-turbo',
        model_type: 'text',
        embedding_dimensions: null,
        created_at: '2023-01-01T00:00:00.000Z',
        updated_at: '2023-01-01T00:00:00.000Z',
      };
      mockUserDataStorageConnector.updateModel.mockResolvedValue(mockModel);

      const app = createAuthenticatedApp();
      const req = new Request(
        'http://localhost/models/123e4567-e89b-12d3-a456-426614174000',
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${TEST_BEARER_TOKEN}`,
          },
          body: JSON.stringify({
            model_name: 'gpt-4-turbo',
          }),
        },
      );
      const response = await app.fetch(req);

      expect(response.status).not.toBe(401);
    });
  });

  describe('DELETE /models/:id', () => {
    it('should reject unauthenticated DELETE requests', async () => {
      const app = createAuthenticatedApp();
      const req = new Request(
        'http://localhost/models/123e4567-e89b-12d3-a456-426614174000',
        {
          method: 'DELETE',
        },
      );
      const response = await app.fetch(req);

      expect(response.status).toBe(401);
    });

    it('should accept authenticated DELETE requests', async () => {
      mockUserDataStorageConnector.deleteModel.mockResolvedValue(undefined);

      const app = createAuthenticatedApp();
      const req = new Request(
        'http://localhost/models/123e4567-e89b-12d3-a456-426614174000',
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${TEST_BEARER_TOKEN}`,
          },
        },
      );
      const response = await app.fetch(req);

      expect(response.status).not.toBe(401);
    });
  });
});
