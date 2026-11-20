import { FunctionName } from '@shared/types/api/request/function-name';
import { SuperAgentsResponseBody } from '@shared/types/api/response';
import {
  CreateSpeechRequestBody,
  CreateSpeechResponseBody,
  CreateTranscriptionRequestBody,
  CreateTranscriptionResponseBody,
  CreateTranslationRequestBody,
  CreateTranslationResponseBody,
} from '@shared/types/api/routes/audio-api';
import {
  CancelBatchRequestBody,
  CancelBatchResponseBody,
  CreateBatchRequestBody,
  CreateBatchResponseBody,
  ListBatchesRequestBody,
  ListBatchesResponseBody,
  RetrieveBatchRequestBody,
  RetrieveBatchResponseBody,
} from '@shared/types/api/routes/batch-api';
import {
  ChatCompletionRequestBody,
  ChatCompletionResponseBody,
} from '@shared/types/api/routes/chat-completions-api';
import {
  CompletionRequestBody,
  CompletionResponseBody,
} from '@shared/types/api/routes/completions-api';
import {
  CreateEmbeddingsRequestBody,
  CreateEmbeddingsResponseBody,
} from '@shared/types/api/routes/embeddings-api';
import {
  FileContentRequestBody,
  FileContentResponseBody,
  FileDeleteRequestBody,
  FileDeleteResponseBody,
  FileListRequestBody,
  FileListResponseBody,
  FileRetrieveRequestBody,
  FileRetrieveResponseBody,
  FileUploadRequestBody,
  FileUploadResponseBody,
} from '@shared/types/api/routes/files-api';
import {
  CancelFineTuningJobRequestBody,
  CancelFineTuningJobResponseBody,
  CreateFineTuningJobRequestBody,
  CreateFineTuningJobResponseBody,
  ListFineTuningJobsRequestBody,
  ListFineTuningJobsResponseBody,
  RetrieveFineTuningJobRequestBody,
  RetrieveFineTuningJobResponseBody,
} from '@shared/types/api/routes/fine-tuning-api';
import {
  GenerateImageRequestBody,
  GenerateImageResponseBody,
} from '@shared/types/api/routes/images-api';
import {
  ModerationRequestBody,
  ModerationResponseBody,
} from '@shared/types/api/routes/moderations-api';
import {
  ResponsesRequestBody,
  ResponsesResponseBody,
} from '@shared/types/api/routes/responses-api';
import {
  SystemOneRequestBody,
  SystemOneResponseBody,
} from '@shared/types/api/routes/system-one-api';
import { HttpMethod } from '@shared/types/http';
import { z } from 'zod';

export const SuperAgentsRequestBody = z.union([
  // Audio API
  CreateSpeechRequestBody,
  CreateTranscriptionRequestBody,
  CreateTranslationRequestBody,

  // Batch API
  CreateBatchRequestBody,
  RetrieveBatchRequestBody,
  CancelBatchRequestBody,
  ListBatchesRequestBody,

  // Chat Completions API
  ChatCompletionRequestBody,

  // Completions API
  CompletionRequestBody,

  // Embeddings API
  CreateEmbeddingsRequestBody,

  // Files API
  FileUploadRequestBody,
  FileListRequestBody,
  FileRetrieveRequestBody,
  FileDeleteRequestBody,
  FileContentRequestBody,

  // Fine-tuning API
  CreateFineTuningJobRequestBody,
  RetrieveFineTuningJobRequestBody,
  CancelFineTuningJobRequestBody,
  ListFineTuningJobsRequestBody,
  // ListFineTuningEventsRequestBody,
  // ListFineTuningCheckpointsRequestBody,

  // Images API
  GenerateImageRequestBody,

  // Moderations API
  ModerationRequestBody,

  // Responses API
  ResponsesRequestBody,

  // System One API
  SystemOneRequestBody,
]);

export type SuperAgentsRequestBody = z.infer<typeof SuperAgentsRequestBody>;

export type AIProviderRequestBody =
  | Record<string, unknown>
  | ReadableStream
  | FormData
  | ArrayBuffer;

