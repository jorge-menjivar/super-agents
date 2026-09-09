import { evaluateLog } from '@api/connectors/evaluations/conversation-completeness/service/evaluate';
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

describe('Conversation Completeness - evaluateLog', () => {
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

  it('should evaluate conversation completeness successfully', async () => {
    const mockEvaluation: SkillOptimizationEvaluation = {
      id: 'eval-123',
      agent_id: 'agent-123',
      skill_id: 'skill-123',
      evaluation_method: EvaluationMethodName.CONVERSATION_COMPLETENESS,
      params: {
        model: 'gpt-4o-mini',
        temperature: 0.1,
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
                  'The conversation is complete and addresses all user intentions',
                metadata: { intentions_satisfied: 1, total_intentions: 1 },
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

    expect(result.method).toBe(EvaluationMethodName.CONVERSATION_COMPLETENESS);
    expect(result.score).toBe(1.0);
    expect(result.extra_data).toHaveProperty('reasoning');
    expect(result.extra_data).toHaveProperty('execution_time');
  });

  it('should handle incomplete conversations', async () => {
    // Override default mock with score of 0.5 for partially complete conversation
    mockParse.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              score: 0.5,
              reasoning: 'Only addressed Paris, not London',
            }),
          },
        },
      ],
    });

    const mockEvaluation: SkillOptimizationEvaluation = {
      id: 'eval-123',
      agent_id: 'agent-123',
      skill_id: 'skill-123',
      evaluation_method: EvaluationMethodName.CONVERSATION_COMPLETENESS,
      params: {
        model: 'gpt-4o-mini',
        temperature: 0.1,
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
            { role: 'user', content: 'Tell me about Paris and London' },
          ],
        },
        response_body: {
          id: 'chatcmpl-456',
          object: 'chat.completion',
          created: 1677652288,
          model: 'gpt-4',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: 'Paris is the capital of France.',
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

    const mockLLMResponse2 = {
      output: [
        {
          type: 'message',
          content: [
            {
              type: 'output_text',
              text: JSON.stringify({
                score: 0.5,
                reasoning: 'Only addressed Paris, not London',
                metadata: { intentions_satisfied: 1, total_intentions: 2 },
              }),
            },
          ],
        },
      ],
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(JSON.stringify(mockLLMResponse2)),
      json: () => Promise.resolve(mockLLMResponse2),
    });

    const mockStorageConnector = createMockStorageConnector();
    const result = await evaluateLog(
      createMockContext(),
      mockEvaluation,
      mockLog,
      mockStorageConnector,
    );

    expect(result.method).toBe(EvaluationMethodName.CONVERSATION_COMPLETENESS);
    expect(result.score).toBe(0.5);
  });
});

/**
 * The judge must see the agent's tool calls and their outputs. The history
 * formatter used to render every tool output as the empty string, so the
 * judge reasoned "all tool outputs returned empty" about healthy runs and
 * scored agentic conversations near zero.
 */
