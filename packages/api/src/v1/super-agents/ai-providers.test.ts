import type { AppEnv } from '@api/types/hono';
import { aiProvidersRouter } from '@api/v1/super-agents/ai-providers';
import type { AIProviderConfig } from '@shared/types/data/ai-provider';
import { Hono } from 'hono';
import { testClient } from 'hono/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  // Log methods
  getLogs: vi.fn(),
  getLogSummaries: vi.fn(),
  deleteLog: vi.fn(),
  // Dataset-Log Bridge methods
  getDatasetLogs: vi.fn(),
  addLogsToDataset: vi.fn(),
  removeLogsFromDataset: vi.fn(),
  // Evaluation run methods
  getEvaluationRuns: vi.fn(),
  createEvaluationRun: vi.fn(),
  updateEvaluationRun: vi.fn(),
  deleteEvaluationRun: vi.fn(),
  // Log Output methods
  getLogOutputs: vi.fn(),
  createLogOutput: vi.fn(),
  deleteLogOutput: vi.fn(),
  // AI Provider methods
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
  getSkillSummaries: vi.fn(),
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
  .route('/', aiProvidersRouter);

describe('AI Providers API - Schema Endpoints', () => {
  const client = testClient(app);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /schemas', () => {
    it('should return 200 with all provider schemas', async () => {
      const res = await client.schemas.$get();

      expect(res.status).toBe(200);
      const data = await res.json();

      // Verify response structure
      expect(data).toBeDefined();
      expect(typeof data).toBe('object');

      // Check that ollama schema is included
      expect(data.ollama).toBeDefined();
      expect(data.ollama.hasCustomFields).toBe(true);
      expect(data.ollama.isAPIKeyRequired).toBe(false);
      expect(data.ollama.schema).toBeDefined();

      // Check that openai schema is included
      expect(data.openai).toBeDefined();
      expect(data.openai.hasCustomFields).toBe(false);
      expect(data.openai.isAPIKeyRequired).toBe(true);
    });

    it('should include schema properties for providers with custom fields', async () => {
      const res = await client.schemas.$get();

      expect(res.status).toBe(200);
      const data = await res.json();

      // Verify Ollama has custom_host in schema
      if (
        'ollama' in data &&
        data.ollama &&
        'schema' in data.ollama &&
        data.ollama.schema
      ) {
        const schema = data.ollama.schema as {
          properties?: Record<string, { description?: string }>;
        };
        expect(schema.properties).toBeDefined();
        expect(schema.properties?.custom_host).toBeDefined();
        expect(schema.properties?.custom_host?.description).toContain('Ollama');
      }
    });
  });

  describe('GET /schemas/:provider', () => {
    it('should return 200 with schema for Ollama provider', async () => {
      const res = await client.schemas[':provider'].$get({
        param: { provider: 'ollama' },
      });

      expect(res.status).toBe(200);
      const data = await res.json();

      if (
        'hasCustomFields' in data &&
        data.hasCustomFields &&
        'schema' in data &&
        data.schema
      ) {
        expect(data.hasCustomFields).toBe(true);
        expect(data.isAPIKeyRequired).toBe(false);
        expect(data.schema).toBeDefined();
        const schema = data.schema as { properties?: Record<string, unknown> };
        expect(schema.properties?.custom_host).toBeDefined();
      }
    });

    it('should return 200 with schema for OpenAI provider', async () => {
      const res = await client.schemas[':provider'].$get({
        param: { provider: 'openai' },
      });

      expect(res.status).toBe(200);
      const data = await res.json();

      if ('hasCustomFields' in data) {
        expect(data.hasCustomFields).toBe(false);
        expect(data.isAPIKeyRequired).toBe(true);
      }
    });

    it('should return 404 for non-existent provider', async () => {
      const res = await client.schemas[':provider'].$get({
        param: { provider: 'non-existent-provider' },
      });

      expect(res.status).toBe(404);
      const data = await res.json();
      if ('error' in data) {
        expect(data.error).toContain('not found');
      }
    });

    it('should return correct isAPIKeyRequired flag for various providers', async () => {
      // Test Ollama (optional API key)
      const ollamaRes = await client.schemas[':provider'].$get({
        param: { provider: 'ollama' },
      });
      const ollamaData = await ollamaRes.json();
      if ('isAPIKeyRequired' in ollamaData) {
        expect(ollamaData.isAPIKeyRequired).toBe(false);
      }

      // Test Anthropic (required API key)
      const anthropicRes = await client.schemas[':provider'].$get({
        param: { provider: 'anthropic' },
      });
      const anthropicData = await anthropicRes.json();
      if ('isAPIKeyRequired' in anthropicData) {
        expect(anthropicData.isAPIKeyRequired).toBe(true);
      }
    });
  });
});