const BaseRequestData = z.object({
  /** The route pattern of the request. */
  route_pattern: z.instanceof(RegExp),
  /** The method of the request. */
  method: z.enum(HttpMethod),
  /** The URL of the request. */
  url: z.string(),
  /** The function name of the request. */
  functionName: z.enum(FunctionName),
  /** The headers of the request. */
  requestHeaders: z.record(z.string(), z.string()),
  /** The request body of the request. */
  requestBody: SuperAgentsRequestBody,
  /** The schema of the request body. */
  requestSchema: z.custom<z.ZodSchema<unknown>>(
    (val) =>
      val && typeof (val as z.ZodSchema<unknown>).safeParse === 'function',
  ),
  /** Whether the request is a stream. */
  stream: z.boolean().optional(),
  /** The response body of the request. Only used in the UI once the request is complete. */
  responseBody: SuperAgentsResponseBody.optional(),
  /** The schema of the response body. Only used in the UI once the request is complete.
   *
   * If response schema validation fails, we automatically retry with the error response schema.
   */
  responseSchema: z.custom<z.ZodSchema<unknown>>(
    (val) =>
      val && typeof (val as z.ZodSchema<unknown>).safeParse === 'function',
  ),
});

export const CreateSpeechRequestData = BaseRequestData.extend({
  method: z.literal(HttpMethod.POST),
  functionName: z.literal(FunctionName.CREATE_SPEECH),
  requestBody: CreateSpeechRequestBody,
  responseBody: CreateSpeechResponseBody.optional(),
});
export type CreateSpeechRequestData = z.infer<typeof CreateSpeechRequestData>;

export const CreateTranscriptionRequestData = BaseRequestData.extend({
  method: z.literal(HttpMethod.POST),
  functionName: z.literal(FunctionName.CREATE_TRANSCRIPTION),
  requestBody: CreateTranscriptionRequestBody,
  responseBody: CreateTranscriptionResponseBody.optional(),
});
export type CreateTranscriptionRequestData = z.infer<
  typeof CreateTranscriptionRequestData
>;

export const CreateTranslationRequestData = BaseRequestData.extend({
  method: z.literal(HttpMethod.POST),
  functionName: z.literal(FunctionName.CREATE_TRANSLATION),
  requestBody: CreateTranslationRequestBody,
  responseBody: CreateTranslationResponseBody.optional(),
});
export type CreateTranslationRequestData = z.infer<
  typeof CreateTranslationRequestData
>;

export const CreateBatchRequestData = BaseRequestData.extend({
  method: z.literal(HttpMethod.POST),
  functionName: z.literal(FunctionName.CREATE_BATCH),
  requestBody: CreateBatchRequestBody,
  responseBody: CreateBatchResponseBody.optional(),
});
export type CreateBatchRequestData = z.infer<typeof CreateBatchRequestData>;

export const RetrieveBatchRequestData = BaseRequestData.extend({
  method: z.literal(HttpMethod.GET),
  functionName: z.literal(FunctionName.GET_BATCH_OUTPUT),
  requestBody: RetrieveBatchRequestBody,
  responseBody: RetrieveBatchResponseBody.optional(),
});
export type RetrieveBatchRequestData = z.infer<typeof RetrieveBatchRequestData>;

export const CancelBatchRequestData = BaseRequestData.extend({
  method: z.literal(HttpMethod.POST),
  functionName: z.literal(FunctionName.CANCEL_BATCH),
  requestBody: CancelBatchRequestBody,
  responseBody: CancelBatchResponseBody.optional(),
});
export type CancelBatchRequestData = z.infer<typeof CancelBatchRequestData>;

export const ListBatchesRequestData = BaseRequestData.extend({
  method: z.literal(HttpMethod.GET),
  functionName: z.literal(FunctionName.LIST_BATCHES),
  requestBody: ListBatchesRequestBody,
  responseBody: ListBatchesResponseBody.optional(),
});
export type ListBatchesRequestData = z.infer<typeof ListBatchesRequestData>;

export const ChatCompletionRequestData = BaseRequestData.extend({
  method: z.literal(HttpMethod.POST),
  functionName: z.literal(FunctionName.CHAT_COMPLETE),
  requestBody: ChatCompletionRequestBody,
  responseBody: ChatCompletionResponseBody.optional(),
});
export type ChatCompletionRequestData = z.infer<
  typeof ChatCompletionRequestData
