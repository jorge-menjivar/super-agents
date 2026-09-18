import { toolMiddleware } from '@api/middlewares/tool';
import type { UserDataStorageConnector } from '@api/types/connector';
import type { AppContext } from '@api/types/hono';
import { FunctionName } from '@shared/types/api/request';
import type { ChatCompletionTool } from '@shared/types/api/routes/shared/tools';
import type { Next } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock getRuntimeKey to avoid workerd behavior
vi.mock('hono/adapter', () => ({
  getRuntimeKey: vi.fn().mockReturnValue('node'),
}));

// Mock crypto.subtle using vi.stubGlobal
vi.stubGlobal('crypto', {
  subtle: {
    digest: vi.fn(),
  },
});

// Mock TextEncoder
vi.stubGlobal(
  'TextEncoder',
  vi.fn(
    class {
      encode = vi.fn().mockReturnValue(new Uint8Array([97, 98, 99, 100]));
    },
  ),
);

// Mock Uint8Array for hash generation
const mockDigest = new Uint8Array([
  171, 205, 239, 18, 52, 86, 120, 154, 188, 222, 240, 18, 52, 86, 120, 154,
]);

describe('toolMiddleware', () => {
  let mockNext: Next;
  let mockCreateTool: ReturnType<typeof vi.fn>;
  const mockAgent = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    name: 'test-agent',
    metadata: {},
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  };

  let mockConnector: UserDataStorageConnector;

  const mockContext = {
    get: vi.fn(),
    set: vi.fn(),
    req: {},
    res: {},
    executionCtx: {
      waitUntil: vi.fn(),
    },
  } as unknown as AppContext;

  beforeEach(() => {
    vi.clearAllMocks();

    mockNext = vi.fn();
    mockCreateTool = vi.fn().mockResolvedValue({
      id: 'tool-id',
      agent_id: mockAgent.id,
      hash: 'abcdef1234567890abcdef1234567890abcdef12',
      type: 'function',
      name: 'test_function',
      raw_data: {},
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    });

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
      createTool: mockCreateTool,
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
      getSkillReadiness: vi.fn(),
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

    // Mock crypto.subtle.digest to return our mock digest
    vi.mocked(crypto.subtle.digest).mockResolvedValue(mockDigest.buffer);
  });

  describe('middleware execution', () => {
    it('should call next() first', async () => {
      mockContext.get = vi.fn().mockReturnValue(undefined);

      await toolMiddleware(mockContext, mockNext);

      expect(mockNext).toHaveBeenCalledTimes(1);
    });

    it('should do nothing if sa_request_data is not set', async () => {
      mockContext.get = vi.fn().mockReturnValue(undefined);

      await toolMiddleware(mockContext, mockNext);

      expect(mockNext).toHaveBeenCalledTimes(1);
      expect(mockCreateTool).not.toHaveBeenCalled();
    });

    it('should do nothing for non-tool endpoints', async () => {
      const requestData = {
        functionName: FunctionName.EMBED,
        requestBody: {},
      };

      mockContext.get = vi.fn().mockImplementation((key: string) => {
        if (key === 'sa_request_data') return requestData;
        return undefined;
      });

      await toolMiddleware(mockContext, mockNext);

      expect(mockNext).toHaveBeenCalledTimes(1);
      expect(mockCreateTool).not.toHaveBeenCalled();
    });
  });

  describe('chat completion tool capture', () => {
    it('should capture tools from chat completion request', async () => {
      const tools: ChatCompletionTool[] = [
        {
          type: 'function',
          function: {
            name: 'test_function',
            description: 'Test function',
            parameters: { type: 'object' },
          },
        },
      ];

      const requestData = {
        functionName: FunctionName.CHAT_COMPLETE,
        requestBody: {
          model: 'gpt-3.5-turbo',
          messages: [],
          tools,
        },
      };

      mockContext.get = vi.fn().mockImplementation((key: string) => {
        if (key === 'sa_request_data') return requestData;
        if (key === 'agent') return mockAgent;
        if (key === 'user_data_storage_connector') return mockConnector;
        return undefined;
      });

      await toolMiddleware(mockContext, mockNext);

      expect(mockNext).toHaveBeenCalledTimes(1);
      expect(mockCreateTool).toHaveBeenCalledTimes(1);
      expect(mockCreateTool).toHaveBeenCalledWith(expect.anything(), {
        agent_id: mockAgent.id,
        hash: expect.any(String),
        type: 'function',
        name: 'test_function',
        raw_data: tools[0],
      });
    });

    it('should handle empty tools array in chat completion', async () => {
      const requestData = {
        functionName: FunctionName.CHAT_COMPLETE,
        requestBody: {
          model: 'gpt-3.5-turbo',
          messages: [],
          tools: [],
        },
      };

      mockContext.get = vi.fn().mockImplementation((key: string) => {
        if (key === 'sa_request_data') return requestData;
        if (key === 'agent') return mockAgent;
        if (key === 'user_data_storage_connector') return mockConnector;
        return undefined;
      });

      await toolMiddleware(mockContext, mockNext);

      expect(mockCreateTool).not.toHaveBeenCalled();
    });

    it('should handle missing tools in chat completion', async () => {
      const requestData = {
        functionName: FunctionName.CHAT_COMPLETE,
        requestBody: {
          model: 'gpt-3.5-turbo',
          messages: [],
        },
      };

      mockContext.get = vi.fn().mockImplementation((key: string) => {
        if (key === 'sa_request_data') return requestData;
        if (key === 'agent') return mockAgent;
        if (key === 'user_data_storage_connector') return mockConnector;
        return undefined;
      });

      await toolMiddleware(mockContext, mockNext);

      expect(mockCreateTool).not.toHaveBeenCalled();
    });
  });

  describe('responses API tool capture', () => {
    it('should capture tools from create model response request', async () => {
      const tools = [
        {
          type: 'function',
          function: {
            name: 'response_function',
            description: 'Response function',
            parameters: { type: 'object' },
          },
        },
      ];

      const requestData = {
        functionName: FunctionName.CREATE_MODEL_RESPONSE,
        requestBody: {
          input: 'test input',
          model: 'gpt-4',
          tools,
        },
      };

      mockContext.get = vi.fn().mockImplementation((key: string) => {
        if (key === 'sa_request_data') return requestData;
        if (key === 'agent') return mockAgent;
        if (key === 'user_data_storage_connector') return mockConnector;
        return undefined;
      });

      await toolMiddleware(mockContext, mockNext);

      expect(mockCreateTool).toHaveBeenCalledTimes(1);
      expect(mockCreateTool).toHaveBeenCalledWith(expect.anything(), {
        agent_id: mockAgent.id,
        hash: 'abcdef123456789abcdef0123456789a',
        type: 'function',
        name: 'response_function',
        raw_data: tools[0],
      });
    });
  });

  describe('tool hash generation', () => {
    it('should generate consistent hash for the same tool', async () => {
      const tool = {
        type: 'function',
        function: {
          name: 'hash_test',
          description: 'Hash test function',
        },
      };

      const requestData = {
        functionName: FunctionName.CHAT_COMPLETE,
        requestBody: {
          model: 'gpt-3.5-turbo',
          messages: [],
          tools: [tool],
        },
      };

      mockContext.get = vi.fn().mockImplementation((key: string) => {
        if (key === 'sa_request_data') return requestData;
        if (key === 'agent') return mockAgent;
        if (key === 'user_data_storage_connector') return mockConnector;
        return undefined;
      });

      // Call middleware twice
      await toolMiddleware(mockContext, mockNext);
      await toolMiddleware(mockContext, mockNext);

      // Both calls should generate the same hash
      expect(mockCreateTool).toHaveBeenCalledTimes(2);
      const call1 = mockCreateTool.mock.calls[0][1];
      const call2 = mockCreateTool.mock.calls[1][1];
      expect(call1.hash).toBe(call2.hash);
      expect(call1.hash).toBe('abcdef123456789abcdef0123456789a');
    });

    it('should handle tools with missing function name', async () => {
      const tool = {
        type: 'function',
        function: {
          description: 'Function without name',
        },
      };

      const requestData = {
        functionName: FunctionName.CHAT_COMPLETE,
        requestBody: {
          model: 'gpt-3.5-turbo',
          messages: [],
          tools: [tool],
        },
      };

      mockContext.get = vi.fn().mockImplementation((key: string) => {
        if (key === 'sa_request_data') return requestData;
        if (key === 'agent') return mockAgent;
        if (key === 'user_data_storage_connector') return mockConnector;
        return undefined;
      });

      await toolMiddleware(mockContext, mockNext);

      expect(mockCreateTool).toHaveBeenCalledWith(expect.anything(), {
        agent_id: mockAgent.id,
        hash: 'abcdef123456789abcdef0123456789a',
        type: 'function',
        name: '',
        raw_data: tool,
      });
    });

    it('should handle tools with no function property', async () => {
      const tool = {
        type: 'function',
      };

      const requestData = {
        functionName: FunctionName.CHAT_COMPLETE,
        requestBody: {
          model: 'gpt-3.5-turbo',
          messages: [],
          tools: [tool],
        },
      };

      mockContext.get = vi.fn().mockImplementation((key: string) => {
        if (key === 'sa_request_data') return requestData;
        if (key === 'agent') return mockAgent;
        if (key === 'user_data_storage_connector') return mockConnector;
        return undefined;
      });

      await toolMiddleware(mockContext, mockNext);

      expect(mockCreateTool).toHaveBeenCalledWith(expect.anything(), {
        agent_id: mockAgent.id,
        hash: 'abcdef123456789abcdef0123456789a',
        type: 'function',
        name: '',
        raw_data: tool,
      });
    });
  });

  describe('error handling', () => {
    it('should continue execution if createTool throws an error', async () => {
      const tools = [
        {
          type: 'function',
          function: {
            name: 'error_function',
          },
        },
      ];

      const requestData = {
        functionName: FunctionName.CHAT_COMPLETE,
        requestBody: {
          model: 'gpt-3.5-turbo',
          messages: [],
          tools,
        },
      };

      const errorMockCreateTool = vi
        .fn()
        .mockRejectedValue(new Error('Database error'));

      const errorMockConnector = {
        ...mockConnector,
        createTool: errorMockCreateTool,
      };

      mockContext.get = vi.fn().mockImplementation((key: string) => {
        if (key === 'sa_request_data') return requestData;
        if (key === 'agent') return mockAgent;
        if (key === 'user_data_storage_connector') return errorMockConnector;
        return undefined;
      });

      // Should not throw
      await expect(
        toolMiddleware(mockContext, mockNext),
      ).resolves.toBeUndefined();
      expect(mockNext).toHaveBeenCalledTimes(1);
    });
  });

  describe('multiple tools handling', () => {
    it('should capture multiple tools from the same request', async () => {
      const tools = [
        {
          type: 'function',
          function: { name: 'function_1' },
        },
        {
          type: 'function',
          function: { name: 'function_2' },
        },
        {
          type: 'function',
          function: { name: 'function_3' },
        },
      ];

      const requestData = {
        functionName: FunctionName.CHAT_COMPLETE,
        requestBody: {
          model: 'gpt-3.5-turbo',
          messages: [],
          tools,
        },
      };

      mockContext.get = vi.fn().mockImplementation((key: string) => {
        if (key === 'sa_request_data') return requestData;
        if (key === 'agent') return mockAgent;
        if (key === 'user_data_storage_connector') return mockConnector;
        return undefined;
      });

      await toolMiddleware(mockContext, mockNext);

      expect(mockCreateTool).toHaveBeenCalledTimes(3);

      const call1 = mockCreateTool.mock.calls[0][1];
      const call2 = mockCreateTool.mock.calls[1][1];
      const call3 = mockCreateTool.mock.calls[2][1];

      expect(call1.name).toBe('function_1');
      expect(call2.name).toBe('function_2');
      expect(call3.name).toBe('function_3');

      // All should have the same agent_id
      expect(call1.agent_id).toBe(mockAgent.id);
      expect(call2.agent_id).toBe(mockAgent.id);
      expect(call3.agent_id).toBe(mockAgent.id);
    });
  });
});