describe('AI Providers API - CRUD Endpoints', () => {
  const client = testClient(app);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /', () => {
    it('should return 200 on successful fetch', async () => {
      const mockProviders: AIProviderConfig[] = [
        {
          id: '123e4567-e89b-12d3-a456-426614174000',
          ai_provider: 'openai',
          name: 'Production Key',
          api_key: 'sk-test',
          custom_fields: {},
          created_at: '2023-01-01T00:00:00.000Z',
          updated_at: '2023-01-01T00:00:00.000Z',
        },
      ];
      mockUserDataStorageConnector.getAIProviderAPIKeys.mockResolvedValue(
        mockProviders,
      );

      const res = await client.index.$get({
        query: {},
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual(mockProviders);
    });

    it('should return 500 on database error', async () => {
      mockUserDataStorageConnector.getAIProviderAPIKeys.mockRejectedValue(
        new Error('Database connection failed'),
      );

      const res = await client.index.$get({
        query: {},
      });

      expect(res.status).toBe(500);
    });
  });

  describe('POST /', () => {
    it('should return 201 on successful creation', async () => {
      const newProvider = {
        ai_provider: 'openai',
        name: 'Test Key',
        api_key: 'sk-test',
        custom_fields: {},
      };
      const createdProvider = {
        ...newProvider,
        id: '123e4567-e89b-12d3-a456-426614174000',
        created_at: '2023-01-01T00:00:00.000Z',
        updated_at: '2023-01-01T00:00:00.000Z',
      };
      mockUserDataStorageConnector.createAIProvider.mockResolvedValue(
        createdProvider,
      );

      const res = await client.index.$post({
        json: newProvider,
      });

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data).toEqual(createdProvider);
    });

    it('should return 500 on database error', async () => {
      mockUserDataStorageConnector.createAIProvider.mockRejectedValue(
        new Error('Database error'),
      );

      const res = await client.index.$post({
        json: {
          ai_provider: 'openai',
          name: 'Test Key',
          api_key: 'sk-test',
          custom_fields: {},
        },
      });

      expect(res.status).toBe(500);
    });

    it('should accept Ollama provider with custom_fields', async () => {
      const newProvider = {
        ai_provider: 'ollama',
        name: 'Local Ollama',
        api_key: null,
        custom_fields: {
          custom_host: 'http://localhost:11434',
        },
      };
      const createdProvider = {
        ...newProvider,
        id: '123e4567-e89b-12d3-a456-426614174000',
        created_at: '2023-01-01T00:00:00.000Z',
        updated_at: '2023-01-01T00:00:00.000Z',
      };
      mockUserDataStorageConnector.createAIProvider.mockResolvedValue(
        createdProvider,
      );

      const res = await client.index.$post({
        json: newProvider,
      });

      expect(res.status).toBe(201);
      const data = await res.json();
      if ('custom_fields' in data) {
        const customFields = data.custom_fields as Record<string, unknown>;
        expect(customFields?.custom_host).toBe('http://localhost:11434');
      }
    });
  });

  describe('PATCH /:id', () => {
    it('should return 200 on successful update', async () => {
      const updateData = {
        ai_provider: 'openai',
        name: 'Updated Key',
      };
      const updatedProvider = {
        ...updateData,
        id: '123e4567-e89b-12d3-a456-426614174000',
        api_key: 'sk-test',
        custom_fields: {},
        created_at: '2023-01-01T00:00:00.000Z',
        updated_at: '2023-01-02T00:00:00.000Z',
      };
      mockUserDataStorageConnector.updateAIProvider.mockResolvedValue(
        updatedProvider,
      );

      const res = await client[':id'].$patch({
        param: { id: '123e4567-e89b-12d3-a456-426614174000' },
        json: updateData,
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual(updatedProvider);
    });

    it('should return 500 on database error', async () => {
      mockUserDataStorageConnector.updateAIProvider.mockRejectedValue(
        new Error('Database error'),
      );

      const res = await client[':id'].$patch({
        param: { id: '123e4567-e89b-12d3-a456-426614174000' },
        json: { name: 'Updated Key' },
      });

      expect(res.status).toBe(500);
    });
  });

  describe('DELETE /:id', () => {
    it('should return 200 on successful deletion', async () => {
      mockUserDataStorageConnector.deleteAIProvider.mockResolvedValue(
        undefined,
      );

      const res = await client[':id'].$delete({
        param: { id: '123e4567-e89b-12d3-a456-426614174000' },
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      if ('success' in data) {
        expect(data.success).toBe(true);
      }
    });

    it('should return 500 on database error', async () => {
      mockUserDataStorageConnector.deleteAIProvider.mockRejectedValue(
        new Error('Database error'),
      );

      const res = await client[':id'].$delete({
        param: { id: '123e4567-e89b-12d3-a456-426614174000' },
      });

      expect(res.status).toBe(500);
    });
  });
});