>;

export const StreamChatCompletionRequestData = BaseRequestData.extend({
  method: z.literal(HttpMethod.POST),
  functionName: z.literal(FunctionName.STREAM_CHAT_COMPLETE),
  requestBody: ChatCompletionRequestBody,
  stream: z.literal(true),
  responseBody: ChatCompletionResponseBody.optional(),
});
export type StreamChatCompletionRequestData = z.infer<
  typeof StreamChatCompletionRequestData
>;

export const CompleteRequestData = BaseRequestData.extend({
  method: z.literal(HttpMethod.POST),
  functionName: z.literal(FunctionName.COMPLETE),
  requestBody: CompletionRequestBody,
  responseBody: CompletionResponseBody.optional(),
});
export type CompleteRequestData = z.infer<typeof CompleteRequestData>;

export const StreamCompleteRequestData = BaseRequestData.extend({
  method: z.literal(HttpMethod.POST),
  functionName: z.literal(FunctionName.STREAM_COMPLETE),
  requestBody: CompletionRequestBody,
  stream: z.literal(true),
  responseBody: CompletionResponseBody.optional(),
});
export type StreamCompleteRequestData = z.infer<
  typeof StreamCompleteRequestData
>;

export const CreateEmbeddingsRequestData = BaseRequestData.extend({
  method: z.literal(HttpMethod.POST),
  functionName: z.literal(FunctionName.EMBED),
  requestBody: CreateEmbeddingsRequestBody,
  responseBody: CreateEmbeddingsResponseBody.optional(),
});
export type CreateEmbeddingsRequestData = z.infer<
  typeof CreateEmbeddingsRequestData
>;

export const FileUploadRequestData = BaseRequestData.extend({
  method: z.literal(HttpMethod.POST),
  functionName: z.literal(FunctionName.UPLOAD_FILE),
  requestBody: FileUploadRequestBody,
  responseBody: FileUploadResponseBody.optional(),
});
export type FileUploadRequestData = z.infer<typeof FileUploadRequestData>;

export const FileListRequestData = BaseRequestData.extend({
  method: z.literal(HttpMethod.GET),
  functionName: z.literal(FunctionName.LIST_FILES),
  requestBody: FileListRequestBody,
  responseBody: FileListResponseBody.optional(),
});
export type FileListRequestData = z.infer<typeof FileListRequestData>;

export const FileRetrieveRequestData = BaseRequestData.extend({
  method: z.literal(HttpMethod.GET),
  functionName: z.literal(FunctionName.RETRIEVE_FILE),
  requestBody: FileRetrieveRequestBody,
  responseBody: FileRetrieveResponseBody.optional(),
});
export type FileRetrieveRequestData = z.infer<typeof FileRetrieveRequestData>;

export const FileDeleteRequestData = BaseRequestData.extend({
  method: z.literal(HttpMethod.DELETE),
  functionName: z.literal(FunctionName.DELETE_FILE),
  requestBody: FileDeleteRequestBody,
  responseBody: FileDeleteResponseBody.optional(),
});
export type FileDeleteRequestData = z.infer<typeof FileDeleteRequestData>;

export const FileContentRequestData = BaseRequestData.extend({
  method: z.literal(HttpMethod.GET),
  functionName: z.literal(FunctionName.RETRIEVE_FILE_CONTENT),
  requestBody: FileContentRequestBody,
  responseBody: FileContentResponseBody.optional(),
});
export type FileContentRequestData = z.infer<typeof FileContentRequestData>;

export const CreateFineTuningJobRequestData = BaseRequestData.extend({
  method: z.literal(HttpMethod.POST),
  functionName: z.literal(FunctionName.CREATE_FINE_TUNING_JOB),
  requestBody: CreateFineTuningJobRequestBody,
  responseBody: CreateFineTuningJobResponseBody.optional(),
});
export type CreateFineTuningJobRequestData = z.infer<
  typeof CreateFineTuningJobRequestData
>;

