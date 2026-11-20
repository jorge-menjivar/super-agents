import type { ErrorResponseBody } from '@shared/types/api/response/body';
import type {
  ChatCompletionChoice,
  ChatCompletionResponseBody,
} from '@shared/types/api/routes/chat-completions-api';
import type { ChatCompletionMessage } from '@shared/types/api/routes/shared/messages';
import z from 'zod';

/**
 * A choice as Ollama returns it: a thinking model's reasoning arrives in a
 * `reasoning` field beside the content rather than inside it.
 */
export type OllamaChatCompleteChoice = ChatCompletionChoice & {
  message: ChatCompletionMessage & { reasoning?: string };
};

/**
 * Ollama chat completion response interface
 */
export interface OllamaChatCompleteResponse extends ChatCompletionResponseBody {
  system_fingerprint?: string;
  prompt_eval_count?: number;
  eval_count?: number;
  choices: OllamaChatCompleteChoice[];
}

/**
 * Ollama error response interface
 */
export interface OllamaErrorResponse extends ErrorResponseBody {
  error: {
    message: string;
    type?: string;
    code?: string;
  };
}

/**
 * Ollama stream chunk interface for streaming responses
 */
export interface OllamaStreamChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  system_fingerprint?: string;
  choices: OllamaStreamChoice[];
}

/** One choice of a stream chunk, with the reasoning Ollama streams beside it. */
export interface OllamaStreamChoice {
  delta: {
    role?: string;
    content?: string;
    reasoning?: string;
    tool_calls?: object[];
  };
  index: number;
  finish_reason: string | null;
}

/**
 * A content block as the gateway streams one: the block's index, and the
 * piece of it this chunk carries.
 */
export interface OllamaStreamContentBlock {
  index: number;
  delta: { thinking?: string; text?: string };
}

/** One choice of a stream chunk on its way out, reasoning re-expressed. */
export type OllamaStreamChoiceWithBlocks = Omit<OllamaStreamChoice, 'delta'> & {
  delta: OllamaStreamChoice['delta'] & {
    content_blocks?: OllamaStreamContentBlock[];
  };
};

/**
 * Ollama embedding response interface
 */
export interface OllamaEmbedResponse {
  embedding: number[];
  model?: string;
  prompt_eval_count?: number;
  eval_count?: number;
}

/**
 * Custom fields schema for Ollama AI provider configuration
 * These fields are stored in the ai_providers.custom_fields JSONB column
 */
export const OllamaCustomFieldsSchema = z.object({
  custom_host: z
    .string()
    .url('Please enter a valid URL')
    .max(2048, 'URL is too long (maximum 2048 characters)')
    .refine(
      (url) => url.startsWith('http://') || url.startsWith('https://'),
      'Custom host must use HTTP or HTTPS protocol',
    )
    .optional()
    .describe('Custom Ollama server URL (e.g., http://localhost:11434)'),
});

export type OllamaCustomFields = z.infer<typeof OllamaCustomFieldsSchema>;
