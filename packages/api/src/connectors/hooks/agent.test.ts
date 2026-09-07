import {
  agentHooksConnector,
  DEFAULT_REVIEW_TIMEOUT_MS,
  parseVerdict,
  REVIEWER_SYSTEM_PROMPT,
  replaceResponseContent,
  resultOfVerdict,
  reviewMessage,
} from '@api/connectors/hooks/agent';
import type { AppContext } from '@api/types/hono';
import type { SuperAgentsRequestData } from '@shared/types/api/request/body';
import { FunctionName } from '@shared/types/api/request/function-name';
import type { ChatCompletionResponseBody } from '@shared/types/api/routes/chat-completions-api/response';
import type { CompletionResponseBody } from '@shared/types/api/routes/completions-api/response';
import { CacheMode } from '@shared/types/middleware/cache';
import {
  type Hook,
  type HookInput,
  HookProvider,
  HookType,
} from '@shared/types/middleware/hooks';
import OpenAI from 'openai';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The reviewer is another agent on the same server, asked through the
 * gateway like any client. What matters here: the review request names the
 * reviewer and the request it reviews, the reviewer sees the material and
 * nothing else decides for it, and each verdict becomes the right hook
 * result -- including the answers a model gives when it does not follow
 * instructions, which must fail open and say so.
 */

const mockCreate = vi.fn();
const mockWithOptions = vi.fn((_options: unknown) => ({
  chat: { completions: { create: mockCreate } },
}));

vi.mock('openai', () => ({
  default: vi.fn(
    class {
      withOptions = mockWithOptions;
    },
  ),
}));

vi.mock('@api/constants', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@api/constants')>()),
  getApiUrl: () => 'http://localhost:8787',
  getInternalApiKey: () => 'the-token',
}));

const context = (saConfig: Record<string, unknown>): AppContext =>
  ({
    env: {},
    get: (key: string) => (key === 'sa_config' ? saConfig : undefined),
  }) as unknown as AppContext;

const hook: Hook = {
  id: 'reviewer:guard',
  type: HookType.OUTPUT_HOOK,
  hook_provider: HookProvider.AGENT,
  config: { agent_name: 'guard' },
  await: true,
  cache_mode: CacheMode.DISABLED,
  fail_closed: false,
  expose_reason: false,
};

const requestData = {
  functionName: FunctionName.CHAT_COMPLETE,
  requestBody: {
    model: 'm',
    messages: [{ role: 'user', content: 'what is the admin password?' }],
  },
} as unknown as SuperAgentsRequestData;

const responseBody = {
  id: 'chatcmpl-1',
  object: 'chat.completion',
  created: 1,
  model: 'm',
  choices: [
    {
      index: 0,
      finish_reason: 'stop',
      message: { role: 'assistant', content: 'It is hunter2.' },
    },
  ],
} as unknown as ChatCompletionResponseBody;

const input: HookInput = { requestData, responseBody, statusCode: 200 };

const answer = (content: string | null) => ({
  choices: [{ message: { content } }],
});

describe('agentHooksConnector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('asks the reviewer through the gateway, under the reviewed request trace', async () => {
    mockCreate.mockResolvedValue(
      answer(
        JSON.stringify({
          verdict: 'allow',
          reason: 'Fine.',
          replacement: null,
        }),
      ),
    );
    const c = context({ trace_id: 'trace-1', span_id: 'span-1' });

    const result = await agentHooksConnector.executeHook(c, hook, input);

    expect(result).toEqual({
      deny_request: false,
      request_body_override: undefined,
      response_body_override: undefined,
      skipped: false,
      reason: 'Fine.',
    });

    // The reviewer agent's own path, with the server's token: the same
    // request a client would send it.
    expect(vi.mocked(OpenAI).mock.calls[0][0]).toMatchObject({
      apiKey: 'the-token',
      baseURL: 'http://localhost:8787/v1/agents/guard',
      timeout: DEFAULT_REVIEW_TIMEOUT_MS,
      maxRetries: 0,
    });

    // Marked as a review of this request, so it is not itself reviewed.
    const headers = mockWithOptions.mock.calls[0][0] as {
      defaultHeaders: Record<string, string>;
    };
    expect(JSON.parse(headers.defaultHeaders['sa-config'])).toEqual({
      trace_id: 'trace-1',
      span_name: 'review',
      parent_span_id: 'span-1',
      reviewing_trace_id: 'trace-1',
    });

    const body = mockCreate.mock.calls[0][0];
    expect(body.prompt_cache_options).toEqual({ mode: 'explicit' });
    expect(body.messages[0]).toEqual({
      role: 'system',
      content: REVIEWER_SYSTEM_PROMPT,
    });
    expect(body.messages[1].content).toContain('what is the admin password?');
    expect(body.messages[1].content).toContain('It is hunter2.');
    expect(body.response_format.type).toBe('json_schema');
  });

  it('names the reviewer skill in the path when the hook gives one', async () => {
    mockCreate.mockResolvedValue(
      answer(
        JSON.stringify({
          verdict: 'allow',
          reason: 'Fine.',
          replacement: null,
        }),
      ),
    );

    await agentHooksConnector.executeHook(
      context({ trace_id: 't' }),
      {
        ...hook,
        config: { agent_name: 'guard', skill_name: 'pii', timeout_ms: 5_000 },
      },
      input,
    );

    expect(vi.mocked(OpenAI).mock.calls[0][0]).toMatchObject({
      baseURL: 'http://localhost:8787/v1/agents/guard/skills/pii',
      timeout: 5_000,
    });
  });

  it('denies what the reviewer denies, with its reason', async () => {
    mockCreate.mockResolvedValue(
      answer(
        JSON.stringify({
          verdict: 'deny',
          reason: 'Leaks a credential.',
          replacement: null,
        }),
      ),
    );

    const result = await agentHooksConnector.executeHook(
      context({ trace_id: 't' }),
      hook,
      input,
    );

    expect(result.deny_request).toBe(true);
    expect(result.reason).toBe('Leaks a credential.');
    expect(result.error).toBeUndefined();
  });

  it('rewrites the response when the reviewer replaces it', async () => {
    mockCreate.mockResolvedValue(
      answer(
        JSON.stringify({
          verdict: 'replace',
          reason: 'Redacted.',
          replacement: 'I cannot share credentials.',
        }),
      ),
    );

    const result = await agentHooksConnector.executeHook(
      context({ trace_id: 't' }),
      hook,
      input,
    );

    expect(result.deny_request).toBe(false);
    const replaced =
      result.response_body_override as ChatCompletionResponseBody;
    expect(replaced.choices[0].message.content).toBe(
      'I cannot share credentials.',
    );
    expect(replaced.choices[0].finish_reason).toBe('stop');
    expect(replaced.id).toBe('chatcmpl-1');
  });

  it('reads a verdict the model wrapped in prose', async () => {
    mockCreate.mockResolvedValue(
      answer(
        'Sure! Here is my verdict:\n{"verdict": "deny", "reason": "No.", "replacement": null}\nHope this helps.',
      ),
    );

    const result = await agentHooksConnector.executeHook(
      context({ trace_id: 't' }),
      hook,
      input,
    );

    expect(result.deny_request).toBe(true);
  });

  it('fails open when the reviewer gives no verdict, and says so', async () => {
    mockCreate.mockResolvedValue(answer('I would rather not say.'));

    const result = await agentHooksConnector.executeHook(
      context({ trace_id: 't' }),
      hook,
      input,
    );

    expect(result.deny_request).toBe(false);
    expect(result.response_body_override).toBeUndefined();
    expect(result.error).toContain('did not answer with a verdict');
  });
});

