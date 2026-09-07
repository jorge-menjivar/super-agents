import { HttpError } from '@api/errors/http';
import { responseHandler } from '@api/handlers/response-handler';
import type { AppContext } from '@api/types/hono';
import { HttpMethod } from '@api/types/http';
import {
  createResponse,
  extractOutputFromResponseBody,
  responseEndsInToolCalls,
} from '@api/utils/super-agents/responses';
import {
  type ChatCompletionRequestData,
  FunctionName,
} from '@shared/types/api/request';
import type { SuperAgentsResponseBody } from '@shared/types/api/response/body';
import { ChatCompletionMessageRole } from '@shared/types/api/routes/shared/messages';
import type { AIProvider } from '@shared/types/constants';
import { CacheMode, type CacheStatus } from '@shared/types/middleware/cache';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import z from 'zod';

// Mock the responseHandler
vi.mock('@api/handlers/response-handler', () => ({
  responseHandler: vi.fn(),
}));

describe('createResponse', () => {
  let mockContext: AppContext;
  let mockResponse: Response;
  let mockOptions: Parameters<typeof createResponse>[1];

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock context
    mockContext = {
      set: vi.fn(),
      get: vi.fn(),
    } as unknown as AppContext;

    // Mock response
    mockResponse = {
      ok: true,
      status: 200,
      statusText: 'OK',
      clone: vi.fn(),
      text: vi.fn(),
    } as unknown as Response;

    // Mock request data
    const mockSuperAgentsRequestData: ChatCompletionRequestData = {
      functionName: FunctionName.CHAT_COMPLETE,
      method: HttpMethod.POST,
      url: 'https://api.openai.com/v1/chat/completions',
      requestBody: {
        model: 'gpt-3.5-turbo',
        messages: [{ role: ChatCompletionMessageRole.USER, content: 'Hello' }],
      },
      requestHeaders: { 'content-type': 'application/json' },
      route_pattern: /^\/v1\/chat\/completions$/,
      requestSchema: z.object({}),
      responseSchema: z.object({}),
    };

    // Mock options
    mockOptions = {
      saRequestData: mockSuperAgentsRequestData,
      aiProviderRequestURL: 'https://api.openai.com/v1/chat/completions',
      isStreamingMode: false,
      provider: 'openai' as AIProvider,
      strictOpenAiCompliance: true,
      areSyncHooksAvailable: true,
      currentIndex: 0,
      fetchOptions: {},
      cacheSettings: { mode: CacheMode.DISABLED, max_age: 0 },
      response: mockResponse,
      responseTransformerFunctionName: undefined,
      cacheStatus: 'miss' as CacheStatus,
      retryCount: undefined,
      aiProviderRequestBody: {
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: 'Hello' }],
      },
    };

    // Mock responseHandler to return the mock response
    vi.mocked(responseHandler).mockResolvedValue({
      response: mockResponse,
      saResponseBody: null,
    });

    // Mock response clone and text methods
    const mockResponseClone = {
      text: vi
        .fn()
        .mockResolvedValue(
          '{"choices":[{"message":{"content":"Hello there!"}}]}',
        ),
    };
    vi.mocked(mockResponse.clone).mockReturnValue(
      mockResponseClone as unknown as Response,
    );
  });

  describe('successful response handling', () => {
    it('should process successful response correctly', async () => {
      const result = await createResponse(mockContext, mockOptions);

      expect(result).toBe(mockResponse);
      expect(responseHandler).toHaveBeenCalledWith(
        mockResponse,
        false,
        'openai',
        undefined,
        'https://api.openai.com/v1/chat/completions',
        'miss',
        mockOptions.saRequestData,
        true,
        true,
        undefined, // onFirstChunk callback (undefined for non-streaming)
        undefined, // streamEndResolver callback (undefined for non-streaming)
      );
      expect(mockContext.set).toHaveBeenCalledWith(
        'ai_provider_log',
        expect.objectContaining({
          provider: 'openai',
          function_name: FunctionName.CHAT_COMPLETE,
          method: HttpMethod.POST,
          request_url: 'https://api.openai.com/v1/chat/completions',
          status: 200,
          request_body: mockOptions.saRequestData.requestBody,
          response_body: {
            choices: [{ message: { content: 'Hello there!' } }],
          },
          raw_request_body: JSON.stringify(
            mockOptions.saRequestData.requestBody,
          ),
          raw_response_body:
            '{"choices":[{"message":{"content":"Hello there!"}}]}',
          cache_status: 'miss',
          cache_mode: CacheMode.DISABLED,
        }),
      );
    });

    it('keeps when the provider was asked and answered on the log', async () => {
      // What the handler left on the context around the provider call.
      const timing: Record<string, number> = {
        provider_start_time: 6000,
        provider_end_time: 6250,
      };
      const context = {
        set: vi.fn(),
        get: (key: string) => timing[key],
      } as unknown as AppContext;

      await createResponse(context, mockOptions);

      expect(context.set).toHaveBeenCalledWith(
        'ai_provider_log',
        expect.objectContaining({ start_time: 6000, end_time: 6250 }),
      );
    });

    it('leaves a cache hit untimed, since it asked no provider', async () => {
      // Timing left behind by a target tried before the hit.
      const timing: Record<string, number> = {
        provider_start_time: 6000,
        provider_end_time: 6250,
      };
      const context = {
        set: vi.fn(),
        get: (key: string) => timing[key],
      } as unknown as AppContext;
      mockOptions.cacheStatus = 'HIT' as CacheStatus;

      await createResponse(context, mockOptions);

      expect(context.set).toHaveBeenCalledWith(
        'ai_provider_log',
        expect.not.objectContaining({ start_time: expect.anything() }),
      );
    });

    it('should handle streaming mode correctly', async () => {
      mockOptions.isStreamingMode = true;

      await createResponse(mockContext, mockOptions);

      expect(responseHandler).toHaveBeenCalledWith(
        mockResponse,
        true, // isStreamingMode
        'openai',
        undefined,
        'https://api.openai.com/v1/chat/completions',
        'miss',
        mockOptions.saRequestData,
        true,
        true,
        expect.any(Function), // onFirstChunk callback (function for streaming)
        expect.any(Function), // streamEndResolver callback (function for streaming)
      );
    });

    it('should handle different providers correctly', async () => {
      mockOptions.provider = 'anthropic' as AIProvider;

      await createResponse(mockContext, mockOptions);

      expect(responseHandler).toHaveBeenCalledWith(
        mockResponse,
        false,
        'anthropic',
        undefined,
        'https://api.openai.com/v1/chat/completions',
        'miss',
        mockOptions.saRequestData,
        true,
        true,
        undefined, // onFirstChunk callback (undefined for non-streaming)
        undefined, // streamEndResolver callback (undefined for non-streaming)
      );
    });

    it('should handle different cache statuses', async () => {
      mockOptions.cacheStatus = 'hit' as CacheStatus;

      await createResponse(mockContext, mockOptions);

      expect(mockContext.set).toHaveBeenCalledWith(
        'ai_provider_log',
        expect.objectContaining({
          cache_status: 'hit',
        }),
      );
    });
  });

  describe('error handling', () => {
    it('should throw HttpError when response is not ok', async () => {
      const errorResponse = {
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        headers: new Headers({ 'content-type': 'application/json' }),
        clone: vi.fn(),
        text: vi.fn().mockResolvedValue('{"error": "Invalid request"}'),
      } as unknown as Response;

      vi.mocked(responseHandler).mockResolvedValue({
        response: errorResponse,
        saResponseBody: null,
      });

      const errorResponseClone = {
        text: vi.fn().mockResolvedValue('{"error": "Invalid request"}'),
      };
      vi.mocked(errorResponse.clone).mockReturnValue(
        errorResponseClone as unknown as Response,
      );

      await expect(
        createResponse(mockContext, {
          ...mockOptions,
          response: errorResponse,
        }),
      ).rejects.toThrow(HttpError);

      expect(mockContext.set).toHaveBeenCalledWith(
        'ai_provider_log',
        expect.objectContaining({
          status: 400,
          response_body: { error: 'Invalid request' },
          raw_response_body: '{"error": "Invalid request"}',
        }),
      );
    });

    it('should handle non-JSON response text', async () => {
      const textResponse = {
        ok: true,
        status: 200,
        statusText: 'OK',
        clone: vi.fn(),
        text: vi.fn().mockResolvedValue('Plain text response'),
      } as unknown as Response;

      vi.mocked(responseHandler).mockResolvedValue({
        response: textResponse,
        saResponseBody: null,
      });

      const textResponseClone = {
        text: vi.fn().mockResolvedValue('Plain text response'),
      };
      vi.mocked(textResponse.clone).mockReturnValue(
        textResponseClone as unknown as Response,
      );

      await expect(
        createResponse(mockContext, {
          ...mockOptions,
          response: textResponse,
        }),
      ).rejects.toThrow('Unexpected token');
    });
  });

  describe('edge cases', () => {
    it('should handle empty response body', async () => {
      const emptyResponseClone = {
        text: vi.fn().mockResolvedValue(''),
      };
      vi.mocked(mockResponse.clone).mockReturnValue(
        emptyResponseClone as unknown as Response,
      );

      await expect(createResponse(mockContext, mockOptions)).rejects.toThrow(
        'Unexpected end of JSON input',
      );
    });

    it('should handle null response body', async () => {
      const nullResponseClone = {
        text: vi.fn().mockResolvedValue('null'),
      };
      vi.mocked(mockResponse.clone).mockReturnValue(
        nullResponseClone as unknown as Response,
      );

      const result = await createResponse(mockContext, mockOptions);

      expect(result).toBe(mockResponse);
      expect(mockContext.set).toHaveBeenCalledWith(
        'ai_provider_log',
        expect.objectContaining({
          response_body: null,
          raw_response_body: 'null',
        }),
      );
    });

    it('should handle cache key when provided', async () => {
      mockOptions.cacheKey = 'test-cache-key';

      await createResponse(mockContext, mockOptions);

      // The cache key should be available in the options but not directly used in the log
      expect(mockOptions.cacheKey).toBe('test-cache-key');
    });
  });
});

