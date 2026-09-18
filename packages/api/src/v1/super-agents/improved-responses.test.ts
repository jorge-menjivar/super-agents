import { authenticatedMiddleware } from '@api/middlewares/auth';
import { userDataMiddleware } from '@api/middlewares/user-data';
import { commonVariablesMiddleware } from '@api/middlewares/variables';
import type { UserDataStorageConnector } from '@api/types/connector';
import type { AppEnv } from '@api/types/hono';
import { improvedResponsesRouter } from '@api/v1/super-agents/improved-responses';
import type { ImprovedResponse } from '@shared/types/data/improved-response';
import { Hono } from 'hono';
import { createFactory } from 'hono/factory';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock storage connector for tests
const mockUserDataStorageConnector = {
  // Improved response methods
  getImprovedResponse: vi.fn(),
  createImprovedResponse: vi.fn(),
  updateImprovedResponse: vi.fn(),
  deleteImprovedResponse: vi.fn(),

  // Feedback methods
  getFeedback: vi.fn(),
  createFeedback: vi.fn(),
  deleteFeedback: vi.fn(),

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

// Mock environment constants for authentication tests
vi.mock('@api/constants', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@api/constants')>();
  return {
    ...actual,
    getAccessPassword: () => undefined,
    getBearerToken: () => 'test-bearer-token',
    getAuthJwtSecret: () => 'test-jwt-secret',
  };
});

