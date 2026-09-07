import { HttpError } from '@api/errors/http';
import { responseHandler } from '@api/handlers/response-handler';
import type { AppContext } from '@api/types/hono';
import type { FunctionName } from '@shared/types/api/request';
import type { SuperAgentsRequestData } from '@shared/types/api/request/body';
import type { SuperAgentsResponseBody } from '@shared/types/api/response';
import type { AIProvider } from '@shared/types/constants';
import type { AIProviderRequestLog } from '@shared/types/data';
import {
  type CacheSettings,
  CacheStatus,
} from '@shared/types/middleware/cache';

export interface CommonRequestOptions {
  saRequestData: SuperAgentsRequestData;
  aiProviderRequestURL: string;
  isStreamingMode: boolean;
  provider: AIProvider;
  strictOpenAiCompliance: boolean;
  areSyncHooksAvailable: boolean;
  currentIndex: number | string;
  fetchOptions: RequestInit;
  cacheSettings: CacheSettings;
}

export interface CreateResponseOptions extends CommonRequestOptions {
  response: Response;
  responseTransformerFunctionName: FunctionName | undefined;
  cacheStatus: CacheStatus;
  retryCount: number | undefined;
  aiProviderRequestBody:
    | Record<string, unknown>
    | ReadableStream
    | FormData
    | ArrayBuffer
    | null;
  cacheKey?: string;
  responseAlreadyHandled?: boolean;
}

/**
 * When the provider was asked and when it had answered, as the handler that
 * called it left them on the context. A cache hit asked no provider, and any
 * timing on the context then belongs to a target tried before it.
 */
const providerTiming = (
  c: AppContext,
  cacheStatus: CacheStatus,
): Pick<AIProviderRequestLog, 'start_time' | 'end_time'> =>
  cacheStatus === CacheStatus.HIT || cacheStatus === CacheStatus.SEMANTIC_HIT
    ? {}
    : {
        start_time: c.get('provider_start_time'),
        end_time: c.get('provider_end_time'),
      };

export async function createResponse(
  c: AppContext,
  options: CreateResponseOptions,
): Promise<Response> {
  // For streaming responses that have already been handled, the stream is already set up
  // in recursiveOutputHookHandler with promise/resolver already configured
  // We just need to create the log entry
  if (options.responseAlreadyHandled && options.isStreamingMode) {
    if (options.saRequestData.requestBody instanceof ReadableStream) {
      throw new Error('ReadableStream is not supported');
    } else if (options.saRequestData.requestBody instanceof FormData) {
      throw new Error('FormData is not supported');
    } else if (options.saRequestData.requestBody instanceof ArrayBuffer) {
      throw new Error('ArrayBuffer is not supported');
    }

    // Create log with placeholder response body
    // Note: first_token_time and accumulated_stream_chunks will be set by callbacks
    const aiProviderLog: AIProviderRequestLog = {
      provider: options.provider,
      function_name: options.saRequestData.functionName,
      method: options.saRequestData.method,
      request_url: options.saRequestData.url,
      status: options.response.status,
      request_body: options.saRequestData.requestBody,
      response_body: null, // Placeholder for streaming responses - null to skip schema validation
      raw_request_body: JSON.stringify(options.saRequestData.requestBody),
      raw_response_body: '', // Placeholder for streaming responses
      cache_status: options.cacheStatus,
      cache_mode: options.cacheSettings.mode,
      ...providerTiming(c, options.cacheStatus),
    };

    c.set('ai_provider_log', aiProviderLog);

    return options.response;
  }

  // Create callbacks for streaming responses
  const onFirstChunk = options.isStreamingMode
    ? () => {
        // Only set if not already set (first chunk)
        if (!c.get('first_token_time')) {
          const firstTokenTime = Date.now();
          c.set('first_token_time', firstTokenTime);
        }
      }
    : undefined;

  // Create a promise that resolves when the stream ends
  let streamEndResolver: ((accumulatedChunks: string) => void) | undefined;
  if (options.isStreamingMode) {
    const streamEndPromise = new Promise<void>((resolve) => {
      streamEndResolver = (accumulatedChunks: string) => {
        c.set('stream_end_time', Date.now());
        c.set('accumulated_stream_chunks', accumulatedChunks);
        resolve();
      };
    });
    c.set('stream_end_promise', streamEndPromise);
  }

  const { response: mappedResponse } = await responseHandler(
    options.response,
    options.isStreamingMode,
    options.provider,
    options.responseTransformerFunctionName,
    options.aiProviderRequestURL,
    options.cacheStatus,
    options.saRequestData,
    options.strictOpenAiCompliance,
    options.areSyncHooksAvailable,
    onFirstChunk,
    streamEndResolver,
  );

  // For streaming responses, create a log with placeholder response body
  if (options.isStreamingMode) {
    if (options.saRequestData.requestBody instanceof ReadableStream) {
      throw new Error('ReadableStream is not supported');
    } else if (options.saRequestData.requestBody instanceof FormData) {
      throw new Error('FormData is not supported');
    } else if (options.saRequestData.requestBody instanceof ArrayBuffer) {
      throw new Error('ArrayBuffer is not supported');
    }

    const aiProviderLog: AIProviderRequestLog = {
      provider: options.provider,
      function_name: options.saRequestData.functionName,
      method: options.saRequestData.method,
      request_url: options.saRequestData.url,
      status: mappedResponse.status,
      request_body: options.saRequestData.requestBody,
      response_body: null, // Placeholder for streaming responses - null to skip schema validation
      raw_request_body: JSON.stringify(options.saRequestData.requestBody),
      raw_response_body: '', // Placeholder for streaming responses
      cache_status: options.cacheStatus,
      cache_mode: options.cacheSettings.mode,
      ...providerTiming(c, options.cacheStatus),
    };

    c.set('ai_provider_log', aiProviderLog);

    return mappedResponse;
  }

  const mappedResponseClone = mappedResponse.clone();
  const mappedResponseCloneText = await mappedResponseClone.text();
  const mappedResponseCloneJson = JSON.parse(mappedResponseCloneText);
  if (options.saRequestData.requestBody instanceof ReadableStream) {
    throw new Error('ReadableStream is not supported');
  } else if (options.saRequestData.requestBody instanceof FormData) {
    throw new Error('FormData is not supported');
  } else if (options.saRequestData.requestBody instanceof ArrayBuffer) {
    throw new Error('ArrayBuffer is not supported');
  }

  const aiProviderLog: AIProviderRequestLog = {
    provider: options.provider,
    function_name: options.saRequestData.functionName,
    method: options.saRequestData.method,
    request_url: options.saRequestData.url,
    status: mappedResponse.status,
    request_body: options.saRequestData.requestBody,
    response_body: mappedResponseCloneJson,
    raw_request_body: JSON.stringify(options.saRequestData.requestBody),
    raw_response_body: mappedResponseCloneText,
    cache_status: options.cacheStatus,
    cache_mode: options.cacheSettings.mode,
    ...providerTiming(c, options.cacheStatus),
  };

  c.set('ai_provider_log', aiProviderLog);

  // If the response was not ok, throw an error
  if (!mappedResponse.ok) {
    const errorObj = new HttpError(await mappedResponse.clone().text(), {
      status: mappedResponse.status,
      statusText: mappedResponse.statusText,
      body: await mappedResponse.text(),
      contentType: mappedResponse.headers.get('content-type') ?? undefined,
    });
    throw errorObj;
  }

  return mappedResponse;
}