describe('extractOutputFromResponseBody', () => {
  const chatBodyWith = (message: Record<string, unknown>) =>
    ({
      id: 'chatcmpl-1',
      object: 'chat.completion',
      created: 1,
      model: 'test-model',
      choices: [{ index: 0, finish_reason: 'stop', message }],
    }) as unknown as SuperAgentsResponseBody;

  it('returns plain content unchanged', () => {
    const output = extractOutputFromResponseBody(
      chatBodyWith({ role: 'assistant', content: 'All done.' }),
    );

    expect(output).toBe('All done.');
  });

  it('renders the tool calls of a turn with no content', () => {
    // An agentic turn: the action is the tool call, `content` is null. The
    // judge used to be told the agent produced nothing, and scored it 0.
    const output = extractOutputFromResponseBody(
      chatBodyWith({
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'bash', arguments: '{"command":"git status"}' },
          },
        ],
      }),
    );

    expect(output).toBe(
      'Assistant Tool Calls:\n' +
        'Tool Call Name: bash\n' +
        'Tool Call Arguments: {"command":"git status"}',
    );
  });

  it('keeps content and tool calls together when a turn has both', () => {
    const output = extractOutputFromResponseBody(
      chatBodyWith({
        role: 'assistant',
        content: 'Checking the working tree first.',
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'bash', arguments: '{"command":"git diff"}' },
          },
        ],
      }),
    );

    expect(output).toContain('Checking the working tree first.');
    expect(output).toContain('Tool Call Name: bash');
  });
});

describe('responseEndsInToolCalls', () => {
  const chatWith = (
    message: Record<string, unknown>,
    finishReason = 'stop',
  ): SuperAgentsResponseBody =>
    ({
      id: 'chatcmpl-1',
      object: 'chat.completion',
      created: 1,
      model: 'test-model',
      choices: [{ index: 0, finish_reason: finishReason, message }],
    }) as unknown as SuperAgentsResponseBody;

  it('detects a turn that hands control to tools', () => {
    const body = chatWith(
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'c1',
            type: 'function',
            function: { name: 'bash', arguments: '{}' },
          },
        ],
      },
      'tool_calls',
    );

    expect(responseEndsInToolCalls(body)).toBe(true);
  });

  it('is false for a plain answer', () => {
    const body = chatWith({ role: 'assistant', content: 'Done.' });

    expect(responseEndsInToolCalls(body)).toBe(false);
  });
});
