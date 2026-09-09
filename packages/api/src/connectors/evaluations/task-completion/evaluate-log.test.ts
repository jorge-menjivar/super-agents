import { evaluateLog } from '@api/connectors/evaluations/task-completion/service/evaluate';
import { extractTaskAndOutcome } from '@api/connectors/evaluations/task-completion/service/task-and-outcome';
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

// Mock the extractTaskAndOutcome function to avoid OpenAI client initialization
vi.mock(
  '@api/connectors/evaluations/task-completion/service/task-and-outcome',
  () => ({
    extractTaskAndOutcome: vi.fn().mockResolvedValue({
      task: 'Book a flight to Paris',
      outcome: 'Flight booked successfully',
    }),
  }),
);

describe('Task Completion - evaluateLog', () => {
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

  it('should evaluate task completion successfully', async () => {
    const mockEvaluation: SkillOptimizationEvaluation = {
      id: 'eval-123',
      agent_id: 'agent-123',
      skill_id: 'skill-123',
      evaluation_method: EvaluationMethodName.TASK_COMPLETION,
      params: {
        model: 'gpt-4o-mini',
        temperature: 0.1,
        task: 'Book a flight to Paris',
        strict_mode: false,
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
          messages: [{ role: 'user', content: 'Book a flight to Paris' }],
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
                content: 'I have booked your flight to Paris for tomorrow.',
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

    // Mock verdict generation API call (extractTaskAndOutcome is mocked above)
    const mockVerdictResponse = {
      output: [
        {
          type: 'message',
          content: [
            {
              type: 'output_text',
              text: JSON.stringify({
                score: 1.0,
                reasoning: 'Task completed successfully',
              }),
            },
          ],
        },
      ],
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(JSON.stringify(mockVerdictResponse)),
      json: () => Promise.resolve(mockVerdictResponse),
    });

    const mockStorageConnector = createMockStorageConnector();
    const result = await evaluateLog(
      createMockContext(),
      mockEvaluation,
      mockLog,
      mockStorageConnector,
    );

    expect(result.method).toBe(EvaluationMethodName.TASK_COMPLETION);
    expect(result.score).toBe(1.0);
    expect(result.extra_data).toHaveProperty('task');
    expect(result.extra_data).toHaveProperty('outcome');
    expect(result.extra_data).toHaveProperty('execution_time');
  });

  it('should handle incomplete tasks', async () => {
    // Override default mock with score of 0 for incomplete task
    mockParse.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              score: 0.0,
              reasoning: 'Task incomplete',
            }),
          },
        },
      ],
    });

    const mockEvaluation: SkillOptimizationEvaluation = {
      id: 'eval-123',
      agent_id: 'agent-123',
      skill_id: 'skill-123',
      evaluation_method: EvaluationMethodName.TASK_COMPLETION,
      params: {
        model: 'gpt-4o-mini',
        temperature: 0.1,
        task: 'Book a flight to Paris',
        strict_mode: false,
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
          messages: [{ role: 'user', content: 'Book a flight to Paris' }],
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
                content: 'I need more information to book your flight.',
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

    const mockVerdictResponse = {
      output: [
        {
          type: 'message',
          content: [
            {
              type: 'output_text',
              text: JSON.stringify({
                score: 0.0,
                reasoning: 'Task not completed, more information needed',
              }),
            },
          ],
        },
      ],
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(JSON.stringify(mockVerdictResponse)),
      json: () => Promise.resolve(mockVerdictResponse),
    });

    const mockStorageConnector = createMockStorageConnector();
    const result = await evaluateLog(
      createMockContext(),
      mockEvaluation,
      mockLog,
      mockStorageConnector,
    );

    expect(result.method).toBe(EvaluationMethodName.TASK_COMPLETION);
    expect(result.score).toBe(0.0);
  });
});

/**
 * What the extraction stage is shown for an agentic log. Two bugs hid the
 * agent's work from the judges here: the response's tool calls were dropped
 * by extractOutputFromResponseBody (a tool-call turn read as no output at
 * all), and the history formatter rendered every tool output as empty. Both
 * made task_completion score healthy agentic turns 0.
 */
describe('Task Completion - agentic logs', () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
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
                    text: JSON.stringify({ score: 1, reasoning: 'fine' }),
                  },
                ],
              },
            ],
          }),
        ),
    });
    vi.clearAllMocks();
    mockParse.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({ score: 1, reasoning: 'on track' }),
          },
        },
      ],
    });
    vi.mocked(extractTaskAndOutcome).mockResolvedValue({
      task: 'review the code changes',
      outcome: 'began inspecting the repository',
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

  it('shows the extraction the tool outputs and the tool-call response', async () => {
    const evaluation = {
      id: 'eval-9',
      agent_id: 'agent-9',
      skill_id: 'skill-9',
      evaluation_method: EvaluationMethodName.TASK_COMPLETION,
      params: {
        temperature: 0.1,
        strict_mode: false,
        task: 'review the code changes',
      },
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

    const result = await evaluateLog(
      createMockContext(),
      evaluation,
      agenticLog(base),
      createMockStorageConnector(),
    );

    expect(result.extra_data?.error).toBeUndefined();
    expect(extractTaskAndOutcome).toHaveBeenCalledTimes(1);
    const call = vi.mocked(extractTaskAndOutcome).mock.calls[0];
    const input = call[2] as string;
    const output = call[3] as string;
    // The extraction opens with the assistant's role: without it, the task
    // is inferred from user messages alone, and a conversation the assistant
    // was told to transform reads as a request it was supposed to fulfill.
    expect(input).toContain(
      'ASSISTANT ROLE (its system prompt):\nYou maintain the blog codebase.',
    );
    // The conversation carries the tool's actual output, not an empty line.
    expect(input).toContain('Tool Call call_a Output: On branch main');
    // The tool-call response is the turn's output, not "nothing".
    expect(output).toContain('Assistant Tool Calls');
    expect(output).toContain('git diff --staged');
    // The verdict judge was told the turn is mid-task, so it grades
    // progress rather than docking the not-yet-due deliverable.
    const verdictSaw = JSON.stringify([
      (global.fetch as ReturnType<typeof vi.fn>).mock.calls,
      mockParse.mock.calls,
    ]);
    expect(verdictSaw).toContain('still in progress');
    // The verdict template travels as explicit prompts: its JSON instruction
    // stays in the system message instead of being re-split heuristically.
    const verdictCall = mockParse.mock.calls[0][0];
    expect(verdictCall.messages[0].role).toBe('system');
    expect(verdictCall.messages[0].content).toContain(
      'Return your response as a JSON object',
    );
    // And it scores this turn's contribution, not the turns before it.
    expect(verdictCall.messages[0].content).toContain(
      'Do not re-score earlier turns',
    );
  });
});
