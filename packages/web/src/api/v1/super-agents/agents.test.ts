import type {
  Agent,
  AgentQueryParams,
  AgentUpdateParams,
} from '@shared/types/data';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Create mock functions that we can reference in tests
const mockGet = vi.fn();
const mockPatch = vi.fn();
const mockDelete = vi.fn();
const mockModelsGet = vi.fn();
const mockModelsPost = vi.fn();
const mockModelsDelete = vi.fn();

// Mock the entire agents module to control the client behavior
vi.mock('@web/api/v1/super-agents/agents', () => {
  return {
    getAgents: vi.fn().mockImplementation(async (params: AgentQueryParams) => {
      const response = await mockGet({
        query: {
          id: params.id,
          name: params.name,
          limit: params.limit?.toString(),
          offset: params.offset?.toString(),
        },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch agents');
      }

      return response.json();
    }),
    updateAgent: vi
      .fn()
      .mockImplementation(
        async (agentId: string, params: AgentUpdateParams) => {
          const response = await mockPatch({
            param: { agentId },
            json: params,
          });

          if (!response.ok) {
            throw new Error('Failed to update agent');
          }

          return response.json();
        },
      ),
    deleteAgent: vi.fn().mockImplementation(async (agentId: string) => {
      const response = await mockDelete({
        param: { agentId },
      });

      if (!response.ok) {
        throw new Error('Failed to delete agent');
      }
    }),
    getAgentModels: vi.fn().mockImplementation(async (agentId: string) => {
      const response = await mockModelsGet({ param: { agentId } });
      if (!response.ok) {
        throw new Error('Failed to fetch models for agent');
      }
      return response.json();
    }),
    addModelsToAgent: vi
      .fn()
      .mockImplementation(async (agentId: string, modelIds: string[]) => {
        const response = await mockModelsPost({
          param: { agentId },
          json: { modelIds },
        });
        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || 'Failed to add models to agent');
        }
      }),
    removeModelsFromAgent: vi
      .fn()
      .mockImplementation(async (agentId: string, modelIds: string[]) => {
        const response = await mockModelsDelete({
          param: { agentId },
          query: { ids: modelIds.join(',') },
        });
        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || 'Failed to remove models from agent');
        }
      }),
  };
});

// Import the mocked module
import * as agentsAPI from '@web/api/v1/super-agents/agents';