describe('Improved Responses API', () => {
  let app: Hono<AppEnv>;

  beforeEach(() => {
    // Reset all mocks
    vi.resetAllMocks();

    // Create a new app for each test
    app = new Hono<AppEnv>();

    // Apply middleware to set the storage connector
    app.use('/*', (c, next) => {
      c.set('user_data_storage_connector', mockUserDataStorageConnector);
      return next();
    });

    // Apply the routes
    app.route('/improved-responses', improvedResponsesRouter);
  });

  describe('GET /improved-responses?id=...', () => {
    it('should return an improved response by ID', async () => {
      // Mock data
      const mockImprovedResponse: ImprovedResponse = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        agent_id: '123e4567-e89b-12d3-a456-426614174002',
        skill_id: '123e4567-e89b-12d3-a456-426614174004',
        log_id: '123e4567-e89b-12d3-a456-426614174003',
        original_response_body: { original: 'content' },
        improved_response_body: { improved: 'content' },
        created_at: '2023-01-01T00:00:00.000Z',
        updated_at: '2023-01-01T00:00:00.000Z',
      };

      // Setup mock response
      vi.mocked(
        mockUserDataStorageConnector.getImprovedResponse,
      ).mockResolvedValue([mockImprovedResponse]);

      // Make request
      const res = await app.request(
        '/improved-responses?id=123e4567-e89b-12d3-a456-426614174000',
      );

      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data).toEqual([mockImprovedResponse]);
      expect(
        mockUserDataStorageConnector.getImprovedResponse,
      ).toHaveBeenCalledWith(expect.anything(), {
        id: '123e4567-e89b-12d3-a456-426614174000',
        log_id: undefined,
      });
    });

    it('should return 400 for invalid UUID', async () => {
      // Make request with invalid UUID
      const res = await app.request('/improved-responses?id=invalid-id');

      expect(res.status).toBe(400);
    });

    it('should return empty array if improved response not found', async () => {
      // Setup mock response
      vi.mocked(
        mockUserDataStorageConnector.getImprovedResponse,
      ).mockResolvedValue([]);

      // Make request
      const res = await app.request(
        '/improved-responses?id=123e4567-e89b-12d3-a456-426614174000',
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual([]);
    });
  });

  describe('GET /improved-responses?log_id=...', () => {
    it('should return an improved response by log ID', async () => {
      // Mock data
      const mockImprovedResponse: ImprovedResponse = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        agent_id: '123e4567-e89b-12d3-a456-426614174002',
        skill_id: '123e4567-e89b-12d3-a456-426614174004',
        log_id: '123e4567-e89b-12d3-a456-426614174003',
        original_response_body: { original: 'content' },
        improved_response_body: { improved: 'content' },
        created_at: '2023-01-01T00:00:00.000Z',
        updated_at: '2023-01-01T00:00:00.000Z',
      };

      // Setup mock response
      vi.mocked(
        mockUserDataStorageConnector.getImprovedResponse,
      ).mockResolvedValue([mockImprovedResponse]);

      // Make request
      const res = await app.request(
        '/improved-responses?log_id=123e4567-e89b-12d3-a456-426614174003',
      );

      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data).toEqual([mockImprovedResponse]);
      expect(
        mockUserDataStorageConnector.getImprovedResponse,
      ).toHaveBeenCalledWith(expect.anything(), {
        id: undefined,
        log_id: '123e4567-e89b-12d3-a456-426614174003',
      });
    });

    it('should return 400 for invalid log UUID', async () => {
      // Make request with invalid UUID
      const res = await app.request('/improved-responses?log_id=invalid-id');

      expect(res.status).toBe(400);
    });

    it('should return empty array if improved response not found', async () => {
      // Setup mock response
      vi.mocked(
        mockUserDataStorageConnector.getImprovedResponse,
      ).mockResolvedValue([]);

      // Make request
      const res = await app.request(
        '/improved-responses?log_id=123e4567-e89b-12d3-a456-426614174003',
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual([]);
    });
  });

  describe('POST /improved-responses', () => {
    it('should create a new improved response', async () => {
      // Mock data
      const newImprovedResponseInput = {
        agent_id: '123e4567-e89b-12d3-a456-426614174002',
        skill_id: '123e4567-e89b-12d3-a456-426614174004',
        log_id: '123e4567-e89b-12d3-a456-426614174003',
        original_response_body: { original: 'content' },
        improved_response_body: { improved: 'content' },
      };

      const createdImprovedResponse: ImprovedResponse = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        ...newImprovedResponseInput,
        created_at: '2023-01-01T00:00:00.000Z',
        updated_at: '2023-01-01T00:00:00.000Z',
      };

      // Setup mock response
      vi.mocked(
        mockUserDataStorageConnector.createImprovedResponse,
      ).mockResolvedValue(createdImprovedResponse);

      // Make request
      const res = await app.request('/improved-responses', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(newImprovedResponseInput),
      });

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data).toEqual(createdImprovedResponse);

      // Check that createImprovedResponse was called
      expect(
        mockUserDataStorageConnector.createImprovedResponse,
      ).toHaveBeenCalled();
    });

    it('should pass transformed data to connector', async () => {
      const newImprovedResponseInput = {
        agent_id: '123e4567-e89b-12d3-a456-426614174002',
        skill_id: '123e4567-e89b-12d3-a456-426614174004',
        log_id: '123e4567-e89b-12d3-a456-426614174003',
        original_response_body: { original: 'content' },
        improved_response_body: { improved: 'content' },
      };

      const createdImprovedResponse: ImprovedResponse = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        ...newImprovedResponseInput,
        created_at: '2023-01-01T00:00:00.000Z',
        updated_at: '2023-01-01T00:00:00.000Z',
      };

      vi.mocked(
        mockUserDataStorageConnector.createImprovedResponse,
      ).mockResolvedValue(createdImprovedResponse);

      await app.request('/improved-responses', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(newImprovedResponseInput),
      });

      // Verify that the connector was called with transformed data (id and timestamps added)
      expect(
        mockUserDataStorageConnector.createImprovedResponse,
      ).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          agent_id: '123e4567-e89b-12d3-a456-426614174002',
          skill_id: '123e4567-e89b-12d3-a456-426614174004',
          log_id: '123e4567-e89b-12d3-a456-426614174003',
          original_response_body: { original: 'content' },
          improved_response_body: { improved: 'content' },
          id: expect.any(String),
          created_at: expect.any(String),
          updated_at: expect.any(String),
        }),
      );
    });

    it('should return 400 for invalid input', async () => {
      // Make request with invalid data
      const res = await app.request('/improved-responses', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          invalid: 'data',
        }),
      });

      expect(res.status).toBe(400);
    });

    it('should require agent_id field', async () => {
      const res = await app.request('/improved-responses', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          // Missing agent_id
          skill_id: '123e4567-e89b-12d3-a456-426614174004',
          log_id: '123e4567-e89b-12d3-a456-426614174003',
          original_response_body: { original: 'content' },
          improved_response_body: { improved: 'content' },
        }),
      });

      expect(res.status).toBe(400);
      expect(
        mockUserDataStorageConnector.createImprovedResponse,
      ).not.toHaveBeenCalled();
    });

    it('should require log_id field', async () => {
      const res = await app.request('/improved-responses', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          agent_id: '123e4567-e89b-12d3-a456-426614174002',
          // Missing log_id
          original_response_body: { original: 'content' },
          improved_response_body: { improved: 'content' },
        }),
      });

      expect(res.status).toBe(400);
      expect(
        mockUserDataStorageConnector.createImprovedResponse,
      ).not.toHaveBeenCalled();
    });

    it('should require original_response_body field', async () => {
      const res = await app.request('/improved-responses', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          agent_id: '123e4567-e89b-12d3-a456-426614174002',
          log_id: '123e4567-e89b-12d3-a456-426614174003',
          // Missing original_response_body
          improved_response_body: { improved: 'content' },
        }),
      });

      expect(res.status).toBe(400);
      expect(
        mockUserDataStorageConnector.createImprovedResponse,
      ).not.toHaveBeenCalled();
    });

    it('should require improved_response_body field', async () => {
      const res = await app.request('/improved-responses', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          agent_id: '123e4567-e89b-12d3-a456-426614174002',
          log_id: '123e4567-e89b-12d3-a456-426614174003',
          original_response_body: { original: 'content' },
          // Missing improved_response_body
        }),
      });

      expect(res.status).toBe(400);
      expect(
        mockUserDataStorageConnector.createImprovedResponse,
      ).not.toHaveBeenCalled();
    });

    it('should require all required fields', async () => {
      const res = await app.request('/improved-responses', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          // Missing all required fields
        }),
      });

      expect(res.status).toBe(400);
      expect(
        mockUserDataStorageConnector.createImprovedResponse,
      ).not.toHaveBeenCalled();
    });
  });

  describe('PATCH /improved-responses', () => {
    it('should only allow updating improved_response_body', async () => {
      const updateData = {
        improved_response_body: { improved: 'updated content' },
      };

      const updatedImprovedResponse: ImprovedResponse = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        agent_id: '123e4567-e89b-12d3-a456-426614174002',
        skill_id: '123e4567-e89b-12d3-a456-426614174004',
        log_id: '123e4567-e89b-12d3-a456-426614174003',
        original_response_body: { original: 'content' },
        improved_response_body: { improved: 'updated content' },
        created_at: '2023-01-01T00:00:00.000Z',
        updated_at: '2023-01-02T00:00:00.000Z',
      };

      vi.mocked(
        mockUserDataStorageConnector.updateImprovedResponse,
      ).mockResolvedValue(updatedImprovedResponse);

      await app.request(
        '/improved-responses/123e4567-e89b-12d3-a456-426614174000',
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(updateData),
        },
      );

      // Verify only improved_response_body and auto-generated updated_at are passed
      expect(
        mockUserDataStorageConnector.updateImprovedResponse,
      ).toHaveBeenCalledWith(
        expect.anything(),
        '123e4567-e89b-12d3-a456-426614174000',
        expect.objectContaining({
          improved_response_body: { improved: 'updated content' },
        }),
      );
    });

    it('should reject when only id is provided without update fields', async () => {
      const res = await app.request(
        '/improved-responses/123e4567-e89b-12d3-a456-426614174000',
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
        },
      );

      expect(res.status).toBe(400);
      expect(
        mockUserDataStorageConnector.updateImprovedResponse,
      ).not.toHaveBeenCalled();
    });

    it('should reject invalid UUID in request body', async () => {
      const res = await app.request(
        '/improved-responses/123e4567-e89b-12d3-a456-426614174000',
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            id: 'invalid-uuid',
            improved_response_body: { improved: 'updated content' },
          }),
        },
      );

      expect(res.status).toBe(400);
      expect(
        mockUserDataStorageConnector.updateImprovedResponse,
      ).not.toHaveBeenCalled();
    });

    it('should return 400 for invalid input', async () => {
      // Make request with invalid data
      const res = await app.request(
        '/improved-responses/123e4567-e89b-12d3-a456-426614174000',
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            invalid: 'data',
          }),
        },
      );

      expect(res.status).toBe(400);
    });

    it('should return 500 on database error', async () => {
      vi.mocked(
        mockUserDataStorageConnector.updateImprovedResponse,
      ).mockRejectedValue(new Error('Database update failed'));

      const res = await app.request(
        '/improved-responses/123e4567-e89b-12d3-a456-426614174000',
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            improved_response_body: { improved: 'updated content' },
          }),
        },
      );

      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data).toHaveProperty(
        'error',
        'An unexpected database error occurred. Please try again.',
      );
    });
  });

  describe('DELETE /improved-responses?id=...', () => {
    it('should delete an improved response without prior existence check', async () => {
      // Mock data
      const improvedResponseId = '123e4567-e89b-12d3-a456-426614174000';

      // Only mock the delete call - no GET call should be made
      vi.mocked(
        mockUserDataStorageConnector.deleteImprovedResponse,
      ).mockResolvedValue(undefined);

      // Make request
      const res = await app.request(
        `/improved-responses/${improvedResponseId}`,
        {
          method: 'DELETE',
        },
      );

      expect(res.status).toBe(204);

      // Should NOT call getImprovedResponse (no existence check)
      expect(
        mockUserDataStorageConnector.getImprovedResponse,
      ).not.toHaveBeenCalled();

      // Should directly call deleteImprovedResponse
      expect(
        mockUserDataStorageConnector.deleteImprovedResponse,
      ).toHaveBeenCalledWith(expect.anything(), improvedResponseId);
    });

    it('should return 400 for invalid UUID in delete', async () => {
      const res = await app.request('/improved-responses/invalid-uuid', {
        method: 'DELETE',
      });

      expect(res.status).toBe(400);
      expect(
        mockUserDataStorageConnector.deleteImprovedResponse,
      ).not.toHaveBeenCalled();
    });

    it('should require id query parameter', async () => {
      const res = await app.request('/improved-responses', {
        method: 'DELETE',
      });

      expect(res.status).toBe(404);
      expect(
        mockUserDataStorageConnector.deleteImprovedResponse,
      ).not.toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('should handle database errors during GET', async () => {
      vi.mocked(
        mockUserDataStorageConnector.getImprovedResponse,
      ).mockRejectedValue(new Error('Database connection failed'));

      const res = await app.request(
        '/improved-responses?id=123e4567-e89b-12d3-a456-426614174000',
      );

      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data).toHaveProperty(
        'error',
        'An unexpected database error occurred. Please try again.',
      );
    });

    it('should handle database errors during CREATE', async () => {
      const newImprovedResponseInput = {
        agent_id: '123e4567-e89b-12d3-a456-426614174002',
        skill_id: '123e4567-e89b-12d3-a456-426614174004',
        log_id: '123e4567-e89b-12d3-a456-426614174003',
        original_response_body: { original: 'content' },
        improved_response_body: { improved: 'content' },
      };

      vi.mocked(
        mockUserDataStorageConnector.createImprovedResponse,
      ).mockRejectedValue(new Error('Database constraint violation'));

      const res = await app.request('/improved-responses', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(newImprovedResponseInput),
      });

      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data).toHaveProperty(
        'error',
        'An unexpected database error occurred. Please try again.',
      );
    });

    it('should handle malformed JSON', async () => {
      const res = await app.request('/improved-responses', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: '{"invalid": json}',
      });

      expect(res.status).toBe(400);
    });

    it('should handle empty request body', async () => {
      const res = await app.request('/improved-responses', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: '',
      });

      expect(res.status).toBe(400);
    });
  });

  describe('Query Parameters & Edge Cases', () => {
    it('should pass all query parameters to connector (no conditional logic)', async () => {
      const allResponses = [
        {
          id: '123e4567-e89b-12d3-a456-426614174000',
          agent_id: '123e4567-e89b-12d3-a456-426614174002',
          skill_id: '123e4567-e89b-12d3-a456-426614174004',
          log_id: '123e4567-e89b-12d3-a456-426614174003',
          original_response_body: { original: 'content' },
          improved_response_body: { improved: 'content' },
          created_at: '2023-01-01T00:00:00.000Z',
          updated_at: '2023-01-01T00:00:00.000Z',
        },
        {
          id: '123e4567-e89b-12d3-a456-426614174001',
          agent_id: '123e4567-e89b-12d3-a456-426614174002',
          skill_id: '123e4567-e89b-12d3-a456-426614174004',
          log_id: '123e4567-e89b-12d3-a456-426614174004',
          original_response_body: { original: 'content2' },
          improved_response_body: { improved: 'content2' },
          created_at: '2023-01-01T00:00:00.000Z',
          updated_at: '2023-01-01T00:00:00.000Z',
        },
      ];

      vi.mocked(
        mockUserDataStorageConnector.getImprovedResponse,
      ).mockResolvedValue(allResponses);

      // Test with valid parameters defined in the schema
      // Note: In URLs, limit and offset are strings, but Zod coerces them to numbers
      const res = await app.request(
        '/improved-responses?id=123e4567-e89b-12d3-a456-426614174000&limit=10&offset=0',
        {
          method: 'GET',
        },
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual(allResponses);

      // Should pass all valid parameters to the connector
      // Note: After Zod parsing, limit and offset are numbers
      expect(
        mockUserDataStorageConnector.getImprovedResponse,
      ).toHaveBeenCalledWith(expect.anything(), {
        id: '123e4567-e89b-12d3-a456-426614174000',
        limit: 10,
        offset: 0,
      });
    });

    it('should reject malformed UUIDs', async () => {
      const res = await app.request('/improved-responses?id=not-a-uuid', {
        method: 'GET',
      });

      expect(res.status).toBe(400);
    });
  });

  describe('API Validation', () => {
    it('should reject CREATE with missing required fields', async () => {
      const res = await app.request('/improved-responses', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          agent_id: '123e4567-e89b-12d3-a456-426614174002',
          // Missing log_id, original_response_body, improved_response_body
        }),
      });

      expect(res.status).toBe(400);
    });

    it('should reject CREATE with invalid UUID format', async () => {
      const res = await app.request('/improved-responses', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          agent_id: 'invalid-uuid',
          log_id: '123e4567-e89b-12d3-a456-426614174003',
          original_response_body: { original: 'content' },
          improved_response_body: { improved: 'content' },
        }),
      });

      expect(res.status).toBe(400);
    });

    it('should reject CREATE when user tries to override id field', async () => {
      const res = await app.request('/improved-responses', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          agent_id: '123e4567-e89b-12d3-a456-426614174002',
          log_id: '123e4567-e89b-12d3-a456-426614174003',
          original_response_body: { original: 'content' },
          improved_response_body: { improved: 'content' },
          id: 'user-provided-id', // Should be rejected
        }),
      });

      expect(res.status).toBe(400);
    });

    it('should reject CREATE when user tries to override created_at field', async () => {
      const res = await app.request('/improved-responses', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          agent_id: '123e4567-e89b-12d3-a456-426614174002',
          log_id: '123e4567-e89b-12d3-a456-426614174003',
          original_response_body: { original: 'content' },
          improved_response_body: { improved: 'content' },
          created_at: '2022-01-01T00:00:00.000Z', // Should be rejected
        }),
      });

      expect(res.status).toBe(400);
    });

    it('should reject CREATE when user tries to override updated_at field', async () => {
      const res = await app.request('/improved-responses', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          agent_id: '123e4567-e89b-12d3-a456-426614174002',
          log_id: '123e4567-e89b-12d3-a456-426614174003',
          original_response_body: { original: 'content' },
          improved_response_body: { improved: 'content' },
          updated_at: '2022-01-01T00:00:00.000Z', // Should be rejected
        }),
      });

      expect(res.status).toBe(400);
    });

    it('should reject CREATE with additional properties (strict mode)', async () => {
      const res = await app.request('/improved-responses', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          agent_id: '123e4567-e89b-12d3-a456-426614174002',
          log_id: '123e4567-e89b-12d3-a456-426614174003',
          original_response_body: { original: 'content' },
          improved_response_body: { improved: 'content' },
          extra_field: 'should be rejected',
        }),
      });

      expect(res.status).toBe(400);
    });

    it('should reject PATCH when user tries to override id field', async () => {
      const res = await app.request(
        '/improved-responses/123e4567-e89b-12d3-a456-426614174000',
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            improved_response_body: { improved: 'updated content' },
            id: 'user-provided-id', // Should be rejected
          }),
        },
      );

      expect(res.status).toBe(400);
    });

    it('should reject PATCH when user tries to override created_at field', async () => {
      const res = await app.request(
        '/improved-responses/123e4567-e89b-12d3-a456-426614174000',
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            improved_response_body: { improved: 'updated content' },
            created_at: '2022-01-01T00:00:00.000Z', // Should be rejected
          }),
        },
      );

      expect(res.status).toBe(400);
    });

    it('should reject PATCH when user tries to override updated_at field', async () => {
      const res = await app.request(
        '/improved-responses/123e4567-e89b-12d3-a456-426614174000',
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            improved_response_body: { improved: 'updated content' },
            updated_at: '2022-01-01T00:00:00.000Z', // Should be rejected
          }),
        },
      );

      expect(res.status).toBe(400);
    });

    it('should reject PATCH when user tries to override agent_id', async () => {
      const res = await app.request(
        '/improved-responses/123e4567-e89b-12d3-a456-426614174000',
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            improved_response_body: { improved: 'updated content' },
            agent_id: '123e4567-e89b-12d3-a456-426614174999', // Should be rejected
          }),
        },
      );

      expect(res.status).toBe(400);
    });

    it('should reject PATCH when user tries to override log_id', async () => {
      const res = await app.request(
        '/improved-responses/123e4567-e89b-12d3-a456-426614174000',
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            improved_response_body: { improved: 'updated content' },
            log_id: '123e4567-e89b-12d3-a456-426614174999', // Should be rejected
          }),
        },
      );

      expect(res.status).toBe(400);
    });

    it('should reject PATCH when user tries to override original_response_body', async () => {
      const res = await app.request(
        '/improved-responses/123e4567-e89b-12d3-a456-426614174000',
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            improved_response_body: { improved: 'updated content' },
            original_response_body: { malicious: 'data' }, // Should be rejected
          }),
        },
      );

      expect(res.status).toBe(400);
    });

    it('should reject PATCH with additional properties (strict mode)', async () => {
      const res = await app.request(
        '/improved-responses/123e4567-e89b-12d3-a456-426614174000',
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            improved_response_body: { improved: 'updated content' },
            extra_field: 'should be rejected',
          }),
        },
      );

      expect(res.status).toBe(400);
    });

    it('should reject GET with additional query parameters (strict mode)', async () => {
      const res = await app.request(
        '/improved-responses?id=123e4567-e89b-12d3-a456-426614174000&extra_param=value',
        {
          method: 'GET',
        },
      );

      expect(res.status).toBe(400);
    });
  });

  describe('Middleware Integration & Authentication', () => {
    let authenticatedApp: Hono<AppEnv>;
    const factory = createFactory<AppEnv>();

    beforeEach(() => {
      // Create app with full middleware stack for integration testing
      authenticatedApp = new Hono<AppEnv>();

      // Add middleware stack
      authenticatedApp.use('*', commonVariablesMiddleware);
      authenticatedApp.use(
        '*',
        userDataMiddleware(factory, () => mockUserDataStorageConnector),
      );
      authenticatedApp.use('*', authenticatedMiddleware(factory));

      // Apply routes
      authenticatedApp.route('/improved-responses', improvedResponsesRouter);
    });

    it('should require authentication for all endpoints', async () => {
      const endpoints = [
        {
          method: 'GET',
          path: '/improved-responses?id=123e4567-e89b-12d3-a456-426614174000',
        },
        { method: 'POST', path: '/improved-responses' },
        {
          method: 'PATCH',
          path: '/improved-responses?id=123e4567-e89b-12d3-a456-426614174000',
        },
        {
          method: 'DELETE',
          path: '/improved-responses?id=123e4567-e89b-12d3-a456-426614174000',
        },
      ];

      for (const endpoint of endpoints) {
        const res = await authenticatedApp.request(endpoint.path, {
          method: endpoint.method,
          headers:
            endpoint.method === 'POST' || endpoint.method === 'PATCH'
              ? { 'Content-Type': 'application/json' }
              : undefined,
          body:
            endpoint.method === 'POST' || endpoint.method === 'PATCH'
              ? JSON.stringify({ improved_response_body: { test: 'data' } })
              : undefined,
        });

        expect(res.status).toBe(401);
      }
    });

    it('should accept valid bearer token authentication', async () => {
      vi.mocked(
        mockUserDataStorageConnector.getImprovedResponse,
      ).mockResolvedValue([]);

      const res = await authenticatedApp.request(
        '/improved-responses?id=123e4567-e89b-12d3-a456-426614174000',
        {
          headers: { Authorization: 'Bearer test-bearer-token' },
        },
      );

      expect(res.status).toBe(200);
    });

    it('should reject invalid bearer tokens', async () => {
      const res = await authenticatedApp.request(
        '/improved-responses?id=123e4567-e89b-12d3-a456-426614174000',
        {
          headers: { Authorization: 'Bearer invalid-token' },
        },
      );

      expect(res.status).toBe(401);
    });

    it('should work correctly with full middleware stack', async () => {
      const mockResponse: ImprovedResponse = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        agent_id: '123e4567-e89b-12d3-a456-426614174002',
        skill_id: '123e4567-e89b-12d3-a456-426614174004',
        log_id: '123e4567-e89b-12d3-a456-426614174003',
        original_response_body: { original: 'content' },
        improved_response_body: { improved: 'content' },
        created_at: '2023-01-01T00:00:00.000Z',
        updated_at: '2023-01-01T00:00:00.000Z',
      };

      vi.mocked(
        mockUserDataStorageConnector.getImprovedResponse,
      ).mockResolvedValue([mockResponse]);

      const res = await authenticatedApp.request(
        '/improved-responses?id=123e4567-e89b-12d3-a456-426614174000',
        {
          headers: { Authorization: 'Bearer test-bearer-token' },
        },
      );

      expect(res.status).toBe(200);
      const data = (await res.json()) as ImprovedResponse[];
      expect(data).toEqual([mockResponse]);
    });
  });
});
