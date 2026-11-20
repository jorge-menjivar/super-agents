import { generateInvalidProviderResponseError } from '@api/utils/ai-provider';
import type {
  AIProviderFunctionConfig,
  ResponseChunkStreamTransformFunction,
  ResponseTransformFunction,
} from '@shared/types/ai-providers/config';
import type {
  ChatCompletionChoice,
  ChatCompletionRequestBody,
} from '@shared/types/api/routes/chat-completions-api';
import {
  type ChatCompletionContentType,
  ChatCompletionMessageRole,
} from '@shared/types/api/routes/shared/messages';
import { AIProvider } from '@shared/types/constants';
import type {
  OllamaChatCompleteChoice,
  OllamaChatCompleteResponse,
  OllamaStreamChoice,
  OllamaStreamChoiceWithBlocks,
  OllamaStreamChunk,
  OllamaStreamContentBlock,
} from './types';
import { ollamaErrorResponseTransform } from './utils';

export const ollamaChatCompleteConfig: AIProviderFunctionConfig = {
  model: {
    param: 'model',
    required: true,
    default: 'llama3.2:latest',
  },
  messages: {
    param: 'messages',
    default: '',
    transform: (params: ChatCompletionRequestBody) => {
      return params.messages?.map((message) => {
        if (message.role === ChatCompletionMessageRole.DEVELOPER)
          return { ...message, role: ChatCompletionMessageRole.SYSTEM };
        return message;
      });
    },
  },
  frequency_penalty: {
    param: 'frequency_penalty',
    min: -2,
    max: 2,
  },
  presence_penalty: {
    param: 'presence_penalty',
    min: -2,
    max: 2,
  },
  response_format: {
    param: 'response_format',
  },
  seed: {
    param: 'seed',
  },
  stop: {
    param: 'stop',
  },
  stream: {
    param: 'stream',
    default: false,
  },
  temperature: {
    param: 'temperature',
    default: 1,
    min: 0,
    max: 2,
  },
  top_p: {
    param: 'top_p',
    default: 1,
    min: 0,
    max: 1,
  },
  max_tokens: {
    param: 'max_tokens',
    default: 100,
    min: 0,
  },
  max_completion_tokens: {
    param: 'max_tokens',
    default: 100,
    min: 0,
  },
  tools: {
    param: 'tools',
  },
  // Ollama's OpenAI-compatible endpoint maps this onto thinking, `none`
  // included, which is the only way to keep a thinking model from spending
  // a request's whole completion budget on reasoning it never shows.
  reasoning_effort: {
    param: 'reasoning_effort',
  },
};

/**
 * Ollama returns a thinking model's reasoning in a field of its own --
 * `choices[].message.reasoning` whole, `choices[].delta.reasoning` streaming
 * -- and that is Ollama's shape, not the gateway's: the gateway carries
 * thinking as a content block, and a content block is what the rest of it
 * reads. A held stream re-streams `content_blocks` and drops whatever is not
 * in them (`openAIChatCompleteJSONToStreamResponseTransform`), and a log row's
 * response is parsed against `ChatCompletionResponseBody`, which strips a
 * field no schema declares. So reasoning left where Ollama put it reaches only
 * a client that already knows to look for it there, and not the log page, and
 * not a client whose agent has a reviewer.
 *
 * It is re-expressed as a thinking block, the way the OpenRouter transform
 * does, and the field itself stays beside the block, since that is what an
 * OpenAI-compatible client reads.
 *
 * Neither is gated on `strictOpenAiCompliance`, which OpenRouter gates its own
 * on: that flag is true unless a request turns it off (`handler-utils.ts`),
 * and no ordinary client turns it off, so gating here would mean thinking
 * never survives a single real request. Dropping what the model spent most of
 * its completion budget on is the worse answer to a question about shape.
 */
function withThinkingBlocks(
  choice: OllamaChatCompleteChoice,
): ChatCompletionChoice {
  const { reasoning, content } = choice.message;

  if (!reasoning) return choice;

  const content_blocks: ChatCompletionContentType[] = [
    { type: 'thinking', thinking: reasoning },
  ];
  // Ollama's OpenAI-compatible endpoint answers with text, but a message whose
  // content is already blocks carries them in `content` and would only be said
  // twice here.
  if (typeof content === 'string') {
    content_blocks.push({ type: 'text', text: content });
  }

  return { ...choice, message: { ...choice.message, content_blocks } };
}

/** The same, for one choice of a stream chunk. */
function withThinkingDeltaBlocks(
  choice: OllamaStreamChoice,
): OllamaStreamChoiceWithBlocks {
  const { reasoning, content } = choice.delta;

  if (!reasoning) return choice;

  const content_blocks: OllamaStreamContentBlock[] = [
    { index: choice.index, delta: { thinking: reasoning } },
  ];
  if (content) {
    content_blocks.push({ index: choice.index, delta: { text: content } });
  }

  return { ...choice, delta: { ...choice.delta, content_blocks } };
}

export const ollamaChatCompleteResponseTransform: ResponseTransformFunction = (
  aiProviderResponseBody,
  aiProviderResponseStatus,
  _aiProviderResponseHeaders,
  _strictOpenAiCompliance,
  _raRequestData,
) => {
  if (aiProviderResponseStatus !== 200 && 'error' in aiProviderResponseBody) {
    return ollamaErrorResponseTransform(
      aiProviderResponseBody,
      aiProviderResponseStatus,
    );
  }

  const response =
    aiProviderResponseBody as unknown as OllamaChatCompleteResponse;

  if ('choices' in response) {
    // Construct usage object from Ollama's token counts if usage is not provided
    const usage = response.usage ?? {
      prompt_tokens: response.prompt_eval_count ?? 0,
      completion_tokens: response.eval_count ?? 0,
      total_tokens:
        (response.prompt_eval_count ?? 0) + (response.eval_count ?? 0),
    };

    return {
      id: response.id,
      object: response.object,
      created: response.created,
      model: response.model,
      provider: AIProvider.OLLAMA,
      choices: response.choices.map(withThinkingBlocks),
      usage,
    };
  }

  return generateInvalidProviderResponseError(response, AIProvider.OLLAMA);
};

export const ollamaChatCompleteStreamChunkTransform: ResponseChunkStreamTransformFunction =
  (
    responseChunk,
    _fallbackId,
    _streamState,
    _strictOpenAiCompliance,
    _raRequestData,
  ) => {
    const chunk = responseChunk
      .trim()
      .replace(/^data: /, '')
      .trim();

    if (chunk === '[DONE]') {
      return `data: ${chunk}\n\n`;
    }

    const parsedChunk: OllamaStreamChunk = JSON.parse(chunk);
    return `data: ${JSON.stringify({
      id: parsedChunk.id,
      object: parsedChunk.object,
      created: parsedChunk.created,
      model: parsedChunk.model,
      provider: AIProvider.OLLAMA,
      choices: parsedChunk.choices.map(withThinkingDeltaBlocks),
    })}\n\n`;
  };
