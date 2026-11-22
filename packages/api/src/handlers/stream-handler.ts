import {
  getStreamModeSplitPattern,
  type SplitPatternType,
} from '@api/utils/object';
import { unwrapJsonResponseContent } from '@api/utils/structured-output';
import { warn } from '@shared/console-logging';
import type {
  JSONToStreamGeneratorTransformFunction,
  ResponseChunkStreamTransformFunction,
  ResponseTransformFunction,
} from '@shared/types/ai-providers/config';
import type { SuperAgentsRequestData } from '@shared/types/api/request/body';
import type { SuperAgentsResponseBody } from '@shared/types/api/response/body';
import type { ChatCompletionResponseBody } from '@shared/types/api/routes/chat-completions-api';
import type { CompletionResponseBody } from '@shared/types/api/routes/completions-api';
import {
  AIProvider,
  ContentTypeName,
  PRECONDITION_CHECK_FAILED_STATUS_CODE,
  REQUEST_TIMEOUT_STATUS_CODE,
} from '@shared/types/constants';

// Stream processing constants
/**
 * Delay after first chunk to allow client to establish connection and process headers
 * This helps prevent race conditions where the client hasn't fully set up stream handling
 */
const FIRST_CHUNK_DELAY_MS = 25;

/**
 * Small delay between chunks for Azure OpenAI to prevent rate limiting
 * Azure OpenAI requires throttling between chunks to avoid connection issues
 */
const AZURE_CHUNK_DELAY_MS = 1;

/**
 * Maximum size for accumulated stream chunks in bytes (10 MB)
 * Protects against memory exhaustion from extremely long streams
 */
const MAX_ACCUMULATED_CHUNKS_SIZE = 10 * 1024 * 1024;

// Helper function to clean response headers by removing compression-related headers
function cleanResponseHeaders(
  originalHeaders: Headers,
): Record<string, string> {
  const cleanedHeaders: Record<string, string> = {};
  const headersToExclude = new Set([
    'content-encoding',
    'content-length', // Will be wrong after decompression
    'transfer-encoding',
    'vary', // Often related to compression negotiation
  ]);

  for (const [key, value] of originalHeaders.entries()) {
    if (!headersToExclude.has(key.toLowerCase())) {
      cleanedHeaders[key] = value;
    }
  }

  return cleanedHeaders;
}

function readUInt32BE(buffer: Uint8Array, offset: number): number {
  return (
    ((buffer[offset] << 24) |
      (buffer[offset + 1] << 16) |
      (buffer[offset + 2] << 8) |
      buffer[offset + 3]) >>>
    0
  ); // Ensure the result is an unsigned integer
}

function getPayloadFromAWSChunk(chunk: Uint8Array): string {
  const decoder = new TextDecoder();
  const chunkLength = readUInt32BE(chunk, 0);
  const headersLength = readUInt32BE(chunk, 4);

  // prelude 8 + Prelude crc 4 = 12
  const headersEnd = 12 + headersLength;

  const payloadLength = chunkLength - headersEnd - 4; // Subtracting 4 for the message crc
  const payload = chunk.slice(headersEnd, headersEnd + payloadLength);
  const decodedJson = JSON.parse(decoder.decode(payload));
  return decodedJson.bytes
    ? Buffer.from(decodedJson.bytes, 'base64').toString()
    : JSON.stringify(decodedJson);
}

function concatenateUint8Arrays(a: Uint8Array, b: Uint8Array): Uint8Array {
  const result = new Uint8Array(a.length + b.length);
  result.set(a, 0); // Copy contents of array 'a' into 'result' starting at index 0
  result.set(b, a.length); // Copy contents of array 'b' into 'result' starting at index 'a.length'
  return result;
}

