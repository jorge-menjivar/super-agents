import OllamaAPIConfig from '@api/ai-providers/ollama/api';
import {
  ollamaChatCompleteConfig,
  ollamaChatCompleteResponseTransform,
  ollamaChatCompleteStreamChunkTransform,
} from '@api/ai-providers/ollama/chat-complete';
import {
  ollamaEmbedConfig,
  ollamaEmbedResponseTransform,
} from '@api/ai-providers/ollama/embed';
import { ollamaConfig } from '@api/ai-providers/ollama/index';
import type {
  OllamaChatCompleteResponse,
  OllamaEmbedResponse,
  OllamaStreamChunk,
} from '@api/ai-providers/ollama/types';
import { ollamaErrorResponseTransform } from '@api/ai-providers/ollama/utils';
import { transformUsingProviderConfig } from '@api/services/transform-to-provider-request';
import type {
  SuperAgentsRequestBody,
  SuperAgentsRequestData,
} from '@shared/types/api/request';
import { FunctionName } from '@shared/types/api/request';
import type { SuperAgentsTarget } from '@shared/types/api/request/headers';
import type { ErrorResponseBody } from '@shared/types/api/response/body';
import type { ChatCompletionResponseBody } from '@shared/types/api/routes/chat-completions-api';
import { ChatCompletionFinishReason } from '@shared/types/api/routes/chat-completions-api';
import { ChatCompletionMessageRole } from '@shared/types/api/routes/shared/messages';
import { AIProvider } from '@shared/types/constants';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type TestContext = Parameters<typeof OllamaAPIConfig.getBaseURL>[0];
type EmbedResponseType = {
  object: string;
  data: Array<{
    object: string;
    embedding: number[];
    index: number;
  }>;
  model: string;
  usage?: {
    prompt_tokens: number;
    total_tokens: number;
  };
};