/**
 * Whether the response is a turn that hands control back to the caller's
 * tools rather than answering -- the tool results, and the eventual answer,
 * arrive in later requests. Evaluations use this to grade such turns as
 * progress on the task instead of as a finished conversation.
 */
export function responseEndsInToolCalls(
  responseBody: SuperAgentsResponseBody,
): boolean {
  if ('choices' in responseBody) {
    const choice = responseBody.choices[0];
    if (choice && 'message' in choice) {
      if ((choice.message.tool_calls?.length ?? 0) > 0) {
        return true;
      }
      return 'finish_reason' in choice && choice.finish_reason === 'tool_calls';
    }
    return false;
  }
  if ('output' in responseBody) {
    return responseBody.output.some((step) => step.type === 'function');
  }
  return false;
}

export function extractOutputFromResponseBody(
  responseBody: SuperAgentsResponseBody,
): string {
  if ('choices' in responseBody) {
    if ('message' in responseBody.choices[0]) {
      const message = responseBody.choices[0].message;
      const content = message.content;
      let contentString = '';
      if (Array.isArray(content)) {
        for (const chunk of content) {
          contentString += chunk.text;
        }
      } else if (typeof content === 'string') {
        contentString = content;
      } else if (content === null || content === undefined) {
        // No content -- fall back to a text field if the shape carries one.
        if ('text' in responseBody.choices[0]) {
          const text = responseBody.choices[0].text;
          contentString = typeof text === 'string' ? text : '';
        }
      } else {
        throw new Error('Unexpected content type');
      }

      // A turn that calls tools carries its action there, often with no
      // content at all. Dropping the calls starves whatever reads the
      // output -- the evaluations most of all: the judge is told the agent
      // produced nothing and scores the turn 0.
      const toolCalls = message.tool_calls ?? [];
      if (toolCalls.length > 0) {
        const tools = toolCalls
          .map(
            (toolCall) =>
              `Tool Call Name: ${toolCall.function?.name ?? 'unknown'}\nTool Call Arguments: ${toolCall.function?.arguments ?? ''}`,
          )
          .join('\n');
        const calls = `Assistant Tool Calls:\n${tools}`;
        return contentString.trim() ? `${contentString}\n\n${calls}` : calls;
      }

      return contentString;
    } else if ('text' in responseBody.choices[0]) {
      const text = responseBody.choices[0].text;
      return typeof text === 'string' ? text : '';
    }
  } else if ('output' in responseBody) {
    const outputText = responseBody.output_text;
    if (outputText) {
      return outputText;
    } else {
      const output = responseBody.output;
      let outputString = '';
      for (const step of output) {
        switch (step.type) {
          case 'message': {
            if ('content' in step) {
              if (step.content) {
                for (const chunk of step.content) {
                  outputString += chunk.text;
                }
                outputString += '\n';
              }
            } else {
              continue;
            }
            break;
          }
          case 'function':
            outputString += `${step.name}: ${JSON.stringify(step.arguments)}\n`;
            break;
          case 'mcp_call':
            outputString += `${step.name}: ${JSON.stringify(step.arguments)}\n OUTPUT: ${JSON.stringify(step.output)}\n\n`;
            break;
          default:
            continue;
        }
      }
      return outputString;
    }
  }

  throw new Error('Unexpected output type');
}