export const RetrieveFineTuningJobRequestData = BaseRequestData.extend({
  method: z.literal(HttpMethod.GET),
  functionName: z.literal(FunctionName.RETRIEVE_FINE_TUNING_JOB),
  requestBody: RetrieveFineTuningJobRequestBody,
  responseBody: RetrieveFineTuningJobResponseBody.optional(),
});
export type RetrieveFineTuningJobRequestData = z.infer<
  typeof RetrieveFineTuningJobRequestData
>;

export const CancelFineTuningJobRequestData = BaseRequestData.extend({
  method: z.literal(HttpMethod.POST),
  functionName: z.literal(FunctionName.CANCEL_FINE_TUNING_JOB),
  requestBody: CancelFineTuningJobRequestBody,
  responseBody: CancelFineTuningJobResponseBody.optional(),
});
export type CancelFineTuningJobRequestData = z.infer<
  typeof CancelFineTuningJobRequestData
>;

export const ListFineTuningJobsRequestData = BaseRequestData.extend({
  method: z.literal(HttpMethod.GET),
  functionName: z.literal(FunctionName.LIST_FINE_TUNING_JOBS),
  requestBody: ListFineTuningJobsRequestBody,
  responseBody: ListFineTuningJobsResponseBody.optional(),
});
export type ListFineTuningJobsRequestData = z.infer<
  typeof ListFineTuningJobsRequestData
>;

export const GenerateImageRequestData = BaseRequestData.extend({
  method: z.literal(HttpMethod.POST),
  functionName: z.literal(FunctionName.GENERATE_IMAGE),
  requestBody: GenerateImageRequestBody,
  responseBody: GenerateImageResponseBody.optional(),
});
export type GenerateImageRequestData = z.infer<typeof GenerateImageRequestData>;

export const ModerationRequestData = BaseRequestData.extend({
  method: z.literal(HttpMethod.POST),
  functionName: z.literal(FunctionName.MODERATE),
  requestBody: ModerationRequestBody,
  responseBody: ModerationResponseBody.optional(),
});
export type ModerationRequestData = z.infer<typeof ModerationRequestData>;

export const ResponsesRequestData = BaseRequestData.extend({
  method: z.literal(HttpMethod.POST),
  functionName: z.literal(FunctionName.CREATE_MODEL_RESPONSE),
  requestBody: ResponsesRequestBody,
  responseBody: ResponsesResponseBody.optional(),
});
export type ResponsesRequestData = z.infer<typeof ResponsesRequestData>;

export const SystemOneRequestData = BaseRequestData.extend({
  method: z.literal(HttpMethod.POST),
  functionName: z.literal(FunctionName.SYSTEM_ONE),
  requestBody: SystemOneRequestBody,
  responseBody: SystemOneResponseBody.optional(),
});
export type SystemOneRequestData = z.infer<typeof SystemOneRequestData>;

export const ProxyRequestData = BaseRequestData.extend({
  method: z.literal(HttpMethod.POST),
  functionName: z.literal(FunctionName.PROXY),
});
export type ProxyRequestData = z.infer<typeof ProxyRequestData>;

export const SuperAgentsRequestData = z.union([
  // Audio API
  CreateSpeechRequestData,
  CreateTranscriptionRequestData,
  CreateTranslationRequestData,

  // Batch API
  CreateBatchRequestData,
  RetrieveBatchRequestData,
  CancelBatchRequestData,
  ListBatchesRequestData,

  // Chat Completions API
  ChatCompletionRequestData,
  StreamChatCompletionRequestData,

  // Completions API
  CompleteRequestData,
  StreamCompleteRequestData,

  // Embeddings API
  CreateEmbeddingsRequestData,

  // Files API
  FileUploadRequestData,
  FileListRequestData,
  FileRetrieveRequestData,
  FileDeleteRequestData,
  FileContentRequestData,

  // Fine-tuning API
  CreateFineTuningJobRequestData,
  RetrieveFineTuningJobRequestData,
  CancelFineTuningJobRequestData,
  ListFineTuningJobsRequestData,

  // Images API
  GenerateImageRequestData,
  ModerationRequestData,

  // Responses API
  ResponsesRequestData,

  // System One API
  SystemOneRequestData,

  // Proxy API
  ProxyRequestData,
]);

export type SuperAgentsRequestData = z.infer<typeof SuperAgentsRequestData>;
