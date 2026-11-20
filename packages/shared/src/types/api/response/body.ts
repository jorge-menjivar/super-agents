import type {
  SuperAgentsRequestBody,
  SuperAgentsTarget,
} from '@shared/types/api/request';
import {
  CreateSpeechResponseBody,
  CreateTranscriptionResponseBody,
  CreateTranslationResponseBody,
} from '@shared/types/api/routes/audio-api';
import {
  CancelBatchResponseBody,
  type CreateBatchRequestBody,
  CreateBatchResponseBody,
  ListBatchesResponseBody,
  RetrieveBatchResponseBody,
} from '@shared/types/api/routes/batch-api';
import { ChatCompletionResponseBody } from '@shared/types/api/routes/chat-completions-api';
import type { ChatCompletionRequestBody } from '@shared/types/api/routes/chat-completions-api/request';
import type { CompletionRequestBody } from '@shared/types/api/routes/completions-api/request';
import { CompletionResponseBody } from '@shared/types/api/routes/completions-api/response';
import type { CreateEmbeddingsRequestBody } from '@shared/types/api/routes/embeddings-api';
import {
  CreateEmbeddingsErrorResponseBody,
  CreateEmbeddingsResponseBody,
} from '@shared/types/api/routes/embeddings-api';
import {
  FileContentResponseBody,
  FileDeleteResponseBody,
  FileErrorResponseBody,
  FileListResponseBody,
  FileRetrieveResponseBody,
  FileUploadResponseBody,
} from '@shared/types/api/routes/files-api';
import {
  CancelFineTuningJobResponseBody,
  type CreateFineTuningJobRequestBody,
  CreateFineTuningJobResponseBody,
  ListFineTuningCheckpointsResponseBody,
  ListFineTuningEventsResponseBody,
  ListFineTuningJobsResponseBody,
  RetrieveFineTuningJobResponseBody,
} from '@shared/types/api/routes/fine-tuning-api';
import {
  type GenerateImageRequestBody,
  GenerateImageResponseBody,
} from '@shared/types/api/routes/images-api';
import { ModerationResponseBody } from '@shared/types/api/routes/moderations-api';
import type { ResponsesRequestBody } from '@shared/types/api/routes/responses-api/request';
import {
  DeleteResponseResponseBody,
  GetResponseResponseBody,
  ListResponsesResponseBody,
  ResponsesResponseBody,
} from '@shared/types/api/routes/responses-api/response';
import type { ChatCompletionMessage } from '@shared/types/api/routes/shared/messages';
import { SystemOneResponseBody } from '@shared/types/api/routes/system-one-api/response';
import { z } from 'zod';

export type ParameterValueTypes =
  | string
  | string[]
  | number
  | number[]
  | boolean
  | Record<string, unknown>
  | Record<string, unknown>[]
  | undefined
  | null;

export type ParameterConfigDefaultFunction = (params: {
  saRequestBody: SuperAgentsRequestBody;
  saTarget: SuperAgentsTarget;
}) => ParameterValueTypes;

export type CreateBatchRequestParameterTransformFunction = (
  saRequestBody: CreateBatchRequestBody,
) => ParameterValueTypes;

export type ChatCompletionParameterTransformFunction = (
  saRequestBody: ChatCompletionRequestBody,
) => ParameterValueTypes;

export type CompletionParameterTransformFunction = (
  saRequestBody: CompletionRequestBody,
) => ParameterValueTypes;

export type CreateFineTuningJobParameterTransformFunction = (
  saRequestBody: CreateFineTuningJobRequestBody,
) => ParameterValueTypes;

export type ImageGenerationParameterTransformFunction = (
  saRequestBody: GenerateImageRequestBody,
) => ParameterValueTypes;

export type ResponsesParameterTransformFunction = (
  saRequestBody: ResponsesRequestBody,
) => ParameterValueTypes;

export type EmbeddingsParameterTransformFunction = (
  saRequestBody: CreateEmbeddingsRequestBody,
) => ParameterValueTypes;