export async function* readAWSStream(
  reader: ReadableStreamDefaultReader,
  transformFunction: ResponseChunkStreamTransformFunction | undefined,
  fallbackChunkId: string,
  strictOpenAiCompliance: boolean,
  saRequestData: SuperAgentsRequestData,
  onFirstChunk?: () => void,
): AsyncGenerator<string | Uint8Array, void, unknown> {
  let buffer = new Uint8Array() as Uint8Array<ArrayBufferLike>;
  let expectedLength = 0;
  const streamState = {};
  let isFirstChunk = true;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      if (buffer.length) {
        expectedLength = readUInt32BE(buffer, 0);
        while (buffer.length >= expectedLength && buffer.length !== 0) {
          const data = buffer.subarray(0, expectedLength);
          buffer = buffer.subarray(expectedLength);
          expectedLength = readUInt32BE(buffer, 0);
          const payload = getPayloadFromAWSChunk(data);
          if (transformFunction) {
            const transformedChunk = transformFunction(
              payload,
              fallbackChunkId,
              streamState,
              strictOpenAiCompliance,
              saRequestData,
            );
            if (Array.isArray(transformedChunk)) {
              for (const item of transformedChunk) {
                yield item;
              }
            } else {
              yield transformedChunk;
            }
          } else {
            yield data;
          }
        }
      }
      break;
    }

    if (expectedLength === 0) {
      expectedLength = readUInt32BE(value, 0);
    }

    buffer = concatenateUint8Arrays(buffer, value);

    while (buffer.length >= expectedLength && buffer.length !== 0) {
      const data = buffer.subarray(0, expectedLength);
      buffer = buffer.subarray(expectedLength);

      expectedLength = readUInt32BE(buffer, 0);
      const payload = getPayloadFromAWSChunk(data);

      if (isFirstChunk && onFirstChunk) {
        onFirstChunk();
        isFirstChunk = false;
      }

      if (transformFunction) {
        const transformedChunk = transformFunction(
          payload,
          fallbackChunkId,
          streamState,
          strictOpenAiCompliance,
          saRequestData,
        );
        if (Array.isArray(transformedChunk)) {
          for (const item of transformedChunk) {
            yield item;
          }
        } else {
          yield transformedChunk;
        }
      } else {
        yield data;
      }
    }
  }
}

export async function* readStream(
  reader: ReadableStreamDefaultReader,
  splitPattern: SplitPatternType,
  transformFunction: ResponseChunkStreamTransformFunction | undefined,
  isSleepTimeRequired: boolean,
  fallbackChunkId: string,
  strictOpenAiCompliance: boolean,
  saRequestData: SuperAgentsRequestData,
  onFirstChunk?: () => void,
): AsyncGenerator<string | Uint8Array, void, unknown> {
  let buffer = '';
  const decoder = new TextDecoder();
  let isFirstChunk = true;
  const streamState = {};

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      if (buffer.length > 0) {
        if (transformFunction) {
          const transformedChunk = transformFunction(
            buffer,
            fallbackChunkId,
            streamState,
            strictOpenAiCompliance,
            saRequestData,
          );
          if (Array.isArray(transformedChunk)) {
            for (const item of transformedChunk) {
              yield item;
            }
          } else {
            yield transformedChunk;
          }
        } else {
          yield buffer;
        }
      }
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    // keep buffering until we have a complete chunk

    while (buffer.split(splitPattern).length > 1) {
      const parts = buffer.split(splitPattern);
      const lastPart = parts.pop() ?? ''; // remove the last part from the array and keep it in buffer
      for (const part of parts) {
        // Some providers send ping event which can be ignored during parsing

        if (part.length > 0) {
          if (isFirstChunk) {
            if (onFirstChunk) {
              onFirstChunk();
            }
            isFirstChunk = false;
            await new Promise((resolve) =>
              setTimeout(resolve, FIRST_CHUNK_DELAY_MS),
            );
          } else if (isSleepTimeRequired) {
            await new Promise((resolve) =>
              setTimeout(resolve, AZURE_CHUNK_DELAY_MS),
            );
          }

          if (transformFunction) {
            const transformedChunk = transformFunction(
              part,
              fallbackChunkId,
              streamState,
              strictOpenAiCompliance,
              saRequestData,
            );
            if (Array.isArray(transformedChunk)) {
              for (const item of transformedChunk) {
                yield item;
              }
            } else {
              yield transformedChunk;
            }
          } else {
            yield part + splitPattern;
          }
        }
      }

      buffer = lastPart; // keep the last part (after the last '\n\n') in buffer
    }
  }
}

