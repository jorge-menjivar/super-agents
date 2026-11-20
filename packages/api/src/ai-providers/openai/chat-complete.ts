import type {
  AIProviderFunctionConfig,
  ResponseTransformFunction,
  StreamResponseTransformFunction,
} from '@shared/types/ai-providers/config';
import type { ChatCompletionResponseBody } from '@shared/types/api/routes/chat-completions-api/response';

import type { ChatCompletionContentType } from '@shared/types/api/routes/shared/messages';
import { AIProvider } from '@shared/types/constants';
import { openAIErrorResponseTransform } from './utils';

// TODOS: this configuration does not enforce the maximum token limit for the input parameter. If you want to enforce this, you might need to add a custom validation function or a max property to the ParameterConfig interface, and then use it in the input configuration. However, this might be complex because the token count is not a simple length check, but depends on the specific tokenization method used by the model.

export const openAIChatCompleteConfig: AIProviderFunctionConfig = {
  model: {
    param: 'model',
    required: true,
    default: 'gpt-3.5-turbo',
  },
  messages: {
    param: 'messages',
    default: '',
  },
  functions: {
    param: 'functions',
  },
  function_call: {
    param: 'function_call',
  },
  max_tokens: {
    param: 'max_tokens',
    default: 100,
    min: 0,
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
  n: {
    param: 'n',
    default: 1,
  },
  stream: {
    param: 'stream',
    default: false,
  },
  stop: {
    param: 'stop',
  },
  presence_penalty: {
    param: 'presence_penalty',
    min: -2,
    max: 2,
  },
  frequency_penalty: {
    param: 'frequency_penalty',
    min: -2,
    max: 2,
  },
  logit_bias: {
    param: 'logit_bias',
  },
  user: {
    param: 'user',
  },
  seed: {
    param: 'seed',
  },
  tools: {
    param: 'tools',
  },
  tool_choice: {
    param: 'tool_choice',
  },
  response_format: {
    param: 'response_format',
  },
  logprobs: {
    param: 'logprobs',
    default: false,
  },
  top_logprobs: {
    param: 'top_logprobs',
  },
  stream_options: {
    param: 'stream_options',
  },
  service_tier: {
    param: 'service_tier',
  },
  parallel_tool_calls: {
    param: 'parallel_tool_calls',
  },
  max_completion_tokens: {
    param: 'max_completion_tokens',
  },
  store: {
    param: 'store',
  },
  metadata: {
    param: 'metadata',
  },
  modalities: {
    param: 'modalities',
  },
  audio: {
    param: 'audio',
  },
  prediction: {
    param: 'prediction',
  },
  reasoning_effort: {
    param: 'reasoning_effort',
  },
  prompt_cache_options: {
    param: 'prompt_cache_options',
  },
};

export const openAIChatCompleteResponseTransform: ResponseTransformFunction = (
  aiProviderResponseBody,
  responseStatus,
) => {
  if (responseStatus !== 200 && 'error' in aiProviderResponseBody) {
    return openAIErrorResponseTransform(
      aiProviderResponseBody,
      AIProvider.OPENAI,
    );
  }

  return aiProviderResponseBody as ChatCompletionResponseBody;
};

/**
 * Transforms an OpenAI-format chat completions JSON response into an array of formatted OpenAI compatible text/event-stream chunks.
 */
export const openAIChatCompleteJSONToStreamResponseTransform: StreamResponseTransformFunction =
  (aiProviderResponseBody, provider) => {
    const openAIChatCompleteResponse =
      aiProviderResponseBody as unknown as ChatCompletionResponseBody;
    const streamChunkArray: string[] = [];
    const { id, model, system_fingerprint, choices } =
      openAIChatCompleteResponse;

    const { prompt_tokens, completion_tokens } =
      openAIChatCompleteResponse.usage || {};

    let total_tokens: number | undefined;
    if (prompt_tokens && completion_tokens)
      total_tokens = prompt_tokens + completion_tokens;

    const streamChunkTemplate: Record<string, unknown> = {
      id,
      object: 'chat.completion.chunk',
      created: Date.now(),
      model: model || '',
      system_fingerprint: system_fingerprint || null,
      provider,
      usage: {
        ...(completion_tokens && { completion_tokens }),
        ...(prompt_tokens && { prompt_tokens }),
        ...(total_tokens && { total_tokens }),
      },
    };

    for (let choiceIndex = 0; choiceIndex < choices.length; choiceIndex++) {
      const choice = choices[choiceIndex];
      if (choice.message?.content_blocks) {
        for (let i = 0; i < choice.message.content_blocks.length; i++) {
          const contentBlock = choice.message.content_blocks[i];
          const contentBlockDelta: ChatCompletionContentType = {
            ...contentBlock,
          };
          delete contentBlockDelta.type;
          if (contentBlockDelta.text) {
            for (let j = 0; j < contentBlockDelta.text.length; j += 500) {
              const content = contentBlockDelta.text.slice(j, j + 500);
              streamChunkArray.push(
                `data: ${JSON.stringify({
                  ...streamChunkTemplate,
                  choices: [
                    {
                      index: choiceIndex,
                      delta: {
                        role: 'assistant',
                        content,
                        content_blocks: [
                          {
                            index: i,
                            delta: {
                              text: content,
                            },
                          },
                        ],
                      },
                    },
                  ],
                })}\n\n`,
              );
            }
          } else if (contentBlockDelta.thinking) {
            for (let j = 0; j < contentBlockDelta.thinking.length; j += 500) {
              const thinking = contentBlockDelta.thinking.slice(j, j + 500);
              streamChunkArray.push(
                `data: ${JSON.stringify({
                  ...streamChunkTemplate,
                  choices: [
                    {
                      index: choiceIndex,
                      delta: {
                        role: 'assistant',
                        // A held stream is the only stream its client ever
                        // sees, so it has to speak what a streaming provider
                        // speaks. Ollama and OpenRouter both stream thinking
                        // as `delta.reasoning`, and that is the field an
                        // OpenAI-compatible client reads; the block beside it
                        // is what the dashboard reads. Emitting only the block
                        // would replay a reviewed answer with the thinking
                        // struck out of it.
                        reasoning: thinking,
                        content_blocks: [
                          {
                            index: i,
                            delta: {
                              thinking,
                            },
                          },
                        ],
                      },
                    },
                  ],
                })}\n\n`,
              );
            }
            // Only a provider that signs its thinking has one. Without the
            // guard this sends every other provider's client a chunk whose
            // delta is empty once `undefined` is dropped in serialisation.
            if (contentBlockDelta.signature) {
              streamChunkArray.push(
                `data: ${JSON.stringify({
                  ...streamChunkTemplate,
                  choices: [
                    {
                      index: choiceIndex,
                      delta: {
                        role: 'assistant',
                        content_blocks: [
                          {
                            index: i,
                            delta: {
                              signature: contentBlockDelta.signature,
                            },
                          },
                        ],
                      },
                    },
                  ],
                })}\n\n`,
              );
            }
          } else if (contentBlockDelta.data) {
            for (let j = 0; j < contentBlockDelta.data.length; j += 500) {
              const data = contentBlockDelta.data.slice(j, j + 500);
              streamChunkArray.push(
                `data: ${JSON.stringify({
                  ...streamChunkTemplate,
                  choices: [
                    {
                      index: choiceIndex,
                      delta: {
                        role: 'assistant',
                        content_blocks: [
                          {
                            index: j,
                            delta: {
                              data,
                            },
                          },
                        ],
                      },
                    },
                  ],
                })}\n\n`,
              );
            }
          }
        }
      }

      if (choice.message?.tool_calls?.length) {
        for (let i = 0; i < choice.message.tool_calls.length; i++) {
          const toolCall = choice.message.tool_calls[i];
          const toolCallNameChunk = {
            index: i,
            id: toolCall.id,
            type: 'function',
            function: {
              name: toolCall.function.name,
              arguments: '',
            },
          };

          const toolCallArgumentChunk = {
            index: i,
            function: {
              arguments: toolCall.function.arguments,
            },
          };

          streamChunkArray.push(
            `data: ${JSON.stringify({
              ...streamChunkTemplate,
              choices: [
                {
                  index: choiceIndex,
                  delta: {
                    role: 'assistant',
                    content: null,
                    tool_calls: [toolCallNameChunk],
                  },
                },
              ],
            })}\n\n`,
          );

          streamChunkArray.push(
            `data: ${JSON.stringify({
              ...streamChunkTemplate,
              choices: [
                {
                  index: choiceIndex,
                  delta: {
                    role: 'assistant',
                    tool_calls: [toolCallArgumentChunk],
                  },
                },
              ],
            })}\n\n`,
          );
        }
      }

      if (
        choice.message?.content &&
        typeof choice.message.content === 'string' &&
        !choice.message.content_blocks
      ) {
        const inidividualWords: string[] = [];
        for (let i = 0; i < choice.message.content.length; i += 500) {
          inidividualWords.push(choice.message.content.slice(i, i + 500));
        }
        inidividualWords.forEach((word: string) => {
          streamChunkArray.push(
            `data: ${JSON.stringify({
              ...streamChunkTemplate,
              choices: [
                {
                  index: choiceIndex,
                  delta: {
                    role: 'assistant',
                    content: word,
                  },
                },
              ],
            })}\n\n`,
          );
        });
      }

      streamChunkArray.push(
        `data: ${JSON.stringify({
          ...streamChunkTemplate,
          choices: [
            {
              index: choiceIndex,
              delta: {},
              finish_reason: choice.finish_reason,
            },
          ],
        })}\n\n`,
      );
    }

    streamChunkArray.push(`data: [DONE]\n\n`);
    return streamChunkArray;
  };
