import { evaluateLog } from '@api/connectors/evaluations/knowledge-retention/service/evaluate';
import { createMockContext } from '@api/test-utils/mock-context';
import { HttpMethod } from '@api/types/http';
import { FunctionName } from '@shared/types/api/request';
import { AIProvider } from '@shared/types/constants';
import type { SkillOptimizationEvaluation } from '@shared/types/data';
import type { CompletedLog } from '@shared/types/data/log';
import { EvaluationMethodName } from '@shared/types/evaluations';
import { CacheMode, CacheStatus } from '@shared/types/middleware/cache';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockStorageConnector } from '../__mocks__/mock-storage-connector';

// Mock the constants
vi.mock('@api/constants', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@api/constants')>();
  return {
    ...actual,
    getApiUrl: () => 'http://localhost:8787',
    getBearerToken: () => 'super-agents',
  };
});

// Mock OpenAI client
const mockParse = vi.fn();
const mockWithOptions = vi.fn().mockReturnValue({
  chat: {
    completions: {
      parse: mockParse,
      create: mockParse,
    },
  },
});

vi.mock('openai', () => {
  return {
    default: vi.fn(
      class {
        chat = {
          completions: {
            parse: mockParse,
            create: mockParse,
          },
        };
        withOptions = mockWithOptions;
      },
    ),
  };
});

