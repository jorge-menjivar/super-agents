import { agentAndSkillMiddleware } from '@api/middlewares/agent-and-skill';
import type { AppContext } from '@api/types/hono';
import * as agentsUtils from '@api/utils/super-agents/agents';
import * as skillRouting from '@api/utils/super-agents/skill-routing';
import { SkillRoutingError } from '@api/utils/super-agents/skill-routing';
import * as skillsUtils from '@api/utils/super-agents/skills';
import {
  StrategyModes,
  type SuperAgentsConfig,
} from '@shared/types/api/request/headers';
import type { Agent } from '@shared/types/data/agent';
import type { Skill } from '@shared/types/data/skill';
import type { Next } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the utility functions
vi.mock('@api/utils/super-agents/agents');
vi.mock('@api/utils/super-agents/skills');
// Partially, so `SkillRoutingError` stays the real class for `instanceof`.
vi.mock('@api/utils/super-agents/skill-routing', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@api/utils/super-agents/skill-routing')
  >()),
  routeRequestToSkill: vi.fn(),
  learnSkillIntent: vi.fn(),
}));

describe('agentAndSkillMiddleware', () => {
  let mockNext: Next; // Mock connector
  const mockConnector = {
    getFeedback: vi.fn(),
    createFeedback: vi.fn(),
    deleteFeedback: vi.fn(),
    getImprovedResponse: vi.fn(),
    createImprovedResponse: vi.fn(),
    updateImprovedResponse: vi.fn(),
    deleteImprovedResponse: vi.fn(),

    // Agent methods (required by interface)
    getAgents: vi.fn(),
    createAgent: vi.fn(),
    updateAgent: vi.fn(),
    deleteAgent: vi.fn(),

    // Skill methods (required by interface)
    getSkills: vi.fn(),
    createSkill: vi.fn(),
    updateSkill: vi.fn(),
    deleteSkill: vi.fn(),
    incrementSkillTotalRequests: vi.fn(),
    // Tool methods (required by interface)
    getTools: vi.fn(),
    createTool: vi.fn(),
    deleteTool: vi.fn(),
  };
  let mockSuperAgentsConfig: SuperAgentsConfig;

  const createMockContext = (url: string): AppContext => {
    return {
      req: { url } as unknown,
      get: vi.fn().mockImplementation((key: string) => {
        switch (key) {
          case 'sa_config_pre_processed':
            return mockSuperAgentsConfig;
          case 'user_data_storage_connector':
            return mockConnector;
          default:
            return undefined;
        }
      }),
      set: vi.fn(),
    } as unknown as AppContext;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock Super Agents config
    const mockSuperAgentsConfig2: SuperAgentsConfig = {
      agent_name: 'test-agent',
      skill_name: 'test-skill',
      strategy: { mode: StrategyModes.SINGLE },
      targets: [],
      hooks: [],
      trace_id: 'test-trace',
    };

    mockSuperAgentsConfig = mockSuperAgentsConfig2;

    // Mock next function
    mockNext = vi.fn();
  });

  describe('URL filtering', () => {
    it('should process v1 API requests (not Super Agents)', async () => {
      const mockAgent: Agent = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        name: 'test-agent',
        description: 'Test agent description',
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

      const mockSkill: Skill = {
        id: '223e4567-e89b-12d3-a456-426614174000',
        agent_id: '123e4567-e89b-12d3-a456-426614174000',
        name: 'test-skill',
        description: 'Test skill description',
        metadata: {},
        optimize: false,
        configuration_count: 1,
        created_at: '2023-01-01T00:00:00.000Z',
        updated_at: '2023-01-01T00:00:00.000Z',
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

      vi.mocked(agentsUtils.getAgent).mockResolvedValue(mockAgent);
      vi.mocked(skillsUtils.getSkill).mockResolvedValue(mockSkill);

      const mockContext = createMockContext(
        'https://api.example.com/v1/chat/completions',
      );
      await agentAndSkillMiddleware(mockContext, mockNext);

      expect(agentsUtils.getAgent).toHaveBeenCalledWith(
        expect.anything(),
        mockConnector,
        'test-agent',
      );
      expect(skillsUtils.getSkill).toHaveBeenCalledWith(
        expect.anything(),
        mockConnector,
        '123e4567-e89b-12d3-a456-426614174000',
        'test-agent',
        'test-skill',
      );
      expect(mockContext.set).toHaveBeenCalledWith('agent', mockAgent);
      expect(mockContext.set).toHaveBeenCalledWith('skill', mockSkill);
      expect(mockNext).toHaveBeenCalledTimes(1);
    });

    it('should skip processing for Super Agents API requests', async () => {
      const mockContext = createMockContext(
        'https://api.example.com/v1/super-agents/logs',
      );
      await agentAndSkillMiddleware(mockContext, mockNext);

      expect(agentsUtils.getAgent).not.toHaveBeenCalled();
      expect(skillsUtils.getSkill).not.toHaveBeenCalled();
      expect(mockContext.set).not.toHaveBeenCalled();
      expect(mockNext).toHaveBeenCalledTimes(1);
    });

    it('should skip processing for non-v1 requests', async () => {
      const mockContext = createMockContext('https://api.example.com/health');
      await agentAndSkillMiddleware(mockContext, mockNext);

      expect(agentsUtils.getAgent).not.toHaveBeenCalled();
      expect(skillsUtils.getSkill).not.toHaveBeenCalled();
      expect(mockContext.set).not.toHaveBeenCalled();
      expect(mockNext).toHaveBeenCalledTimes(1);
    });
  });

  describe('v1 API endpoint variations', () => {
    const testUrls = [
      'https://api.example.com/v1/chat/completions',
      'https://api.example.com/v1/completions',
      'https://api.example.com/v1/embeddings',
    ];

    testUrls.forEach((url) => {
      it(`should process request for ${url}`, async () => {
        const mockAgent: Agent = {
          id: '123e4567-e89b-12d3-a456-426614174000',
          name: 'test-agent',
          description: 'Test agent description',
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

        const mockSkill: Skill = {
          id: '223e4567-e89b-12d3-a456-426614174000',
          agent_id: '123e4567-e89b-12d3-a456-426614174000',
          name: 'test-skill',
          description: 'Test skill description',
          metadata: {},
          optimize: false,
          configuration_count: 1,
          created_at: '2023-01-01T00:00:00.000Z',
          updated_at: '2023-01-01T00:00:00.000Z',
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

        vi.mocked(agentsUtils.getAgent).mockResolvedValue(mockAgent);
        vi.mocked(skillsUtils.getSkill).mockResolvedValue(mockSkill);

        const mockContext = createMockContext(url);
        await agentAndSkillMiddleware(mockContext, mockNext);

        expect(agentsUtils.getAgent).toHaveBeenCalledWith(
          expect.anything(),
          mockConnector,
          'test-agent',
        );
        expect(skillsUtils.getSkill).toHaveBeenCalledWith(
          expect.anything(),
          mockConnector,
          '123e4567-e89b-12d3-a456-426614174000',
          'test-agent',
          'test-skill',
        );
        expect(mockContext.set).toHaveBeenCalledWith('agent', mockAgent);
        expect(mockContext.set).toHaveBeenCalledWith('skill', mockSkill);
      });
    });
  });

  describe('Super Agents API endpoint variations', () => {
    const saUrls = [
      'https://api.example.com/v1/super-agents/logs',
      'https://api.example.com/v1/super-agents/auth/login',
      'https://api.example.com/v1/super-agents/feedbacks',
    ];

    saUrls.forEach((url) => {
      it(`should skip processing for ${url}`, async () => {
        const mockContext = createMockContext(url);
        await agentAndSkillMiddleware(mockContext, mockNext);

        expect(agentsUtils.getAgent).not.toHaveBeenCalled();
        expect(skillsUtils.getSkill).not.toHaveBeenCalled();
        expect(mockContext.set).not.toHaveBeenCalled();
        expect(mockNext).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('error handling', () => {
    it('should propagate errors from getOrCreateAgent', async () => {
      const error = new Error('Failed to get or create agent');
      vi.mocked(agentsUtils.getAgent).mockRejectedValue(error);
      vi.mocked(skillsUtils.getSkill).mockResolvedValue({} as Skill);

      const mockContext = createMockContext(
        'https://api.example.com/v1/chat/completions',
      );

      await expect(
        agentAndSkillMiddleware(mockContext, mockNext),
      ).rejects.toThrow('Failed to get or create agent');

      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should propagate errors from getOrCreateSkill', async () => {
      const error = new Error('Failed to get or create skill');
      vi.mocked(agentsUtils.getAgent).mockResolvedValue({} as Agent);
      vi.mocked(skillsUtils.getSkill).mockRejectedValue(error);

      const mockContext = createMockContext(
        'https://api.example.com/v1/chat/completions',
      );

      await expect(
        agentAndSkillMiddleware(mockContext, mockNext),
      ).rejects.toThrow('Failed to get or create skill');

      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('configuration scenarios', () => {
    it('should handle different agent and skill names', async () => {
      const customConfig: SuperAgentsConfig = {
        agent_name: 'custom-agent-123',
        skill_name: 'custom-skill-456',
        strategy: { mode: StrategyModes.SINGLE },
        targets: [],
        hooks: [],
        trace_id: 'test-trace',
      };

      const mockAgent: Agent = {
        id: 'custom-agent-uuid-123',
        name: 'custom-agent-123',
        description: 'Custom agent description',
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

      const customMockContext = {
        req: { url: 'https://api.example.com/v1/chat/completions' } as unknown,
        get: vi.fn().mockImplementation((key: string) => {
          switch (key) {
            case 'sa_config_pre_processed':
              return customConfig;
            case 'user_data_storage_connector':
              return mockConnector;
            default:
              return undefined;
          }
        }),
        set: vi.fn(),
      } as unknown;

      vi.mocked(agentsUtils.getAgent).mockResolvedValue(mockAgent);
      vi.mocked(skillsUtils.getSkill).mockResolvedValue({} as Skill);

      await agentAndSkillMiddleware(
        customMockContext as unknown as AppContext,
        mockNext,
      );

      expect(agentsUtils.getAgent).toHaveBeenCalledWith(
        expect.anything(),
        mockConnector,
        'custom-agent-123',
      );
      expect(skillsUtils.getSkill).toHaveBeenCalledWith(
        expect.anything(),
        mockConnector,
        'custom-agent-uuid-123',
        'custom-agent-123',
        'custom-skill-456',
      );
    });
  });

  describe('learning from a request that names its skill', () => {
    const agent = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      name: 'test-agent',
    } as Agent;
    const skill = {
      id: '123e4567-e89b-12d3-a456-426614174001',
      name: 'test-skill',
    } as Skill;
    const requestData = { functionName: 'chatComplete' };

    const createNamedContext = (
      values: Record<string, unknown> = {},
    ): AppContext => {
      const c = createMockContext('http://localhost/v1/chat/completions');
      (c.get as unknown as ReturnType<typeof vi.fn>).mockImplementation(
        (key: string) => {
          switch (key) {
            case 'sa_config_pre_processed':
              return mockSuperAgentsConfig;
            case 'user_data_storage_connector':
              return mockConnector;
            case 'sa_request_data':
              return requestData;
            default:
              return values[key];
          }
        },
      );
      return c;
    };

    beforeEach(() => {
      vi.mocked(agentsUtils.getAgent).mockResolvedValue(agent);
      vi.mocked(skillsUtils.getSkill).mockResolvedValue(skill);
      vi.mocked(skillRouting.learnSkillIntent).mockResolvedValue(undefined);
    });

    it('learns after the request has been answered', async () => {
      const order: string[] = [];
      mockNext = vi.fn().mockImplementation(() => {
        order.push('next');
        return Promise.resolve();
      });
      vi.mocked(skillRouting.learnSkillIntent).mockImplementation(() => {
        order.push('learn');
        return Promise.resolve();
      });
      const c = createNamedContext();

      await agentAndSkillMiddleware(c, mockNext);

      expect(order).toEqual(['next', 'learn']);
      expect(skillRouting.learnSkillIntent).toHaveBeenCalledWith(
        c,
        mockConnector,
        agent,
        skill,
        requestData,
      );
    });

    it('does not fail the request when learning fails', async () => {
      vi.mocked(skillRouting.learnSkillIntent).mockRejectedValue(
        new Error('storage'),
      );

      await expect(
        agentAndSkillMiddleware(createNamedContext(), mockNext),
      ).resolves.toBeUndefined();
      // Rejected after the middleware returned; give it a tick to settle.
      await new Promise((resolve) => setImmediate(resolve));
    });

    it('leaves the internal skills alone', async () => {
      vi.mocked(agentsUtils.getAgent).mockResolvedValue({
        ...agent,
        name: 'super-agents',
      });

      await agentAndSkillMiddleware(createNamedContext(), mockNext);

      expect(skillRouting.learnSkillIntent).not.toHaveBeenCalled();
    });

    it('does not learn from a request that was routed', async () => {
      mockSuperAgentsConfig = {
        ...mockSuperAgentsConfig,
        skill_name: undefined,
      } as unknown as SuperAgentsConfig;
      vi.mocked(skillRouting.routeRequestToSkill).mockResolvedValue({
        skill,
        decision: {
          method: 'only_skill',
          similarity: null,
          threshold: null,
          candidates: 1,
        },
      });

      await agentAndSkillMiddleware(createNamedContext(), mockNext);

      expect(skillRouting.learnSkillIntent).not.toHaveBeenCalled();
    });
  });

  describe('routing when the skill is not named', () => {
    const agent = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      name: 'test-agent',
    } as Agent;
    const routedSkill = {
      id: '123e4567-e89b-12d3-a456-426614174001',
      name: 'routed-skill',
    } as Skill;
    const decision = {
      method: 'only_skill' as const,
      similarity: null,
      threshold: null,
      candidates: 1,
    };

    const createRoutingContext = (): AppContext => {
      const c = createMockContext('http://localhost/v1/chat/completions');
      (c as unknown as { json: unknown }).json = vi
        .fn()
        .mockImplementation(
          (body: unknown, status: number) =>
            new Response(JSON.stringify(body), { status }),
        );
      return c;
    };

    beforeEach(() => {
      mockSuperAgentsConfig = {
        ...mockSuperAgentsConfig,
        skill_name: undefined,
      } as unknown as SuperAgentsConfig;
      vi.mocked(agentsUtils.getAgent).mockResolvedValue(agent);
    });

    it('should route to a skill and fill its name into the config', async () => {
      vi.mocked(skillRouting.routeRequestToSkill).mockResolvedValue({
        skill: routedSkill,
        decision,
      });
      const c = createRoutingContext();

      await agentAndSkillMiddleware(c, mockNext);

      expect(skillsUtils.getSkill).not.toHaveBeenCalled();
      expect(skillRouting.routeRequestToSkill).toHaveBeenCalledWith(
        c,
        mockConnector,
        agent,
        undefined,
      );
      expect(c.set).toHaveBeenCalledWith('skill', routedSkill);
      expect(c.set).toHaveBeenCalledWith('skill_routing', decision);
      expect(c.set).toHaveBeenCalledWith(
        'sa_config_pre_processed',
        expect.objectContaining({ skill_name: 'routed-skill' }),
      );
      expect(mockNext).toHaveBeenCalled();
    });

    it('should answer with the routing error status', async () => {
      vi.mocked(skillRouting.routeRequestToSkill).mockRejectedValue(
        new SkillRoutingError('Agent test-agent has no skills', 404),
      );
      const c = createRoutingContext();

      const response = (await agentAndSkillMiddleware(c, mockNext)) as Response;

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({
        error: 'Agent test-agent has no skills',
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should let other routing failures propagate', async () => {
      vi.mocked(skillRouting.routeRequestToSkill).mockRejectedValue(
        new Error('database down'),
      );

      await expect(
        agentAndSkillMiddleware(createRoutingContext(), mockNext),
      ).rejects.toThrow('database down');
    });
  });
});