/**
 * Configuration for a parameter.
 */
export interface ParameterConfig {
  /** The name of the parameter. */
  param: string;
  /** The minimum value of the parameter. */
  min?: number;
  /** The maximum value of the parameter. */
  max?: number;
  /** Whether the parameter is required. */
  required?: boolean;
  /** A function to transform the value of the parameter. */
  transform?:
    | CreateBatchRequestParameterTransformFunction
    | ChatCompletionParameterTransformFunction
    | CompletionParameterTransformFunction
    | ImageGenerationParameterTransformFunction
    | ResponsesParameterTransformFunction
    | EmbeddingsParameterTransformFunction
    | CreateFineTuningJobParameterTransformFunction;

  /** The default value of the parameter, if not provided in the request. */
  default?:
    | string
    | number
    | boolean
    | Record<string, unknown>
    | null
    | ChatCompletionMessage[]
    | ParameterConfigDefaultFunction;
}

export type endpointStrings =
  | 'complete'
  | 'chatComplete'
  | 'embed'
  | 'rerank'
  | 'moderate'
  | 'stream-complete'
  | 'stream-chatComplete'
  | 'proxy'
  | 'imageGenerate'
  | 'createSpeech'
  | 'createTranscription'
  | 'createTranslation'
  | 'realtime'
  | 'uploadFile'
  | 'listFiles'
  | 'retrieveFile'
  | 'deleteFile'
  | 'retrieveFileContent'
  | 'createBatch'
  | 'retrieveBatch'
  | 'cancelBatch'
  | 'listBatches'
  | 'getBatchOutput'
  | 'listFinetunes'
  | 'createFinetune'
  | 'retrieveFinetune'
  | 'cancelFinetune'
  | 'createModelResponse'
  | 'getModelResponse'
  | 'deleteModelResponse'
  | 'listResponseInputItems'
  | 'initiateMultipartUpload';

/**
 * The structure of a error response for all functions
 */
export const ErrorResponseBody = z.object({
  error: z.object({
    message: z.string(),
    type: z.string().optional(),
    param: z.string().optional(),
    code: z.string().optional(),
  }),
  provider: z.string(),
  message: z.string().optional(),
  status: z.number().optional(),
});

export type ErrorResponseBody = z.infer<typeof ErrorResponseBody>;

export const SuperAgentsResponseBody = z.union([
  // Audio API
  CreateSpeechResponseBody,
  CreateTranscriptionResponseBody,
  CreateTranslationResponseBody,

  // Batch API
  CreateBatchResponseBody,
  RetrieveBatchResponseBody,
  CancelBatchResponseBody,
  ListBatchesResponseBody,

  // Chat Completions API
  ChatCompletionResponseBody,

  // Completions API
  CompletionResponseBody,

  // Embeddings API
  CreateEmbeddingsResponseBody,
  CreateEmbeddingsErrorResponseBody,

  // Files API
  FileUploadResponseBody,
  FileListResponseBody,
  FileRetrieveResponseBody,
  FileDeleteResponseBody,
  FileContentResponseBody,
  FileErrorResponseBody,

  // Fine-tuning API
  CreateFineTuningJobResponseBody,
  RetrieveFineTuningJobResponseBody,
  CancelFineTuningJobResponseBody,
  ListFineTuningJobsResponseBody,
  ListFineTuningEventsResponseBody,
  ListFineTuningCheckpointsResponseBody,

  // Images API
  GenerateImageResponseBody,

  // Moderations API
  ModerationResponseBody,

  // Responses API
  ResponsesResponseBody,
  DeleteResponseResponseBody,
  ListResponsesResponseBody,
  GetResponseResponseBody,

  // System One API
  SystemOneResponseBody,

  // Other
  ErrorResponseBody,
]);

export type SuperAgentsResponseBody = z.infer<typeof SuperAgentsResponseBody>;

export type AIProviderResponseBody =
  | Record<string, unknown>
  | ReadableStream
  | FormData
  | ArrayBuffer;