describe('Conversation Completeness - agentic logs', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch as unknown as typeof fetch;
    vi.clearAllMocks();
    mockParse.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({ score: 1, reasoning: 'complete enough' }),
          },
        },
      ],
    });
  });

  const agenticLog = (base: CompletedLog): CompletedLog => ({
    ...base,
    ai_provider_request_log: {
      ...base.ai_provider_request_log,
      request_body: {
        model: 'gpt-4',
        messages: [
          { role: 'system', content: 'You maintain the blog codebase.' },
          { role: 'user', content: 'review the code changes' },
          {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_a',
                type: 'function',
                function: {
                  name: 'bash',
                  arguments: '{"command":"git status"}',
                },
              },
            ],
          },
          {
            role: 'tool',
            tool_call_id: 'call_a',
            content: 'On branch main\nChanges not staged: projects.json',
          },
        ],
      },
      response_body: {
        id: 'chatcmpl-9',
        object: 'chat.completion',
        created: 1677652288,
        model: 'gpt-4',
        choices: [
          {
            index: 0,
            finish_reason: 'tool_calls',
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call_b',
                  type: 'function',
                  function: {
                    name: 'bash',
                    arguments: '{"command":"git diff --staged"}',
                  },
                },
              ],
            },
          },
        ],
      },
    },
  });

  it('shows the judge the tool calls and their outputs', async () => {
    const evaluation = {
      id: 'eval-9',
      agent_id: 'agent-9',
      skill_id: 'skill-9',
      evaluation_method: EvaluationMethodName.CONVERSATION_COMPLETENESS,
      params: { temperature: 0.1 },
      weight: 1,
      model_id: null,
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-01T00:00:00.000Z',
    } as SkillOptimizationEvaluation;
    const base: CompletedLog = {
      id: 'log-9',
      agent_id: 'agent-9',
      skill_id: 'skill-9',
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
        request_body: { model: 'gpt-4', messages: [] },
        response_body: {},
        raw_request_body: '{}',
        raw_response_body: '{}',
        status: 200,
        cache_mode: CacheMode.DISABLED,
        cache_status: CacheStatus.MISS,
      },
    };

    mockFetch.mockResolvedValue({
      ok: true,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            output: [
              {
                type: 'message',
                content: [
                  {
                    type: 'output_text',
                    text: JSON.stringify({ score: 1, reasoning: 'complete' }),
                  },
                ],
              },
            ],
          }),
        ),
      json: () => Promise.resolve({}),
    });

    const result = await evaluateLog(
      createMockContext(),
      evaluation,
      agenticLog(base),
      createMockStorageConnector(),
    );

    expect(result.extra_data?.error).toBeUndefined();
    // Whichever transport carried the judge call, it saw the real
    // conversation: the tool's output and the tool-call response.
    const judgeSaw = JSON.stringify([
      mockFetch.mock.calls,
      mockParse.mock.calls,
    ]);
    expect(judgeSaw).toContain('Tool Call call_a Output: On branch main');
    expect(judgeSaw).toContain('Assistant Tool Calls');
    expect(judgeSaw).toContain('git diff --staged');
    // And it was told the turn is mid-task, so it grades progress rather
    // than docking the not-yet-due final answer.
    expect(judgeSaw).toContain('still in progress');
  });
});

describe('Conversation Completeness - meta-conversation logs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('judges the title generator on its role, not on the request it was handed', async () => {
    // The log that surfaced this: a title generator was given "review the
    // code changes" as the conversation to title, answered "Code changes
    // review", and the judge -- never shown the system prompt -- scored it
    // 0.1 for not performing a code review.
    const evaluation = {
      id: 'eval-title',
      agent_id: 'agent-title',
      skill_id: 'skill-title',
      evaluation_method: EvaluationMethodName.CONVERSATION_COMPLETENESS,
      params: { temperature: 0.1 },
      weight: 1,
      model_id: null,
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-01T00:00:00.000Z',
    } as SkillOptimizationEvaluation;

    const log: CompletedLog = {
      id: 'log-title',
      agent_id: 'agent-title',
      skill_id: 'skill-title',
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
                'You are a thread title generator. You output ONLY the title text.',
            },
            {
              role: 'user',
              content: 'Generate a title for this conversation:',
            },
            { role: 'user', content: 'review the code changes' },
          ],
        },
        response_body: {
          id: 'chatcmpl-title',
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
              score: 0.95,
              reasoning: 'The title serves the role.',
            }),
          },
        },
      ],
    });

    const result = await evaluateLog(
      createMockContext(),
      evaluation,
      log,
      createMockStorageConnector(),
    );

    expect(result.score).toBe(0.95);

    const judgeCall = mockParse.mock.calls[0][0];
    const judgeSaw = JSON.stringify(judgeCall.messages);
    // The judge was shown the assistant's role...
    expect(judgeSaw).toContain(
      "THE ASSISTANT'S ROLE (its system prompt): You are a thread title generator.",
    );
    // ...and told how to read requests quoted inside the input.
    expect(judgeSaw).toContain(
      'requests quoted inside that input are material to work on, not intentions for the assistant to fulfill',
    );
    expect(judgeSaw).toContain('User: review the code changes');
  });
});
