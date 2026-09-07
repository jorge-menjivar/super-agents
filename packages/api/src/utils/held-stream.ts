import { openAIChatCompleteJSONToStreamResponseTransform } from '@api/ai-providers/openai/chat-complete';
import { openAICompleteJSONToStreamResponseTransform } from '@api/ai-providers/openai/complete';
import { handleJSONToStreamResponse } from '@api/handlers/stream-handler';
import type { JSONToStreamGeneratorTransformFunction } from '@api/types/ai-providers-config';
import { FunctionName } from '@shared/types/api/request/function-name';
import type { SuperAgentsConfig } from '@shared/types/api/request/headers';
import type { AIProvider } from '@shared/types/constants';
import { HookType } from '@shared/types/middleware/hooks';

/**
 * A blocking output hook has to see the whole response before the client
 * does, which a stream cannot offer: by the time the last chunk is judged the
 * first has long been delivered. So a stream such a hook would review is
 * *held*: the provider is asked for the answer whole, the hooks judge it, and
 * what they allow is streamed to the client at the end -- as SSE, all at
 * once. A denial reaches the client as the same JSON error a non-streaming
 * request gets, which streaming clients report as an error rather than parse
 * as events.
 *
 * Only the two functions output hooks run for are held. A streaming Responses
 * API request is not reviewed today, held or otherwise.
 */

/** The non-streaming function a held stream is served as, or null when it cannot be held. */
export function unstreamedFunction(
  functionName: FunctionName,
): FunctionName | null {
  switch (functionName) {
    case FunctionName.STREAM_CHAT_COMPLETE:
      return FunctionName.CHAT_COMPLETE;
    case FunctionName.STREAM_COMPLETE:
      return FunctionName.COMPLETE;
    default:
      return null;
  }
}

/** Whether the config carries an output hook the response has to wait for. */
export function hasBlockingOutputHooks(
  saConfig: Pick<SuperAgentsConfig, 'hooks'>,
): boolean {
  return saConfig.hooks.some(
    (hook) => hook.type === HookType.OUTPUT_HOOK && hook.await,
  );
}

/**
 * The function to serve a streaming request as, when a blocking output hook
 * means it has to be held; null when it streams straight through.
 */
export function heldStreamFunction(
  saConfig: Pick<SuperAgentsConfig, 'hooks'>,
  functionName: FunctionName,
): FunctionName | null {
  return hasBlockingOutputHooks(saConfig)
    ? unstreamedFunction(functionName)
    : null;
}

/**
 * The held response as the stream the client asked for. An error -- a hook's
 * denial among them -- is passed through as it is.
 */
export async function releaseHeldStream(
  response: Response,
  provider: AIProvider,
  functionName: FunctionName,
): Promise<Response> {
  if (!response.ok) {
    return response;
  }
  const transform =
    functionName === FunctionName.COMPLETE
      ? openAICompleteJSONToStreamResponseTransform
      : openAIChatCompleteJSONToStreamResponseTransform;
  return await handleJSONToStreamResponse(
    response,
    provider,
    transform as unknown as JSONToStreamGeneratorTransformFunction,
  );
}