describe('Ollama Provider Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Provider Configuration', () => {
    it('should have all required configuration properties', () => {
      expect(ollamaConfig).toBeDefined();
      expect(ollamaConfig.api).toBeDefined();
      expect(ollamaConfig[FunctionName.CHAT_COMPLETE]).toBeDefined();
      expect(ollamaConfig[FunctionName.EMBED]).toBeDefined();
      expect(ollamaConfig.responseTransforms).toBeDefined();
    });

    it('should have response transforms for all supported functions', () => {
      expect(
        ollamaConfig.responseTransforms?.[FunctionName.CHAT_COMPLETE],
      ).toBeDefined();
      expect(
        ollamaConfig.responseTransforms?.[FunctionName.STREAM_CHAT_COMPLETE],
      ).toBeDefined();
      expect(
        ollamaConfig.responseTransforms?.[FunctionName.EMBED],
      ).toBeDefined();
    });

    it('should support chat completions and embeddings', () => {
      expect(ollamaConfig[FunctionName.CHAT_COMPLETE]).toBeDefined();
      expect(ollamaConfig[FunctionName.EMBED]).toBeDefined();
      expect(ollamaConfig[FunctionName.COMPLETE]).toBeUndefined();
      expect(ollamaConfig[FunctionName.GENERATE_IMAGE]).toBeUndefined();
    });
  });

  describe('API Configuration', () => {
    it('should return localhost as default base URL for self-hosting', () => {
      const baseURL = OllamaAPIConfig.getBaseURL({
        saTarget: { provider: AIProvider.OLLAMA },
      } as unknown as TestContext);
      expect(baseURL).toBe('http://localhost:11434');
    });

    it('should use custom_host when provided', () => {
      const baseURL = OllamaAPIConfig.getBaseURL({
        saTarget: {
          provider: AIProvider.OLLAMA,
          custom_host: 'http://192.168.1.100:11434',
        },
      } as unknown as TestContext);
      expect(baseURL).toBe('http://192.168.1.100:11434');
    });

    it('should use custom_host for remote Ollama instances', () => {
      const baseURL = OllamaAPIConfig.getBaseURL({
        saTarget: {
          provider: AIProvider.OLLAMA,
          custom_host: 'https://ollama.example.com',
        },
      } as unknown as TestContext);
      expect(baseURL).toBe('https://ollama.example.com');
    });

    it('should return correct headers with API key for remote instances', () => {
      const headers = OllamaAPIConfig.headers({
        saTarget: { provider: AIProvider.OLLAMA, api_key: 'ollama-key-123' },
      } as unknown as TestContext);

      expect(headers).toEqual({
        'Content-Type': 'application/json',
        'x-ollama-api-key': 'ollama-key-123',
      });
    });

    it('should return headers without API key for local instances', () => {
      const headers = OllamaAPIConfig.headers({
        saTarget: { provider: AIProvider.OLLAMA },
      } as unknown as TestContext);

      expect(headers).toEqual({
        'Content-Type': 'application/json',
      });
    });

    it('should return correct endpoint for chat completion', () => {
      const endpoint = OllamaAPIConfig.getEndpoint({
        saRequestData: {
          functionName: FunctionName.CHAT_COMPLETE,
          requestBody: { model: 'llama3.2:latest', messages: [] },
        },
        saTarget: { provider: AIProvider.OLLAMA },
      } as unknown as TestContext);

      expect(endpoint).toBe('/v1/chat/completions');
    });

    it('should return correct endpoint for streaming chat completion', () => {
      const endpoint = OllamaAPIConfig.getEndpoint({
        saRequestData: {
          functionName: FunctionName.STREAM_CHAT_COMPLETE,
          requestBody: { model: 'llama3.2:latest', messages: [] },
        },
        saTarget: { provider: AIProvider.OLLAMA },
      } as unknown as TestContext);

      expect(endpoint).toBe('/v1/chat/completions');
    });

    it('should return correct endpoint for embeddings', () => {
      const endpoint = OllamaAPIConfig.getEndpoint({
        saRequestData: {
          functionName: FunctionName.EMBED,
          requestBody: { model: 'llama3.2:latest', input: 'test' },
        },
        saTarget: { provider: AIProvider.OLLAMA },
      } as unknown as TestContext);

      expect(endpoint).toBe('/api/embeddings');
    });

    it('should handle proxy requests for chat', () => {
      const endpoint = OllamaAPIConfig.getEndpoint({
        saRequestData: {
          functionName: FunctionName.PROXY,
          requestBody: {},
        },
        saTarget: {
          provider: AIProvider.OLLAMA,
          ollama_url_to_fetch: '/api/chat/something',
        },
      } as unknown as TestContext);

      expect(endpoint).toBe('/v1/chat/completions');
    });

    it('should handle proxy requests for embeddings', () => {
      const endpoint = OllamaAPIConfig.getEndpoint({
        saRequestData: {
          functionName: FunctionName.PROXY,
          requestBody: {},
        },
        saTarget: {
          provider: AIProvider.OLLAMA,
          ollama_url_to_fetch: '/embeddings',
        },
      } as unknown as TestContext);

      expect(endpoint).toBe('/api/embeddings');
    });

    it('should return empty string for unsupported functions', () => {
      const endpoint = OllamaAPIConfig.getEndpoint({
        saRequestData: {
          functionName: FunctionName.GENERATE_IMAGE,
          requestBody: {},
        },
        saTarget: { provider: AIProvider.OLLAMA },
      } as unknown as TestContext);

      expect(endpoint).toBe('');
    });
  });

  describe('Chat Complete Configuration', () => {
    it('should have correct model configuration', () => {
      const config = ollamaChatCompleteConfig;
      expect(config.model).toBeDefined();
      expect(config.model).toHaveProperty('param', 'model');
      expect(config.model).toHaveProperty('required', true);
      expect(config.model).toHaveProperty('default', 'llama3.2:latest');
    });

    it('should have correct parameter configurations', () => {
      const config = ollamaChatCompleteConfig;

      expect(config.messages).toBeDefined();
      expect(config.max_tokens).toBeDefined();
      expect(config.max_completion_tokens).toBeDefined();
      expect(config.temperature).toBeDefined();
      expect(config.top_p).toBeDefined();
      expect(config.stream).toBeDefined();
    });

    describe('reasoning_effort, the switch that turns thinking off', () => {
      const sent = (body: Record<string, unknown>) =>
        transformUsingProviderConfig(
          ollamaChatCompleteConfig,
          {
            model: 'glm-5.3-flash:cloud',
            messages: [{ role: 'user', content: 'hi' }],
            ...body,
          } as unknown as SuperAgentsRequestBody,
          {} as SuperAgentsTarget,
        );

      it.each(['none', 'low', 'medium', 'high'])(
        'forwards %s as it is',
        (effort) => {
          expect(sent({ reasoning_effort: effort })).toMatchObject({
            reasoning_effort: effort,
          });
        },
      );

      it('sends minimal as low, since Ollama thinks at full length on a level it does not know', () => {
        expect(sent({ reasoning_effort: 'minimal' })).toMatchObject({
          reasoning_effort: 'low',
        });
      });

      it('sends nothing when the request names no effort', () => {
        expect(sent({})).not.toHaveProperty('reasoning_effort');
      });
    });

    it('should have correct temperature limits', () => {
      const config = ollamaChatCompleteConfig;
      expect(config.temperature).toHaveProperty('min', 0);
      expect(config.temperature).toHaveProperty('max', 2);
      expect(config.temperature).toHaveProperty('default', 1);
    });

    it('should have correct penalty configurations', () => {
      const config = ollamaChatCompleteConfig;
      expect(config.presence_penalty).toHaveProperty('min', -2);
      expect(config.presence_penalty).toHaveProperty('max', 2);
      expect(config.frequency_penalty).toHaveProperty('min', -2);
      expect(config.frequency_penalty).toHaveProperty('max', 2);
    });

    it('should support tool calling', () => {
      const config = ollamaChatCompleteConfig;
      expect(config.tools).toBeDefined();
    });

    it('should support response format', () => {
      const config = ollamaChatCompleteConfig;
      expect(config.response_format).toBeDefined();
    });

    it('should support seed parameter', () => {
      const config = ollamaChatCompleteConfig;
      expect(config.seed).toBeDefined();
    });

    it('should support stop sequences', () => {
      const config = ollamaChatCompleteConfig;
      expect(config.stop).toBeDefined();
    });

    it('should transform developer role to system role', () => {
      const config = ollamaChatCompleteConfig;
      const messagesConfig = Array.isArray(config.messages)
        ? config.messages[0]
        : config.messages;
      const transform = messagesConfig?.transform;

      expect(transform).toBeDefined();

      if (transform) {
        const result = transform({
          messages: [
            {
              role: ChatCompletionMessageRole.DEVELOPER,
              content: 'System message',
            },
            { role: ChatCompletionMessageRole.USER, content: 'User message' },
          ],
        } as never);

        expect(result).toEqual([
          { role: 'system', content: 'System message' },
          { role: ChatCompletionMessageRole.USER, content: 'User message' },
        ]);
      }
    });
  });

  describe('Embed Configuration', () => {
    it('should have correct model configuration', () => {
      const config = ollamaEmbedConfig;
      expect(config.model).toBeDefined();
      expect(config.model).toHaveProperty('param', 'model');
    });

    it('should have correct input configuration', () => {
      const config = ollamaEmbedConfig;
      expect(config.input).toBeDefined();
      expect(config.input).toHaveProperty('param', 'prompt');
      expect(config.input).toHaveProperty('required', true);
    });
  });

  describe('Error Response Transform', () => {
    it('should transform string error response', () => {
      const response = {
        error: 'Model not found',
      };

      const result = ollamaErrorResponseTransform(response, 404);

      expect(result).toMatchObject({
        error: {
          message: 'ollama error: Model not found',
          type: undefined,
          param: undefined,
          code: '404',
        },
        provider: AIProvider.OLLAMA,
      });
    });

    it('should transform object error response', () => {
      const response = {
        error: {
          message: 'Invalid request',
          type: 'invalid_request_error',
          code: 'invalid_model',
        },
      };

      const result = ollamaErrorResponseTransform(response);

      expect(result).toMatchObject({
        error: {
          message: 'ollama error: Invalid request',
          type: 'invalid_request_error',
          code: 'invalid_model',
        },
        provider: AIProvider.OLLAMA,
      });
    });

    it('should handle missing error object', () => {
      const response = {};

      const result = ollamaErrorResponseTransform(response);

      expect(result).toMatchObject({
        error: {
          message: 'ollama error: Unknown error',
        },
        provider: AIProvider.OLLAMA,
      });
    });
  });

  describe('Chat Complete Response Transform', () => {
    it('should transform successful chat completion response', () => {
      const ollamaResponse: OllamaChatCompleteResponse = {
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: 1234567890,
        model: 'llama3.2:latest',
        choices: [
          {
            index: 0,
            message: {
              role: ChatCompletionMessageRole.ASSISTANT,
              content: 'Hello! How can I help you?',
            },
            finish_reason: ChatCompletionFinishReason.STOP,
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 20,
          total_tokens: 30,
        },
        system_fingerprint: 'fp_123',
      };

      const result = ollamaChatCompleteResponseTransform(
        ollamaResponse as unknown as Record<string, unknown>,
        200,
        new Headers(),
        false,
        {} as SuperAgentsRequestData,
      ) as ChatCompletionResponseBody;

      expect(result.id).toBe('chatcmpl-123');
      expect(result.model).toBe('llama3.2:latest');
      expect((result as unknown as { provider: string }).provider).toBe(
        AIProvider.OLLAMA,
      );
      expect(result.choices).toHaveLength(1);
      expect(result.choices[0].message.content).toBe(
        'Hello! How can I help you?',
      );
      expect(result.usage?.total_tokens).toBe(30);
    });

    it('should transform error response with status !== 200', () => {
      const errorResponse = {
        error: {
          message: 'Model not found',
          type: 'not_found_error',
        },
      };

      const result = ollamaChatCompleteResponseTransform(
        errorResponse,
        404,
        new Headers(),
        false,
        {} as SuperAgentsRequestData,
      ) as ErrorResponseBody;

      expect(result.error).toBeDefined();
      expect(result.error.message).toBe('ollama error: Model not found');
      expect(result.provider).toBe(AIProvider.OLLAMA);
    });

    it('should handle response without choices', () => {
      const response = {
        id: 'test-id',
        object: 'chat.completion',
        created: 123,
        model: 'llama3.2:latest',
      };

      const result = ollamaChatCompleteResponseTransform(
        response,
        200,
        new Headers(),
        false,
        {} as SuperAgentsRequestData,
      ) as ErrorResponseBody;

      expect(result.error).toBeDefined();
      expect(result.provider).toBe(AIProvider.OLLAMA);
    });
  });

  describe('Stream Chunk Transform', () => {
    it('should transform streaming chunk', () => {
      const streamChunk: OllamaStreamChunk = {
        id: 'chatcmpl-123',
        object: 'chat.completion.chunk',
        created: 1234567890,
        model: 'llama3.2:latest',
        choices: [
          {
            delta: {
              role: ChatCompletionMessageRole.ASSISTANT,
              content: 'Hello',
            },
            index: 0,
            finish_reason: null,
          },
        ],
      };

      const chunkString = `data: ${JSON.stringify(streamChunk)}`;
      const result = ollamaChatCompleteStreamChunkTransform(
        chunkString,
        'fallback-id',
        {},
        false,
        {} as SuperAgentsRequestData,
      );

      expect(result).toContain('data: ');
      expect(result).toContain('"provider":"ollama"');
      expect(result).toContain('"model":"llama3.2:latest"');
      expect(result).toContain('\n\n');
    });

    it('should handle [DONE] marker', () => {
      const result = ollamaChatCompleteStreamChunkTransform(
        'data: [DONE]',
        'fallback-id',
        {},
        false,
        {} as SuperAgentsRequestData,
      );

      expect(result).toBe('data: [DONE]\n\n');
    });

    it('should throw on malformed streaming chunk', () => {
      expect(() => {
        ollamaChatCompleteStreamChunkTransform(
          'data: {invalid json',
          'fallback-id',
          {},
          false,
          {} as SuperAgentsRequestData,
        );
      }).toThrow();
    });

    it('should trim whitespace from chunks', () => {
      const streamChunk: OllamaStreamChunk = {
        id: 'test',
        object: 'chat.completion.chunk',
        created: 123,
        model: 'llama3.2:latest',
        choices: [
          {
            delta: { content: 'test' },
            index: 0,
            finish_reason: null,
          },
        ],
      };

      const chunkString = `  data: ${JSON.stringify(streamChunk)}  `;
      const result = ollamaChatCompleteStreamChunkTransform(
        chunkString,
        'fallback-id',
        {},
        false,
        {} as SuperAgentsRequestData,
      );

      expect(result).toContain('"provider":"ollama"');
    });
  });

  describe('Thinking', () => {
    // What Ollama really sends: reasoning in a field of its own, beside the
    // content rather than inside it.
    const thinkingResponse = {
      id: 'chatcmpl-871',
      object: 'chat.completion',
      created: 1234567890,
      model: 'glm-5.3-flash',
      choices: [
        {
          index: 0,
          message: {
            role: ChatCompletionMessageRole.ASSISTANT,
            content: '391',
            reasoning: '17 * 23 = 340 + 51',
          },
          finish_reason: ChatCompletionFinishReason.STOP,
        },
      ],
    };

    function streamChunkWith(delta: Record<string, unknown>): string {
      return `data: ${JSON.stringify({
        id: 'chatcmpl-871',
        object: 'chat.completion.chunk',
        created: 1234567890,
        model: 'glm-5.3-flash',
        choices: [{ delta, index: 0, finish_reason: null }],
      })}`;
    }

    it("re-expresses a whole answer's reasoning as a thinking block", () => {
      const result = ollamaChatCompleteResponseTransform(
        thinkingResponse as unknown as Record<string, unknown>,
        200,
        new Headers(),
        false,
        {} as SuperAgentsRequestData,
      ) as ChatCompletionResponseBody;

      expect(result.choices[0].message.content_blocks).toEqual([
        { type: 'thinking', thinking: '17 * 23 = 340 + 51' },
        { type: 'text', text: '391' },
      ]);
      // The field Ollama put it in stays, for a client already reading it.
      expect(
        (result.choices[0].message as { reasoning?: string }).reasoning,
      ).toBe('17 * 23 = 340 + 51');
    });

    // Strict compliance is on unless a request turns it off, and no ordinary
    // client turns it off, so honouring it here would mean no real request
    // ever keeps its thinking.
    it('keeps the thinking of a strictly OpenAI-compliant answer too', () => {
      const result = ollamaChatCompleteResponseTransform(
        thinkingResponse as unknown as Record<string, unknown>,
        200,
        new Headers(),
        true,
        {} as SuperAgentsRequestData,
      ) as ChatCompletionResponseBody;

      expect(result.choices[0].message.content_blocks).toEqual([
        { type: 'thinking', thinking: '17 * 23 = 340 + 51' },
        { type: 'text', text: '391' },
      ]);
      expect(
        (result.choices[0].message as { reasoning?: string }).reasoning,
      ).toBe('17 * 23 = 340 + 51');
    });

    it('leaves a message without reasoning alone', () => {
      const result = ollamaChatCompleteResponseTransform(
        {
          ...thinkingResponse,
          choices: [
            {
              ...thinkingResponse.choices[0],
              message: {
                role: ChatCompletionMessageRole.ASSISTANT,
                content: '391',
              },
            },
          ],
        } as unknown as Record<string, unknown>,
        200,
        new Headers(),
        false,
        {} as SuperAgentsRequestData,
      ) as ChatCompletionResponseBody;

      expect(result.choices[0].message.content_blocks).toBeUndefined();
    });

    it('re-expresses a streamed reasoning delta as a thinking block', () => {
      const result = ollamaChatCompleteStreamChunkTransform(
        streamChunkWith({ role: 'assistant', content: '', reasoning: '17' }),
        'fallback-id',
        {},
        false,
        {} as SuperAgentsRequestData,
      ) as string;

      const chunk = JSON.parse(result.replace(/^data: /, '').trim());
      expect(chunk.choices[0].delta.content_blocks).toEqual([
        { index: 0, delta: { thinking: '17' } },
      ]);
      expect(chunk.choices[0].delta.reasoning).toBe('17');
    });

    it('streams the content beside the thinking when a delta carries both', () => {
      const result = ollamaChatCompleteStreamChunkTransform(
        streamChunkWith({ content: '391', reasoning: ' = 391' }),
        'fallback-id',
        {},
        false,
        {} as SuperAgentsRequestData,
      ) as string;

      const chunk = JSON.parse(result.replace(/^data: /, '').trim());
      expect(chunk.choices[0].delta.content_blocks).toEqual([
        { index: 0, delta: { thinking: ' = 391' } },
        { index: 0, delta: { text: '391' } },
      ]);
    });

    it('keeps the thinking of a strictly OpenAI-compliant stream too', () => {
      const result = ollamaChatCompleteStreamChunkTransform(
        streamChunkWith({ content: '391', reasoning: ' = 391' }),
        'fallback-id',
        {},
        true,
        {} as SuperAgentsRequestData,
      ) as string;

      const chunk = JSON.parse(result.replace(/^data: /, '').trim());
      expect(chunk.choices[0].delta.content_blocks).toEqual([
        { index: 0, delta: { thinking: ' = 391' } },
        { index: 0, delta: { text: '391' } },
      ]);
      expect(chunk.choices[0].delta.reasoning).toBe(' = 391');
    });
  });

  describe('Embed Response Transform', () => {
    it('should transform successful embed response', () => {
      const ollamaResponse: OllamaEmbedResponse = {
        embedding: [0.1, 0.2, 0.3, 0.4],
        model: 'llama3.2:latest',
      };

      const result = ollamaEmbedResponseTransform(
        ollamaResponse as unknown as Record<string, unknown>,
        200,
        new Headers(),
        false,
        {
          requestBody: { model: 'llama3.2:latest', input: 'test' },
        } as SuperAgentsRequestData,
      ) as EmbedResponseType;

      expect(result.object).toBe('list');
      expect(result.data).toHaveLength(1);
      expect(result.data[0].object).toBe('embedding');
      expect(result.data[0].embedding).toEqual([0.1, 0.2, 0.3, 0.4]);
      expect(result.data[0].index).toBe(0);
      expect(result.model).toBe('llama3.2:latest');
    });

    it('should use model from request body if not in response', () => {
      const ollamaResponse: OllamaEmbedResponse = {
        embedding: [0.1, 0.2, 0.3],
      };

      const result = ollamaEmbedResponseTransform(
        ollamaResponse as unknown as Record<string, unknown>,
        200,
        new Headers(),
        false,
        {
          requestBody: { model: 'nomic-embed-text', input: 'test' },
        } as SuperAgentsRequestData,
      ) as EmbedResponseType;

      expect(result.model).toBe('nomic-embed-text');
    });

    it('should transform embed error response', () => {
      const errorResponse = {
        error: 'Invalid model',
      };

      const result = ollamaEmbedResponseTransform(
        errorResponse,
        400,
        new Headers(),
        false,
        {
          requestBody: { model: 'llama3.2:latest', input: 'test' },
        } as SuperAgentsRequestData,
      ) as ErrorResponseBody;

      expect(result.error).toBeDefined();
      expect(result.error.message).toBe('ollama error: Invalid model');
      expect(result.provider).toBe(AIProvider.OLLAMA);
    });

    it('should handle response without embedding', () => {
      const response = {
        model: 'llama3.2:latest',
      };

      const result = ollamaEmbedResponseTransform(
        response,
        200,
        new Headers(),
        false,
        {
          requestBody: { model: 'llama3.2:latest', input: 'test' },
        } as SuperAgentsRequestData,
      ) as ErrorResponseBody;

      expect(result.error).toBeDefined();
      expect(result.provider).toBe(AIProvider.OLLAMA);
    });

    it('should set usage tokens to 0 when not provided', () => {
      const ollamaResponse: OllamaEmbedResponse = {
        embedding: [0.1, 0.2],
        model: 'llama3.2:latest',
      };

      const result = ollamaEmbedResponseTransform(
        ollamaResponse as unknown as Record<string, unknown>,
        200,
        new Headers(),
        false,
        {
          requestBody: { model: 'llama3.2:latest', input: 'test' },
        } as SuperAgentsRequestData,
      ) as EmbedResponseType;

      expect(result.usage?.prompt_tokens).toBe(0);
      expect(result.usage?.total_tokens).toBe(0);
    });
  });
});
