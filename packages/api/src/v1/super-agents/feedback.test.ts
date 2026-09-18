import type { AppEnv } from '@api/types/hono';
import { scheduleFeedbackReevaluation } from '@api/utils/super-agents/feedback-reevaluation';
import { feedbacksRouter } from '@api/v1/super-agents/feedbacks';
import type { Feedback } from '@shared/types/data/feedback';
import { Hono } from 'hono';
import {
  beforeEach,
  describe,
  expect,
  it,
  type MockedFunction,
  vi,
} from 'vitest';

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
// Type the mocked functions
const mockGetFeedback =
  mockUserDataStorageConnector.getFeedback as MockedFunction<
    typeof mockUserDataStorageConnector.getFeedback
  >;
const mockCreateFeedback =
  mockUserDataStorageConnector.createFeedback as MockedFunction<
    typeof mockUserDataStorageConnector.createFeedback
  >;
const mockDeleteFeedback =
  mockUserDataStorageConnector.deleteFeedback as MockedFunction<
    typeof mockUserDataStorageConnector.deleteFeedback
  >;

// Mock uuid
// Feedback is the thumbs up/down evaluation: creating it schedules a re-run
// of the log's evaluations with the human verdict as judge context.
vi.mock('@api/utils/super-agents/feedback-reevaluation', () => ({
  scheduleFeedbackReevaluation: vi.fn(),
}));

vi.mock('uuid', () => ({
  v4: (): string => '123e4567-e89b-12d3-a456-426614174000',
}));