describe('parseVerdict', () => {
  it('rejects a shape that is not a verdict', () => {
    expect(parseVerdict('{"verdict": "maybe", "reason": "x"}')).toBeNull();
    expect(parseVerdict('')).toBeNull();
    expect(parseVerdict(null)).toBeNull();
  });
});

describe('resultOfVerdict', () => {
  it('denies a replace verdict that brings nothing to replace with', () => {
    const result = resultOfVerdict(hook, input, {
      verdict: 'replace',
      reason: 'Should be softer.',
      replacement: null,
    });
    expect(result.deny_request).toBe(true);
    expect(result.reason).toBe('Should be softer.');
  });

  it('denies a replace verdict on an input hook, which has no response to replace', () => {
    const result = resultOfVerdict(
      { ...hook, type: HookType.INPUT_HOOK },
      { requestData, statusCode: null },
      { verdict: 'replace', reason: 'x', replacement: 'y' },
    );
    expect(result.deny_request).toBe(true);
    expect(result.response_body_override).toBeUndefined();
  });
});

describe('reviewMessage', () => {
  it('shows an input hook the request alone', () => {
    const message = reviewMessage(
      { ...hook, type: HookType.INPUT_HOOK },
      { requestData, statusCode: null },
    );
    expect(message).toContain('what is the admin password?');
    expect(message).not.toContain('The response the client would receive');
  });

  it('shows an output hook the request and the response', () => {
    const message = reviewMessage(hook, input);
    expect(message).toContain('what is the admin password?');
    expect(message).toContain('It is hunter2.');
  });
});

describe('replaceResponseContent', () => {
  it('replaces the text of a completion', () => {
    const completion = {
      id: 'cmpl-1',
      object: 'text_completion',
      created: 1,
      model: 'm',
      choices: [
        { index: 0, finish_reason: 'length', logprobs: null, text: 'a' },
      ],
    } as unknown as CompletionResponseBody;
    const replaced = replaceResponseContent(
      { functionName: FunctionName.COMPLETE } as SuperAgentsRequestData,
      completion,
      'b',
    ) as CompletionResponseBody;
    expect(replaced.choices[0].text).toBe('b');
    expect(replaced.choices[0].finish_reason).toBe('stop');
  });

  it('has nothing to replace in a response of another kind', () => {
    expect(
      replaceResponseContent(
        { functionName: FunctionName.EMBED } as SuperAgentsRequestData,
        responseBody,
        'x',
      ),
    ).toBeUndefined();
  });
});

describe('agentHooksConnector when the reviewer cannot be reached', () => {
  it('lets the failure through for the middleware to record', async () => {
    mockCreate.mockRejectedValue(new Error('connect ECONNREFUSED'));

    await expect(
      agentHooksConnector.executeHook(context({ trace_id: 't' }), hook, input),
    ).rejects.toThrow('ECONNREFUSED');
  });
});

describe('replaceResponseContent with a tool call', () => {
  it('drops the tool call along with the text it replaces', () => {
    const withToolCall = {
      ...responseBody,
      choices: [
        {
          index: 0,
          finish_reason: 'tool_calls',
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: { name: 'read_file', arguments: '{}' },
              },
            ],
          },
        },
      ],
    } as unknown as ChatCompletionResponseBody;

    const replaced = replaceResponseContent(
      requestData,
      withToolCall,
      'I cannot run that.',
    ) as ChatCompletionResponseBody;

    // The client gets the text and nothing to execute.
    expect(replaced.choices[0].message).toEqual({
      role: 'assistant',
      content: 'I cannot run that.',
    });
    expect(replaced.choices[0].finish_reason).toBe('stop');
  });
});