export async function handleTextResponse(
  aiProviderResponse: Response,
  responseTransformer: ResponseTransformFunction | undefined,
  saRequestData: SuperAgentsRequestData,
): Promise<Response> {
  const text = await aiProviderResponse.text();

  if (responseTransformer) {
    const transformedText = responseTransformer(
      { 'html-message': text },
      aiProviderResponse.status,
      aiProviderResponse.headers,
      false,
      saRequestData,
    );
    return new Response(JSON.stringify(transformedText), {
      ...aiProviderResponse,
      status: aiProviderResponse.status,
      headers: new Headers({
        ...cleanResponseHeaders(aiProviderResponse.headers),
        'content-type': 'application/json',
      }),
    });
  }

  return new Response(text, aiProviderResponse);
}

export async function handleNonStreamingMode(
  aiProviderResponse: Response,
  responseTransformer: ResponseTransformFunction | undefined,
  strictOpenAiCompliance: boolean,
  saRequestData: SuperAgentsRequestData,
  areSyncHooksAvailable: boolean,
): Promise<{
  response: Response;
  saResponseBody: SuperAgentsResponseBody | null;
  originalBodyJson?: Record<string, unknown> | null;
}> {
  // 408 is thrown whenever a request takes more than request_timeout to respond.
  // In that case, response thrown by gateway is already in OpenAI format.
  // So no need to transform it again.
  if (
    [
      REQUEST_TIMEOUT_STATUS_CODE,
      PRECONDITION_CHECK_FAILED_STATUS_CODE,
    ].includes(aiProviderResponse.status)
  ) {
    return {
      response: aiProviderResponse,
      saResponseBody: await aiProviderResponse.clone().json(),
    };
  }

  let originalResponseBodyJson: Record<string, unknown> | null = null;
  const originalResponseBodyText: string = await aiProviderResponse
    .clone()
    .text();
  try {
    originalResponseBodyJson = JSON.parse(originalResponseBodyText);
  } catch {
    // Maybe the response is not meant to be JSON. Do nothing.
  }

  let transformedBodyJson: Record<string, unknown> | Blob | null =
    originalResponseBodyJson;
  if (responseTransformer && originalResponseBodyJson) {
    transformedBodyJson = responseTransformer(
      originalResponseBodyJson,
      aiProviderResponse.status,
      aiProviderResponse.headers,
      strictOpenAiCompliance,
      saRequestData,
    );
  }

  // A provider that only saw `response_format` as a prompt instruction may have
  // answered with the JSON inside a markdown fence. Unwrap it before validation
  // so the caller gets content it can parse.
  if (transformedBodyJson && !(transformedBodyJson instanceof Blob)) {
    transformedBodyJson = unwrapJsonResponseContent(
      saRequestData,
      transformedBodyJson,
    );
  }

  // A provider error is transformed above, so its message is in the standard
  // shape, but it is not validated against the function's response schema --
  // an error body never matches it, and the point is to hand the caller the
  // provider's message on the provider's status code.
  if (!aiProviderResponse.ok) {
    return {
      response: new Response(
        transformedBodyJson && !(transformedBodyJson instanceof Blob)
          ? JSON.stringify(transformedBodyJson)
          : originalResponseBodyText,
        {
          status: aiProviderResponse.status,
          statusText: aiProviderResponse.statusText,
          headers: new Headers(
            cleanResponseHeaders(aiProviderResponse.headers),
          ),
        },
      ),
      saResponseBody: null,
      originalBodyJson:
        transformedBodyJson instanceof Blob ? null : transformedBodyJson,
    };
  }

  // Make sure that the response body is in the expected format.
  let saResponseBody: SuperAgentsResponseBody | null = null;
  if (transformedBodyJson) {
    const saResponseBodyParseResult =
      saRequestData.responseSchema.safeParse(transformedBodyJson);
    if (!saResponseBodyParseResult.success) {
      throw new Error(
        `Invalid response body: ${saResponseBodyParseResult.error}`,
      );
    }
    saResponseBody = saResponseBodyParseResult.data as SuperAgentsResponseBody;
  }
  if (!areSyncHooksAvailable) {
    return {
      response: new Response(
        saResponseBody
          ? JSON.stringify(saResponseBody)
          : originalResponseBodyText,
        {
          ...aiProviderResponse,
          headers: new Headers(
            cleanResponseHeaders(aiProviderResponse.headers),
          ),
        },
      ),
      saResponseBody, // TODO: Review if this is necessary
      originalBodyJson:
        transformedBodyJson instanceof Blob ? null : transformedBodyJson,
    };
  }

  return {
    response: new Response(JSON.stringify(saResponseBody), {
      ...aiProviderResponse,
      headers: new Headers(cleanResponseHeaders(aiProviderResponse.headers)),
    }),
    saResponseBody,
    // Send original response if transformer exists
    ...(responseTransformer && {
      originalBodyJson:
        transformedBodyJson instanceof Blob ? null : transformedBodyJson,
    }),
  };
}