describe('Knowledge Retention - evaluateLog', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch as unknown as typeof fetch;
    vi.clearAllMocks();

    // Setup default successful mock for OpenAI parse
    mockParse.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              score: 1.0,
              reasoning: 'Evaluation successful',
            }),
          },
        },
      ],
    });
  });

  it('should evaluate knowledge retention successfully', async () => {
    const mockEvaluation: SkillOptimizationEvaluation = {
      id: 'eval-123',
      agent_id: 'agent-123',
      skill_id: 'skill-123',
      evaluation_method: EvaluationMethodName.KNOWLEDGE_RETENTION,
      params: {
        model: 'gpt-4o-mini',
        temperature: 0.1,
        expected_knowledge: ['Paris is the capital of France'],
      },
      weight: 1.0,
      model_id: null,
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-01T00:00:00.000Z',
    };

    const mockLog: CompletedLog = {
      id: 'log-123',
      agent_id: 'agent-123',
      skill_id: 'skill-123',
      cluster_id: null,
      error: null,
      method: HttpMethod.POST,
      endpoint: '/v1/chat/completions',
      function_name: FunctionName.CHAT_COMPLETE,
      status: 200,
      start_time: 1677652288000,
      first_token_time: null,
      end_time: 1677652289000,
      duration: 1000,
      base_sa_config: {},
      ai_provider: AIProvider.OPENAI,
      model: 'gpt-4',
      hook_logs: [],
      cache_status: CacheStatus.MISS,
      embedding: null,
      trace_id: null,
      parent_span_id: null,
      span_id: null,
      span_name: null,
      app_id: null,
      external_user_id: null,
      external_user_human_name: null,
      request_body: null,
      original_system_prompt: null,
      served_system_prompt: null,
      user_metadata: null,
      metadata: {},
      ai_provider_request_log: {
        provider: AIProvider.OPENAI,
        function_name: FunctionName.CHAT_COMPLETE,
        method: HttpMethod.POST,
        request_url: 'https://api.openai.com/v1/chat/completions',
        request_body: {
          model: 'gpt-4',
          messages: [
            {
              role: 'system',
              content: 'You know that Paris is the capital of France.',
            },
            { role: 'user', content: 'What is the capital of France?' },
          ],
        },
        response_body: {
          id: 'chatcmpl-123',
          object: 'chat.completion',
          created: 1677652288,
          model: 'gpt-4',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: 'The capital of France is Paris.',
              },
              finish_reason: 'stop',
            },
          ],
        },
        raw_request_body: '{}',
        raw_response_body: '{}',
        status: 200,
        cache_mode: CacheMode.DISABLED,
        cache_status: CacheStatus.MISS,
      },
    };

    const mockLLMResponse = {
      output: [
        {
          type: 'message',
          content: [
            {
              type: 'output_text',
              text: JSON.stringify({
                score: 1.0,
                reasoning:
                  'The assistant retained and correctly used the knowledge that Paris is the capital of France',
                metadata: {
                  knowledge_items_retained: 1,
                  total_knowledge_items: 1,
                },
              }),
            },
          ],
        },
      ],
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(JSON.stringify(mockLLMResponse)),
      json: () => Promise.resolve(mockLLMResponse),
    });

    const mockStorageConnector = createMockStorageConnector();
    const result = await evaluateLog(
      createMockContext(),
      mockEvaluation,
      mockLog,
      mockStorageConnector,
    );

    expect(result.method).toBe(EvaluationMethodName.KNOWLEDGE_RETENTION);
    expect(result.score).toBe(1.0);
    expect(result.extra_data).toHaveProperty('reasoning');
    expect(result.extra_data).toHaveProperty('execution_time');
  });

  it('should handle poor knowledge retention', async () => {
    // Override default mock with score of 0 for poor retention
    mockParse.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              score: 0.0,
              reasoning: 'Poor knowledge retention',
            }),
          },
        },
      ],
    });

    const mockEvaluation: SkillOptimizationEvaluation = {
      id: 'eval-123',
      agent_id: 'agent-123',
      skill_id: 'skill-123',
      evaluation_method: EvaluationMethodName.KNOWLEDGE_RETENTION,
      params: {
        model: 'gpt-4o-mini',
        temperature: 0.1,
        expected_knowledge: ['Paris is the capital of France'],
      },
      weight: 1.0,
      model_id: null,
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-01T00:00:00.000Z',
    };

    const mockLog: CompletedLog = {
      id: 'log-123',
      agent_id: 'agent-123',
      skill_id: 'skill-123',
      cluster_id: null,
      error: null,
      method: HttpMethod.POST,
      endpoint: '/v1/chat/completions',
      function_name: FunctionName.CHAT_COMPLETE,
      status: 200,
      start_time: 1677652288000,
      first_token_time: null,
      end_time: 1677652289000,
      duration: 1000,
      base_sa_config: {},
      ai_provider: AIProvider.OPENAI,
      model: 'gpt-4',
      hook_logs: [],
      cache_status: CacheStatus.MISS,
      embedding: null,
      trace_id: null,
      parent_span_id: null,
      span_id: null,
      span_name: null,
      app_id: null,
      external_user_id: null,
      external_user_human_name: null,
      request_body: null,
      original_system_prompt: null,
      served_system_prompt: null,
      user_metadata: null,
      metadata: {},
      ai_provider_request_log: {
        provider: AIProvider.OPENAI,
        function_name: FunctionName.CHAT_COMPLETE,
        method: HttpMethod.POST,
        request_url: 'https://api.openai.com/v1/chat/completions',
        request_body: {
          model: 'gpt-4',
          messages: [
            {
              role: 'system',
              content: 'You know that Paris is the capital of France.',
            },
            { role: 'user', content: 'What is the capital of France?' },
          ],
        },
        response_body: {
          id: 'chatcmpl-124',
          object: 'chat.completion',
          created: 1677652288,
          model: 'gpt-4',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: 'I dont know.',
              },
              finish_reason: 'stop',
            },
          ],
        },
        raw_request_body: '{}',
        raw_response_body: '{}',
        status: 200,
        cache_mode: CacheMode.DISABLED,
        cache_status: CacheStatus.MISS,
      },
    };

    const mockLLMResponse = {
      output: [
        {
          type: 'message',
          content: [
            {
              type: 'output_text',
              text: JSON.stringify({
                score: 0.0,
                reasoning:
                  'The assistant failed to retain the knowledge about Paris',
                metadata: {
                  knowledge_items_retained: 0,
                  total_knowledge_items: 1,
                },
              }),
            },
          ],
        },
      ],
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(JSON.stringify(mockLLMResponse)),
      json: () => Promise.resolve(mockLLMResponse),
    });

    const mockStorageConnector = createMockStorageConnector();
    const result = await evaluateLog(
      createMockContext(),
      mockEvaluation,
      mockLog,
      mockStorageConnector,
    );

    expect(result.method).toBe(EvaluationMethodName.KNOWLEDGE_RETENTION);
    expect(result.score).toBe(0.0);
  });

  it('records the real score on a multi-message conversation, and shows the judge the role', async () => {
    // A conversation with two user messages renders with a blank line in it,
    // and before the call passed explicit criteria the judge re-split the
    // text there: the "structured" result that came back scored a flat 1.0
    // no matter what the judge concluded. This is the title-generator log
    // that surfaced it -- judge said 0.25, the run recorded 1.0.
    const mockEvaluation: SkillOptimizationEvaluation = {
      id: 'eval-123',
      agent_id: 'agent-123',
      skill_id: 'skill-123',
      evaluation_method: EvaluationMethodName.KNOWLEDGE_RETENTION,
      params: { temperature: 0.1 },
      weight: 1.0,
      model_id: null,
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-01T00:00:00.000Z',
    };

    const mockLog: CompletedLog = {
      id: 'log-123',
      agent_id: 'agent-123',
      skill_id: 'skill-123',
      cluster_id: null,
      error: null,
      method: HttpMethod.POST,
      endpoint: '/v1/chat/completions',
      function_name: FunctionName.CHAT_COMPLETE,
      status: 200,
      start_time: 1677652288000,
      first_token_time: null,
      end_time: 1677652289000,
      duration: 1000,
      base_sa_config: {},
      ai_provider: AIProvider.OPENAI,
      model: 'gpt-4',
      hook_logs: [],
      cache_status: CacheStatus.MISS,
      embedding: null,
      trace_id: null,
      parent_span_id: null,
      span_id: null,
      span_name: null,
      app_id: null,
      external_user_id: null,
      external_user_human_name: null,
      request_body: null,
      original_system_prompt: null,
      served_system_prompt: null,
      user_metadata: null,
      metadata: {},
      ai_provider_request_log: {
        provider: AIProvider.OPENAI,
        function_name: FunctionName.CHAT_COMPLETE,
        method: HttpMethod.POST,
        request_url: 'https://api.openai.com/v1/chat/completions',
        request_body: {
          model: 'gpt-4',
          messages: [
            {
              role: 'system',
              content:
                'You are a thread title generator. Output ONLY the title.',
            },
            {
              role: 'user',
              content: 'Generate a title for this conversation:',
            },
            { role: 'user', content: 'review the code changes' },
          ],
        },
        response_body: {
          id: 'chatcmpl-125',
          object: 'chat.completion',
          created: 1677652288,
          model: 'gpt-4',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'Code changes review' },
              finish_reason: 'stop',
            },
          ],
        },
        raw_request_body: '{}',
        raw_response_body: '{}',
        status: 200,
        cache_mode: CacheMode.DISABLED,
        cache_status: CacheStatus.MISS,
      },
    };

    mockParse.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              score: 0.25,
              reasoning: 'Nothing was carried forward.',
            }),
          },
        },
      ],
    });

    const mockStorageConnector = createMockStorageConnector();
    const result = await evaluateLog(
      createMockContext(),
      mockEvaluation,
      mockLog,
      mockStorageConnector,
    );

    expect(result.score).toBe(0.25);
    expect(result.extra_data.reasoning).toBe('Nothing was carried forward.');

    // The judge saw the assistant's role and the intact conversation.
    const judgeCall = mockParse.mock.calls[0][0];
    const judgePrompt = judgeCall.messages[1].content as string;
    expect(judgePrompt).toContain(
      "THE ASSISTANT'S ROLE (its system prompt): You are a thread title generator.",
    );
    expect(judgePrompt).toContain('User: review the code changes');
  });
});