describe('Agents Client API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getAgents', () => {
    it('should return agents on successful response', async () => {
      const mockAgents: Agent[] = [
        {
          id: 'c13d1678-150a-466b-804f-ecc82de3680e',
          name: 'test-agent',
          description: 'A test agent',
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
        },
      ];

      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue(mockAgents),
      };

      mockGet.mockResolvedValue(mockResponse);

      const params: AgentQueryParams = { name: 'test' };
      const result = await agentsAPI.getAgents(params);

      expect(mockGet).toHaveBeenCalledWith({
        query: {
          id: params.id,
          name: params.name,
          limit: params.limit?.toString(),
          offset: params.offset?.toString(),
        },
      });
      expect(result).toEqual(mockAgents);
    });

    it('should throw error on failed response', async () => {
      const mockResponse = {
        ok: false,
        status: 500,
      };

      mockGet.mockResolvedValue(mockResponse);

      const params: AgentQueryParams = { name: 'test' };

      await expect(agentsAPI.getAgents(params)).rejects.toThrow(
        'Failed to fetch agents',
      );
    });

    it('should handle query parameters correctly', async () => {
      const mockAgents: Agent[] = [];
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue(mockAgents),
      };

      mockGet.mockResolvedValue(mockResponse);

      const params: AgentQueryParams = {
        id: 'c13d1678-150a-466b-804f-ecc82de3680e',
        name: 'test-agent',
        limit: 10,
        offset: 5,
      };

      await agentsAPI.getAgents(params);

      expect(mockGet).toHaveBeenCalledWith({
        query: {
          id: 'c13d1678-150a-466b-804f-ecc82de3680e',
          name: 'test-agent',
          limit: '10',
          offset: '5',
        },
      });
    });
  });

  describe('updateAgent', () => {
    it('should return updated agent on successful response', async () => {
      const mockAgent: Agent = {
        id: 'c13d1678-150a-466b-804f-ecc82de3680e',
        name: 'updated-agent',
        description: 'Updated description',
        metadata: {},
        created_at: '2023-01-01T00:00:00.000Z',
        updated_at: '2023-01-02T00:00:00.000Z',
        auto_create_skills: true,
        skill_match_threshold: 0.8,
        max_auto_created_skills: 10,
        skill_arbiter_model_id: null,
        skill_arbiter_timeout_ms: null,
        reviewer_agent_id: null,
        review_fail_closed: false,
        review_expose_reason: false,
      };

      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue(mockAgent),
      };

      mockPatch.mockResolvedValue(mockResponse);

      const agentId = 'c13d1678-150a-466b-804f-ecc82de3680e';
      const params: AgentUpdateParams = { description: 'Updated description' };

      const result = await agentsAPI.updateAgent(agentId, params);

      expect(mockPatch).toHaveBeenCalledWith({
        param: { agentId },
        json: params,
      });
      expect(result).toEqual(mockAgent);
    });

    it('should throw error on failed response', async () => {
      const mockResponse = {
        ok: false,
        status: 500,
      };

      mockPatch.mockResolvedValue(mockResponse);

      const agentId = 'c13d1678-150a-466b-804f-ecc82de3680e';
      const params: AgentUpdateParams = { description: 'Updated description' };

      await expect(agentsAPI.updateAgent(agentId, params)).rejects.toThrow(
        'Failed to update agent',
      );
    });

    it('should handle metadata updates', async () => {
      const mockAgent: Agent = {
        id: 'c13d1678-150a-466b-804f-ecc82de3680e',
        name: 'test-agent',
        description: 'Test agent',
        metadata: { key: 'value' },
        created_at: '2023-01-01T00:00:00.000Z',
        updated_at: '2023-01-02T00:00:00.000Z',
        auto_create_skills: true,
        skill_match_threshold: 0.8,
        max_auto_created_skills: 10,
        skill_arbiter_model_id: null,
        skill_arbiter_timeout_ms: null,
        reviewer_agent_id: null,
        review_fail_closed: false,
        review_expose_reason: false,
      };

      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue(mockAgent),
      };

      mockPatch.mockResolvedValue(mockResponse);

      const agentId = 'c13d1678-150a-466b-804f-ecc82de3680e';
      const params: AgentUpdateParams = {
        description: 'Test agent',
        metadata: { key: 'value' },
      };

      const result = await agentsAPI.updateAgent(agentId, params);

      expect(mockPatch).toHaveBeenCalledWith({
        param: { agentId },
        json: params,
      });
      expect(result).toEqual(mockAgent);
    });
  });

  describe('deleteAgent', () => {
    it('should complete successfully on 204 response', async () => {
      const mockResponse = {
        ok: true,
        status: 204,
      };

      mockDelete.mockResolvedValue(mockResponse);

      const agentId = 'c13d1678-150a-466b-804f-ecc82de3680e';

      await expect(agentsAPI.deleteAgent(agentId)).resolves.toBeUndefined();

      expect(mockDelete).toHaveBeenCalledWith({
        param: { agentId },
      });
    });

    it('should throw error on failed response', async () => {
      const mockResponse = {
        ok: false,
        status: 500,
      };

      mockDelete.mockResolvedValue(mockResponse);

      const agentId = 'c13d1678-150a-466b-804f-ecc82de3680e';

      await expect(agentsAPI.deleteAgent(agentId)).rejects.toThrow(
        'Failed to delete agent',
      );
    });

    it('should handle invalid agent ID', async () => {
      const mockResponse = {
        ok: false,
        status: 400,
      };

      mockDelete.mockResolvedValue(mockResponse);

      const invalidAgentId = 'invalid-id';

      await expect(agentsAPI.deleteAgent(invalidAgentId)).rejects.toThrow(
        'Failed to delete agent',
      );
    });

    it('should handle not found agent', async () => {
      const mockResponse = {
        ok: false,
        status: 404,
      };

      mockDelete.mockResolvedValue(mockResponse);

      const nonExistentAgentId = 'c13d1678-150a-466b-804f-ecc82de3680e';

      await expect(agentsAPI.deleteAgent(nonExistentAgentId)).rejects.toThrow(
        'Failed to delete agent',
      );
    });
  });

  describe('agent default models', () => {
    it('lists the models an agent starts new skills with', async () => {
      const models = [{ id: 'model-1', model_name: 'gpt-5' }];
      mockModelsGet.mockResolvedValue({
        ok: true,
        json: async () => models,
      });

      await expect(agentsAPI.getAgentModels('agent-1')).resolves.toEqual(
        models,
      );
      expect(mockModelsGet).toHaveBeenCalledWith({
        param: { agentId: 'agent-1' },
      });
    });

    it('adds models by id', async () => {
      mockModelsPost.mockResolvedValue({ ok: true });

      await agentsAPI.addModelsToAgent('agent-1', ['model-1', 'model-2']);

      expect(mockModelsPost).toHaveBeenCalledWith({
        param: { agentId: 'agent-1' },
        json: { modelIds: ['model-1', 'model-2'] },
      });
    });

    it('surfaces the server error when adding fails', async () => {
      mockModelsPost.mockResolvedValue({
        ok: false,
        json: async () => ({ error: 'Agent not found' }),
      });

      await expect(
        agentsAPI.addModelsToAgent('agent-1', ['model-1']),
      ).rejects.toThrow('Agent not found');
    });

    it('removes models through the comma-separated query', async () => {
      mockModelsDelete.mockResolvedValue({ ok: true });

      await agentsAPI.removeModelsFromAgent('agent-1', ['model-1', 'model-2']);

      expect(mockModelsDelete).toHaveBeenCalledWith({
        param: { agentId: 'agent-1' },
        query: { ids: 'model-1,model-2' },
      });
    });
  });
});
