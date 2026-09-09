import { isAPIKeyRequiredForProvider } from '@api/ai-providers';
import { getApiUrl, getInternalApiKey } from '@api/constants';
import type { UserDataStorageConnector } from '@api/types/connector';
import type { AppContext } from '@api/types/hono';
import { resolveEmbeddingModelConfig } from '@api/utils/evaluation-model-resolver';
import { warn } from '@shared/console-logging';
import {
  type ChatCompletionRequestData,
  FunctionName,
  type ResponsesRequestData,
  type StreamChatCompletionRequestData,
} from '@shared/types/api/request';
import type { ChatCompletionMessage } from '@shared/types/api/routes/shared/messages';
import { ChatCompletionMessageRole } from '@shared/types/api/routes/shared/messages';
import type { Agent } from '@shared/types/data';
import { nanoid } from 'nanoid';

export class RequestEmbeddingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RequestEmbeddingError';
  }
}

function extractMessagesFromResponsesRequest(
  saRequestData: ResponsesRequestData,
): ChatCompletionMessage[] {
  const input = saRequestData.requestBody.input;
  let messages: ChatCompletionMessage[] = [];

  if (typeof input === 'string') {
    messages = [
      {
        role: ChatCompletionMessageRole.USER,
        content: input,
      },
    ];
  } else {
    const idMap = new Map<string, string>();

    input.forEach((message) => {
      if (!('role' in message)) {
        if (
          'name' in message &&
          'call_id' in message &&
          message.type === 'function'
        ) {
          let id = idMap.get(message.call_id);
          if (!id) {
            id = nanoid(3);
            idMap.set(message.call_id, id);
          }
          messages.push({
            role: ChatCompletionMessageRole.ASSISTANT,
            tool_calls: [
              {
                id: id,
                type: 'function',
                function: {
                  name: message.name,
                  arguments: JSON.stringify(message.arguments),
                },
              },
            ],
          });
        } else if ('output' in message && 'call_id' in message) {
          let id = idMap.get(message.call_id);
          if (!id) {
            id = nanoid(3);
            idMap.set(message.call_id, id);
          }
          messages.push({
            role: ChatCompletionMessageRole.TOOL,
            tool_call_id: id,
            content: message.output,
          });
        } else if (message.type === 'mcp_call' && 'server_label' in message) {
          const id = nanoid(3);
          messages.push({
            role: ChatCompletionMessageRole.ASSISTANT,
            tool_calls: [
              {
                id: id,
                type: 'mcp_call',
                function: {
                  name: message.name,
                  arguments: JSON.stringify(message.arguments),
                },
              },
            ],
          });
          messages.push({
            role: ChatCompletionMessageRole.TOOL,
            tool_call_id: id,
            content: message.output ?? message.error ?? 'success',
          });
        }

        // If there is no role, we likely don't want to embed the message
        return;
      }
      messages.push(message);
    });
  }

  return messages;
}

export function extractMessagesFromRequestData(
  saRequestData:
    | ChatCompletionRequestData
    | StreamChatCompletionRequestData
    | ResponsesRequestData,
): ChatCompletionMessage[] {
  switch (saRequestData.functionName) {
    case FunctionName.CHAT_COMPLETE:
      return saRequestData.requestBody.messages;
    case FunctionName.STREAM_CHAT_COMPLETE:
      return saRequestData.requestBody.messages;
    case FunctionName.CREATE_MODEL_RESPONSE:
      return extractMessagesFromResponsesRequest(saRequestData);
  }
}

/**
 * Embedding providers stop at a context window -- text-embedding-3-large at
 * 8192 tokens -- and a conversation carrying tool outputs can be far past
 * it. The caps keep the text inside the window: routing and clustering care
 * about what the conversation is, not about every line of a git diff.
 */
const MAX_TOOL_OUTPUT_LENGTH = 1000;
const MAX_EMBEDDING_TEXT_LENGTH = 6000;

const MESSAGE_SEPARATOR = '\n\n\n';