export function handleAudioResponse(response: Response): Response {
  return new Response(response.body, response);
}

export function handleOctetStreamResponse(response: Response): Response {
  return new Response(response.body, response);
}

export function handleImageResponse(response: Response): Response {
  return new Response(response.body, response);
}

/**
 * The pumps below copy a provider's stream to the client in the background,
 * where nothing awaits them: an error they let out -- the one a write raises
 * when the client has gone, or the one closing an errored stream raises --
 * is an unhandled rejection, and Node ends the process on one. A client that
 * stopped reading took the whole server down with it, and so did a hook
 * withholding a stream it could not judge. So a pump handles its own end.
 */
function closeQuietly(writer: WritableStreamDefaultWriter): void {
  writer.close().catch(() => undefined);
}

/**
 * A pump that cannot go on: the client stopped reading, or the provider's
 * stream failed. The provider is told to stop sending, rather than left
 * streaming to nobody.
 */
function stopPumping(
  what: string,
  reader: ReadableStreamDefaultReader,
  reason: unknown,
): void {
  warn(`[Stream Handler] Stopped copying the ${what}`, reason);
  reader.cancel(reason).catch(() => undefined);
}

export function handleStreamingMode(
  response: Response,
  provider: AIProvider,
  responseTransformer: ResponseChunkStreamTransformFunction | undefined,
  aiProviderRequestURL: string,
  saRequestData: SuperAgentsRequestData,
  strictOpenAiCompliance: boolean,
  onFirstChunk?: () => void,
  onStreamEnd?: (accumulatedChunks: string) => void,
): Response {
  const splitPattern = getStreamModeSplitPattern(
    provider,
    aiProviderRequestURL,
  );
  // If the provider doesn't supply completion id,
  // we generate a fallback id using the provider name + timestamp.
  const fallbackChunkId = `${provider}-${Date.now().toString()}`;

  if (!response.body) {
    throw new Error('Response format is invalid. Body not found');
  }
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const reader = response.body.getReader();
  const isSleepTimeRequired = provider === AIProvider.AZURE_OPENAI;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  // Accumulate chunks for logging
  let accumulatedChunks = '';

  if (provider === AIProvider.BEDROCK) {
    void (async () => {
      try {
        for await (const chunk of readAWSStream(
          reader,
          responseTransformer,
          fallbackChunkId,
          strictOpenAiCompliance,
          saRequestData,
          onFirstChunk,
        )) {
          const encodedChunk = encoder.encode(chunk as string);
          const decodedChunk = decoder.decode(encodedChunk, { stream: true });

          // Check size limit before accumulating
          const newSize =
            new TextEncoder().encode(accumulatedChunks).length +
            new TextEncoder().encode(decodedChunk).length;
          if (newSize > MAX_ACCUMULATED_CHUNKS_SIZE) {
            warn(
              '[Stream Handler] Accumulated chunks exceed size limit, stopping accumulation',
              { currentSize: newSize, maxSize: MAX_ACCUMULATED_CHUNKS_SIZE },
            );
            // Continue writing to client but stop accumulating
            await writer.write(encodedChunk);
            continue;
          }

          accumulatedChunks += decodedChunk;
          await writer.write(encodedChunk);
        }
      } catch (streamError) {
        stopPumping('Bedrock stream', reader, streamError);
      } finally {
        closeQuietly(writer);
        if (onStreamEnd) {
          onStreamEnd(accumulatedChunks);
        }
      }
    })();
  } else {
    void (async () => {
      try {
        for await (const chunk of readStream(
          reader,
          splitPattern,
          responseTransformer,
          isSleepTimeRequired,
          fallbackChunkId,
          strictOpenAiCompliance,
          saRequestData,
          onFirstChunk,
        )) {
          const encodedChunk = encoder.encode(chunk as string);
          const decodedChunk = decoder.decode(encodedChunk, { stream: true });

          // Check size limit before accumulating
          const newSize =
            new TextEncoder().encode(accumulatedChunks).length +
            new TextEncoder().encode(decodedChunk).length;
          if (newSize > MAX_ACCUMULATED_CHUNKS_SIZE) {
            warn(
              '[Stream Handler] Accumulated chunks exceed size limit, stopping accumulation',
              { currentSize: newSize, maxSize: MAX_ACCUMULATED_CHUNKS_SIZE },
            );
            // Continue writing to client but stop accumulating
            await writer.write(encodedChunk);
            continue;
          }

          accumulatedChunks += decodedChunk;
          await writer.write(encodedChunk);
        }
      } catch (streamError) {
        stopPumping('stream', reader, streamError);
      } finally {
        closeQuietly(writer);
        if (onStreamEnd) {
          onStreamEnd(accumulatedChunks);
        }
      }
    })();
  }

  // Convert GEMINI/COHERE json stream to text/event-stream for non-proxy calls
  const isGoogleCohereOrBedrock = [
    AIProvider.GOOGLE,
    AIProvider.COHERE,
    AIProvider.BEDROCK,
  ].includes(provider);
  // const isVertexLlama =
  //   proxyProvider === AIProviderName.enum['vertex-ai'] &&
  //   responseTransformer?.name ===
  //     VertexLlamaChatCompleteStreamChunkTransform.name;
  // const isJsonStream = isGoogleCohereOrBedrock || isVertexLlama;
  const isJsonStream = isGoogleCohereOrBedrock;
  if (isJsonStream && responseTransformer) {
    return new Response(readable, {
      ...response,
      headers: new Headers({
        ...cleanResponseHeaders(response.headers),
        'content-type': 'text/event-stream',
      }),
    });
  }

  return new Response(readable, response);
}

