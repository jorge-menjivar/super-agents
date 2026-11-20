import { FunctionName } from '@shared/types/api/request';
import type { SuperAgentsRequestData } from '@shared/types/api/request/body';
import {
  type ChatCompletionMessage,
  ChatCompletionMessageRole,
} from '@shared/types/api/routes/shared/messages';
import { systemOneInstructionsText } from '@shared/utils/system-one';

function contentText(content: ChatCompletionMessage['content']): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part.text === 'string' ? part.text : ''))
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

/** The text of every `system` and `developer` message, in order. */
function instructionMessages(messages: unknown[]): string[] {
  const texts: string[] = [];
  for (const message of messages) {
    if (typeof message !== 'object' || message === null) {
      continue;
    }
    if (!('role' in message)) {
      continue;
    }
    if (
      message.role !== ChatCompletionMessageRole.SYSTEM &&
      message.role !== ChatCompletionMessageRole.DEVELOPER
    ) {
      continue;
    }
    const text = contentText((message as ChatCompletionMessage).content);
    if (text) {
      texts.push(text);
    }
  }
  return texts;
}

/**
 * The system prompt a request carries, as the caller wrote it.
 *
 * Chat completions put it in `system` (or `developer`) messages; the Responses
 * API also has a top-level `instructions` field. A System One request has its
 * questions' instructions instead (`systemOneInstructionsText`). When there
 * are several they are joined in order, so the result reads as the one prompt
 * the model saw.
 * Returns `null` when the request has none, and for endpoints that have no
 * notion of a system prompt.
 */
export function extractSystemPrompt(
  saRequestData: SuperAgentsRequestData | null | undefined,
): string | null {
  if (!saRequestData) {
    return null;
  }

  const texts: string[] = [];
  switch (saRequestData.functionName) {
    case FunctionName.CHAT_COMPLETE:
    case FunctionName.STREAM_CHAT_COMPLETE:
      texts.push(...instructionMessages(saRequestData.requestBody.messages));
      break;
    case FunctionName.CREATE_MODEL_RESPONSE: {
      const { instructions, input } = saRequestData.requestBody;
      if (instructions) {
        texts.push(instructions);
      }
      if (Array.isArray(input)) {
        texts.push(...instructionMessages(input));
      }
      break;
    }
    case FunctionName.SYSTEM_ONE:
      return systemOneInstructionsText(saRequestData.requestBody);
    default:
      return null;
  }

  const prompt = texts.join('\n\n');
  return prompt || null;
}