/** One message as its line of the embedded text, or '' for nothing to say. */
function formatMessageForEmbedding(message: ChatCompletionMessage): string {
  const role = message.role;
  let content = '';

  if (typeof message.content === 'string') {
    content += message.content;
  } else if (Array.isArray(message.content)) {
    content += message.content
      .map((item) => {
        if (typeof item === 'object' && item.text) {
          return item.text;
        }
        return '';
      })
      .filter(Boolean)
      .join(' ');
  } else if (message.content) {
    content += String(message.content);
  }

  // The tool's output is the message's content, capped: the embedding
  // needs the topic of the output, not the whole of a git diff.
  if (
    role === ChatCompletionMessageRole.TOOL ||
    role === ChatCompletionMessageRole.FUNCTION
  ) {
    return `Tool Call ${message.tool_call_id} Output: ${content.slice(
      0,
      MAX_TOOL_OUTPUT_LENGTH,
    )}`;
  }

  if (message.tool_calls && message.tool_calls.length > 0) {
    const tools = message.tool_calls
      .map((tool) => {
        const parsedTool = tool as {
          id: string;
          type: 'mcp_call';
          function: {
            name: string;
            arguments: string;
          };
        };
        return `Tool Call ID: ${parsedTool.id}\nTool Call Name: ${parsedTool.function.name}\nTool Call Arguments: ${parsedTool.function.arguments}`;
      })
      .join(', ');
    return `Assistant Tool Calls:\n${tools}`;
  }

  // Only include messages with non-empty content after trimming
  if (!content.trim()) {
    return '';
  }

  if (role === ChatCompletionMessageRole.USER) {
    return `User: ${content}`.trim();
  }
  if (role === ChatCompletionMessageRole.ASSISTANT) {
    return `Assistant: ${content}`.trim();
  }

  return `${role}: ${content}`.trim();
}

/**
 * A conversation as the text whose embedding places the request among its
 * skill's clusters: the messages it ends with, newest first into the budget,
 * rendered back in order.
 *
 * The tail rather than the head, because a request is asking for whatever it
 * has arrived at. An agentic session runs for hundreds of turns behind one
 * unchanging opening, so taking the budget from the front hands every turn of
 * it the same text -- the same embedding, the same cluster, the same arm --
 * however far the work has since travelled. `describeRequestIntent` reads the
 * conversation from the end for the same reason.
 */
export function formatMessagesForEmbedding(
  messages: ChatCompletionMessage[],
): string {
  const lines: string[] = [];
  let budget = MAX_EMBEDDING_TEXT_LENGTH;

  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    // Exclude system and developer messages from embeddings
    if (
      message.role === ChatCompletionMessageRole.SYSTEM ||
      message.role === ChatCompletionMessageRole.DEVELOPER
    ) {
      continue;
    }
    const line = formatMessageForEmbedding(message);
    if (!line) {
      continue;
    }
    if (lines.length > 0) {
      budget -= MESSAGE_SEPARATOR.length;
    }
    if (budget <= 0) {
      break;
    }
    // The newest message is worth cutting to fit; an older one that does not
    // fit whole is left out, so the text never opens mid-sentence.
    if (line.length > budget) {
      if (lines.length === 0) {
        lines.push(line.slice(0, budget));
      }
      break;
    }
    lines.push(line);
    budget -= line.length;
  }

  return lines.reverse().join(MESSAGE_SEPARATOR);
}

export interface TextEmbedding {
  embedding: number[];
  /** The model that produced it, the agent's or the system's. */
  modelId: string;
}

/**
 * Embeds one text with the embedding model, the agent's or the system's.
 *
 * Goes through this server's own `/v1/embeddings` as the internal `embedding`
 * skill, like every other internal call.
 */