export async function handleJSONToStreamResponse(
  response: Response,
  provider: AIProvider,
  responseTransformerFunction: JSONToStreamGeneratorTransformFunction,
): Promise<Response> {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const responseJSON: ChatCompletionResponseBody | CompletionResponseBody =
    await response.clone().json();

  if (
    Object.prototype.toString.call(responseTransformerFunction) ===
    '[object GeneratorFunction]'
  ) {
    const generator = responseTransformerFunction(responseJSON, provider);
    void (async () => {
      try {
        while (true) {
          const chunk = generator.next();
          if (chunk.done) {
            break;
          }
          await writer.write(encoder.encode(chunk.value));
        }
      } catch (streamError) {
        warn('[Stream Handler] Stopped replaying a held stream', streamError);
      } finally {
        closeQuietly(writer);
      }
    })();
  } else {
    const streamChunkArray = responseTransformerFunction(
      responseJSON,
      provider,
    );
    void (async () => {
      try {
        for (const chunk of streamChunkArray) {
          await writer.write(encoder.encode(chunk));
        }
      } catch (streamError) {
        warn('[Stream Handler] Stopped replaying a held stream', streamError);
      } finally {
        closeQuietly(writer);
      }
    })();
  }

  return new Response(readable, {
    headers: new Headers({
      ...cleanResponseHeaders(response.headers),
      'content-type': ContentTypeName.EVENT_STREAM,
    }),
    status: response.status,
    statusText: response.statusText,
  });
}