describe('Feedback API', () => {
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
    app.route('/feedback', feedbacksRouter);
  });

  describe('GET /feedback', () => {
    it('should return all feedback', async () => {
      const feedbackList: Feedback[] = [
        {
          id: '123e4567-e89b-12d3-a456-426614174000',
          log_id: '123e4567-e89b-12d3-a456-426614174002',
          score: 0.8,
          feedback: 'Great response',
          created_at: '2023-01-01T00:00:00.000Z',
          updated_at: '2023-01-01T00:00:00.000Z',
        },
      ];

      mockGetFeedback.mockResolvedValue(feedbackList);

      const res = await app.request('/feedback');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual(feedbackList);
      expect(mockGetFeedback).toHaveBeenCalledWith(expect.anything(), {});
    });

    it('should return feedback by ID using query parameter', async () => {
      const feedback: Feedback = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        log_id: '123e4567-e89b-12d3-a456-426614174002',
        score: 0.8,
        feedback: 'Great response',
        created_at: '2023-01-01T00:00:00.000Z',
        updated_at: '2023-01-01T00:00:00.000Z',
      };

      mockGetFeedback.mockResolvedValue([feedback]);

      const res = await app.request(
        '/feedback?id=123e4567-e89b-12d3-a456-426614174000',
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual([feedback]);
      expect(mockGetFeedback).toHaveBeenCalledWith(expect.anything(), {
        id: '123e4567-e89b-12d3-a456-426614174000',
      });
    });

    it('should return empty array if feedback not found', async () => {
      mockGetFeedback.mockResolvedValue([]);

      const res = await app.request(
        '/feedback?id=123e4567-e89b-12d3-a456-426614174000',
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual([]);
    });

    it('should pass query parameters to connector', async () => {
      const feedbackList: Feedback[] = [];
      mockGetFeedback.mockResolvedValue(feedbackList);

      const res = await app.request(
        '/feedback?log_id=123e4567-e89b-12d3-a456-426614174002&limit=10&offset=0',
      );

      expect(res.status).toBe(200);
      expect(mockGetFeedback).toHaveBeenCalledWith(expect.anything(), {
        log_id: '123e4567-e89b-12d3-a456-426614174002',
        limit: 10,
        offset: 0,
      });
    });

    it('should read a comma-separated list of logs as one query', async () => {
      mockGetFeedback.mockResolvedValue([]);

      const res = await app.request(
        '/feedback?log_ids=123e4567-e89b-12d3-a456-426614174002,123e4567-e89b-12d3-a456-426614174003',
      );

      expect(res.status).toBe(200);
      expect(mockGetFeedback).toHaveBeenCalledWith(expect.anything(), {
        log_ids: [
          '123e4567-e89b-12d3-a456-426614174002',
          '123e4567-e89b-12d3-a456-426614174003',
        ],
      });
    });

    it('should reject an empty list of logs rather than answer with every verdict', async () => {
      const res = await app.request('/feedback?log_ids=');

      expect(res.status).toBe(400);
      expect(mockGetFeedback).not.toHaveBeenCalled();
    });

    it('should reject invalid query parameters', async () => {
      const res = await app.request('/feedback?id=invalid-uuid');
      expect(res.status).toBe(400);
      expect(mockGetFeedback).not.toHaveBeenCalled();
    });

    it('should reject additional query parameters (strict mode)', async () => {
      const res = await app.request(
        '/feedback?id=123e4567-e89b-12d3-a456-426614174000&extra_param=value',
      );
      expect(res.status).toBe(400);
      expect(mockGetFeedback).not.toHaveBeenCalled();
    });
  });

  describe('POST /feedback', () => {
    it('should create new feedback with auto-generated fields', async () => {
      const newFeedbackInput = {
        log_id: '123e4567-e89b-12d3-a456-426614174002',
        score: 0.8,
        feedback: 'Great response',
      };

      const createdFeedback: Feedback = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        ...newFeedbackInput,
        created_at: '2023-01-01T00:00:00.000Z',
        updated_at: '2023-01-01T00:00:00.000Z',
      };

      mockCreateFeedback.mockResolvedValue(createdFeedback);

      const res = await app.request('/feedback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(newFeedbackInput),
      });

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data).toEqual(createdFeedback);

      // Check that createFeedback was called with transformed data (id and timestamps added)
      expect(mockCreateFeedback).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          log_id: '123e4567-e89b-12d3-a456-426614174002',
          score: 0.8,
          feedback: 'Great response',
          id: expect.any(String),
          created_at: expect.any(String),
          updated_at: expect.any(String),
        }),
      );
    });

    it('schedules the re-evaluation with the created feedback', async () => {
      const createdFeedback: Feedback = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        log_id: '123e4567-e89b-12d3-a456-426614174002',
        score: 0,
        created_at: '2023-01-01T00:00:00.000Z',
        updated_at: '2023-01-01T00:00:00.000Z',
      };
      mockCreateFeedback.mockResolvedValue(createdFeedback);

      const res = await app.request('/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          log_id: '123e4567-e89b-12d3-a456-426614174002',
          score: 0,
        }),
      });

      expect(res.status).toBe(201);
      expect(scheduleFeedbackReevaluation).toHaveBeenCalledWith(
        expect.anything(),
        createdFeedback,
      );
    });

    it('should create feedback without optional feedback field', async () => {
      const newFeedbackInput = {
        log_id: '123e4567-e89b-12d3-a456-426614174002',
        score: 0.8,
      };

      const createdFeedback: Feedback = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        ...newFeedbackInput,
        created_at: '2023-01-01T00:00:00.000Z',
        updated_at: '2023-01-01T00:00:00.000Z',
      };

      mockCreateFeedback.mockResolvedValue(createdFeedback);

      const res = await app.request('/feedback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(newFeedbackInput),
      });

      expect(res.status).toBe(201);
    });

    it('should reject invalid input data', async () => {
      const res = await app.request('/feedback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          invalid: 'data',
        }),
      });

      expect(res.status).toBe(400);
      expect(mockCreateFeedback).not.toHaveBeenCalled();
    });

    it('should reject when user tries to override id field', async () => {
      const res = await app.request('/feedback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          log_id: '123e4567-e89b-12d3-a456-426614174002',
          score: 0.8,
          feedback: 'Great response',
          id: 'user-provided-id', // Should be rejected
        }),
      });

      expect(res.status).toBe(400);
      expect(mockCreateFeedback).not.toHaveBeenCalled();
    });

    it('should reject when user tries to override created_at field', async () => {
      const res = await app.request('/feedback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          log_id: '123e4567-e89b-12d3-a456-426614174002',
          score: 0.8,
          feedback: 'Great response',
          created_at: '2022-01-01T00:00:00.000Z', // Should be rejected
        }),
      });

      expect(res.status).toBe(400);
      expect(mockCreateFeedback).not.toHaveBeenCalled();
    });

    it('should reject when user tries to override updated_at field', async () => {
      const res = await app.request('/feedback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          log_id: '123e4567-e89b-12d3-a456-426614174002',
          score: 0.8,
          feedback: 'Great response',
          updated_at: '2022-01-01T00:00:00.000Z', // Should be rejected
        }),
      });

      expect(res.status).toBe(400);
      expect(mockCreateFeedback).not.toHaveBeenCalled();
    });

    it('should reject additional properties (strict mode)', async () => {
      const res = await app.request('/feedback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          log_id: '123e4567-e89b-12d3-a456-426614174002',
          score: 0.8,
          feedback: 'Great response',
          extra_field: 'should be rejected',
        }),
      });

      expect(res.status).toBe(400);
      expect(mockCreateFeedback).not.toHaveBeenCalled();
    });

    it('should validate score range', async () => {
      const res = await app.request('/feedback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          log_id: '123e4567-e89b-12d3-a456-426614174002',
          score: 1.5, // Out of range (0-1)
          feedback: 'Great response',
        }),
      });

      expect(res.status).toBe(400);
      expect(mockCreateFeedback).not.toHaveBeenCalled();
    });

    it('should validate UUID format for log_id', async () => {
      const res = await app.request('/feedback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          log_id: 'invalid-uuid',
          score: 0.8,
          feedback: 'Great response',
        }),
      });

      expect(res.status).toBe(400);
      expect(mockCreateFeedback).not.toHaveBeenCalled();
    });

    it('should require log_id field', async () => {
      const res = await app.request('/feedback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          // Missing log_id
          score: 0.8,
          feedback: 'Great response',
        }),
      });

      expect(res.status).toBe(400);
      expect(mockCreateFeedback).not.toHaveBeenCalled();
    });

    it('should require score field', async () => {
      const res = await app.request('/feedback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          log_id: '123e4567-e89b-12d3-a456-426614174002',
          // Missing score
          feedback: 'Great response',
        }),
      });

      expect(res.status).toBe(400);
      expect(mockCreateFeedback).not.toHaveBeenCalled();
    });

    it('should require both log_id and score fields', async () => {
      const res = await app.request('/feedback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          // Missing both required fields
          feedback: 'Great response',
        }),
      });

      expect(res.status).toBe(400);
      expect(mockCreateFeedback).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /feedback', () => {
    it('should delete existing feedback without prior existence check', async () => {
      mockDeleteFeedback.mockResolvedValue(undefined);

      const res = await app.request(
        '/feedback/123e4567-e89b-12d3-a456-426614174000',
        {
          method: 'DELETE',
        },
      );

      expect(res.status).toBe(204);

      // Should NOT call getFeedback (no existence check)
      expect(mockGetFeedback).not.toHaveBeenCalled();

      // Should directly call deleteFeedback
      expect(mockDeleteFeedback).toHaveBeenCalledWith(
        expect.anything(),
        '123e4567-e89b-12d3-a456-426614174000',
      );
    });

    it('should reject invalid UUID in query parameter', async () => {
      const res = await app.request('/feedback/invalid-uuid', {
        method: 'DELETE',
      });

      expect(res.status).toBe(400);
      expect(mockDeleteFeedback).not.toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('should handle database errors during GET', async () => {
      mockGetFeedback.mockRejectedValue(
        new Error('Database connection failed'),
      );

      const res = await app.request('/feedback');

      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data).toHaveProperty(
        'error',
        'An unexpected database error occurred. Please try again.',
      );
    });

    it('should handle database errors during CREATE', async () => {
      const newFeedbackInput = {
        log_id: '123e4567-e89b-12d3-a456-426614174002',
        score: 0.8,
        feedback: 'Great response',
      };

      mockCreateFeedback.mockRejectedValue(
        new Error('Database constraint violation'),
      );

      const res = await app.request('/feedback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(newFeedbackInput),
      });

      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data).toHaveProperty(
        'error',
        'An unexpected database error occurred. Please try again.',
      );
    });

    it('should handle database errors during DELETE', async () => {
      mockDeleteFeedback.mockRejectedValue(new Error('Database delete failed'));

      const res = await app.request(
        '/feedback/123e4567-e89b-12d3-a456-426614174000',
        {
          method: 'DELETE',
        },
      );

      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data).toHaveProperty(
        'error',
        'An unexpected database error occurred. Please try again.',
      );
    });

    it('should handle malformed JSON', async () => {
      const res = await app.request('/feedback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: '{"invalid": json}',
      });

      expect(res.status).toBe(400);
    });

    it('should handle empty request body', async () => {
      const res = await app.request('/feedback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: '',
      });

      expect(res.status).toBe(400);
    });
  });
});