export async function embedText(
  c: AppContext,
  connector: UserDataStorageConnector,
  text: string,
  agent: Agent | null = null,
): Promise<TextEmbedding> {
  const embeddingConfig = await resolveEmbeddingModelConfig(
    c,
    connector,
    agent,
  );

  if (!embeddingConfig) {
    warn('[EMBEDDING] No embedding model configured in system settings');
    throw new RequestEmbeddingError(
      'No embedding model configured in system settings',
    );
  }

  // Look up the provider to get the API key
  const providers = await connector.getAIProviderAPIKeys(c, {
    id: embeddingConfig.model.ai_provider_id,
  });
  if (providers.length === 0) {
    warn(
      `[EMBEDDING] Provider not found for model: ${embeddingConfig.model.ai_provider_id}`,
    );
    throw new RequestEmbeddingError('Embedding model provider not found');
  }
  const providerConfig = providers[0];

  // Self-hosted providers such as Ollama are configured without a key, so only
  // the providers that need one are held to it.
  if (
    !providerConfig.api_key &&
    isAPIKeyRequiredForProvider(providerConfig.ai_provider)
  ) {
    warn(
      `[EMBEDDING] No API key configured for provider: ${embeddingConfig.model.ai_provider_id}`,
    );
    throw new RequestEmbeddingError(
      'No API key configured for embedding provider',
    );
  }

  if (!text.trim()) {
    throw new RequestEmbeddingError('No text to embed');
  }

  try {
    const saConfig = {
      targets: [
        {
          provider: providerConfig.ai_provider,
          model: embeddingConfig.model.model_name,
          ...(providerConfig.api_key
            ? { api_key: providerConfig.api_key }
            : {}),
          // Same reason as the other internal skills: without this a
          // self-hosted embedding provider is sent to its vendor default.
          ...(providerConfig.custom_fields?.custom_host
            ? { custom_host: providerConfig.custom_fields.custom_host }
            : {}),
        },
      ],
      agent_name: 'super-agents',
      skill_name: 'embedding',
    };

    // We use the fetch instead of the openai library because the openai
    // library attempts to automatically truncate the embeddings to fit their models'
    // dimensions.
    const response = await fetch(`${getApiUrl(c)}/v1/embeddings`, {
      method: 'POST',
      // `fetch` has no timeout of its own, and this is on the request path:
      // routing embeds every request's intent, so a provider that never
      // answers would hang the caller indefinitely.
      signal: AbortSignal.timeout(embeddingConfig.timeoutMs),
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getInternalApiKey(c)}`,
        'sa-config': JSON.stringify(saConfig),
      },
      body: JSON.stringify({
        model: embeddingConfig.model.model_name,
        // The last guard: whatever built this text, an input past the
        // model's context window comes back as a 400 and the caller's
        // request dies with it.
        input: text.slice(0, MAX_EMBEDDING_TEXT_LENGTH),
        dimensions: embeddingConfig.dimensions,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new RequestEmbeddingError(
        `Embedding API returned ${response.status}: ${errorText}`,
      );
    }

    const data = (await response.json()) as {
      data?: { embedding: number[] }[];
    };

    if (!data.data || data.data.length === 0) {
      throw new RequestEmbeddingError(
        'No embedding data returned from AI Provider',
      );
    }

    return {
      embedding: data.data[0].embedding,
      modelId: embeddingConfig.modelId,
    };
  } catch (error) {
    if (error instanceof RequestEmbeddingError) {
      throw error;
    }
    if (error instanceof Error) {
      throw new RequestEmbeddingError(
        `Failed to generate embedding: ${error.message}`,
      );
    }
    throw new RequestEmbeddingError(`Unknown error generating embedding`);
  }
}

/** The embedding of a request's conversation, minus its system messages. */
export async function generateEmbeddingForRequest(
  c: AppContext,
  saRequestData:
    | ChatCompletionRequestData
    | StreamChatCompletionRequestData
    | ResponsesRequestData,
  connector: UserDataStorageConnector,
): Promise<number[]> {
  const messages = extractMessagesFromRequestData(saRequestData);
  const inputText = formatMessagesForEmbedding(messages);

  if (!inputText.trim()) {
    throw new RequestEmbeddingError('No valid text content found in messages');
  }

  return (await embedText(c, connector, inputText)).embedding;
}
