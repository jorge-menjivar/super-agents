import type { SuperAgentsRequestData } from '@shared/types/api/request/body';
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

export enum FunctionName {
  // Audio API
  CREATE_SPEECH = 'create_speech',
  CREATE_TRANSCRIPTION = 'create_transcription',
  CREATE_TRANSLATION = 'create_translation',

  // Batch API
  CREATE_BATCH = 'create_batch',
  GET_BATCH_OUTPUT = 'get_batch_output',
  RETRIEVE_BATCH = 'retrieve_batch',
  CANCEL_BATCH = 'cancel_batch',
  LIST_BATCHES = 'list_batches',

  // Chat Completion API
  CHAT_COMPLETE = 'chat_complete',
  STREAM_CHAT_COMPLETE = 'stream_chat_complete',

  // Completion API
  COMPLETE = 'complete',
  STREAM_COMPLETE = 'stream_complete',

  // Embeddings API
  EMBED = 'embed',

  // Files API
  UPLOAD_FILE = 'upload_file',
  LIST_FILES = 'list_files',
  RETRIEVE_FILE = 'retrieve_file',
  DELETE_FILE = 'delete_file',
  RETRIEVE_FILE_CONTENT = 'retrieve_file_content',

  // Fine-tuning API
  LIST_FINE_TUNING_JOBS = 'list_fine_tuning_jobs',
  CREATE_FINE_TUNING_JOB = 'create_fine_tuning_job',
  RETRIEVE_FINE_TUNING_JOB = 'retrieve_fine_tuning_job',
  CANCEL_FINE_TUNING_JOB = 'cancel_fine_tuning_job',

  // Images API
  GENERATE_IMAGE = 'generate_image',

  // Moderations API
  MODERATE = 'moderate',

  // Proxy API
  PROXY = 'proxy',

  // Realtime API
  REALTIME = 'realtime',

  // Responses API
  CREATE_MODEL_RESPONSE = 'create_model_response',
  GET_MODEL_RESPONSE = 'get_model_response',
  DELETE_MODEL_RESPONSE = 'delete_model_response',
  LIST_RESPONSE_INPUT_ITEMS = 'list_response_input_items',

  // System One API: decision models
  SYSTEM_ONE = 'system_one',

  // Amazon Bedrock API
  INITIATE_MULTIPART_UPLOAD = 'initiate_multipart_upload',
}

export const PrettyFunctionName: Record<FunctionName, string> = {
  [FunctionName.COMPLETE]: 'Complete',
  [FunctionName.CHAT_COMPLETE]: 'Chat Complete',
  [FunctionName.EMBED]: 'Embed',
  [FunctionName.MODERATE]: 'Moderate',
  [FunctionName.STREAM_COMPLETE]: 'Stream Complete',
  [FunctionName.STREAM_CHAT_COMPLETE]: 'Stream Chat Complete',
  [FunctionName.GENERATE_IMAGE]: 'Image Generate',
  [FunctionName.CREATE_SPEECH]: 'Create Speech',
  [FunctionName.CREATE_TRANSCRIPTION]: 'Create Transcription',
  [FunctionName.CREATE_TRANSLATION]: 'Create Translation',
  [FunctionName.REALTIME]: 'Realtime',
  [FunctionName.UPLOAD_FILE]: 'Upload File',
  [FunctionName.LIST_FILES]: 'List Files',
  [FunctionName.RETRIEVE_FILE]: 'Retrieve File',
  [FunctionName.DELETE_FILE]: 'Delete File',
  [FunctionName.RETRIEVE_FILE_CONTENT]: 'Retrieve File Content',
  [FunctionName.CREATE_BATCH]: 'Create Batch',
  [FunctionName.GET_BATCH_OUTPUT]: 'Get Batch Output',
  [FunctionName.RETRIEVE_BATCH]: 'Retrieve Batch',
  [FunctionName.CANCEL_BATCH]: 'Cancel Batch',
  [FunctionName.LIST_BATCHES]: 'List Batches',
  [FunctionName.LIST_FINE_TUNING_JOBS]: 'List Finetuning Jobs',
  [FunctionName.CREATE_FINE_TUNING_JOB]: 'Create Finetuning Job',
  [FunctionName.RETRIEVE_FINE_TUNING_JOB]: 'List Finetuning Job Events',
  [FunctionName.CANCEL_FINE_TUNING_JOB]: 'Cancel Finetuning Job',
  [FunctionName.CREATE_MODEL_RESPONSE]: 'Create Model Response',
  [FunctionName.GET_MODEL_RESPONSE]: 'Get Model Response',
  [FunctionName.DELETE_MODEL_RESPONSE]: 'Delete Model Response',
  [FunctionName.LIST_RESPONSE_INPUT_ITEMS]: 'List Response Input Items',
  [FunctionName.SYSTEM_ONE]: 'System One',
  [FunctionName.PROXY]: 'Proxy',
  [FunctionName.INITIATE_MULTIPART_UPLOAD]: 'Initiate Multipart Upload',
};

/**
 * This is a list of all the functions that are available in the API.
 * It is used to generate the function configs for the API.
 *
 * The only fields that matter here are:
 * - route_pattern
 * - method
 * - functionName
 * - requestSchema
 * - stream
 * - responseSchema
 *
 * The other fields are not used.
 */
export const functionConfigs: SuperAgentsRequestData[] = [
  // Audio API
  {
    route_pattern: /^\/v1\/audio/,
    method: HttpMethod.POST,
    functionName: FunctionName.CREATE_SPEECH,
    requestSchema: CreateSpeechRequestBody,
    requestBody: {} as CreateSpeechRequestBody,
    responseSchema: CreateSpeechResponseBody,
    url: '',
    requestHeaders: {},
  },
  {
    route_pattern: /^\/v1\/audio\/transcriptions$/,
    method: HttpMethod.POST,
    functionName: FunctionName.CREATE_TRANSCRIPTION,
    requestSchema: CreateTranscriptionRequestBody,
    requestBody: {} as CreateTranscriptionRequestBody,
    responseSchema: CreateTranscriptionResponseBody,
    url: '',
    requestHeaders: {},
  },
  {
    route_pattern: /^\/v1\/audio\/translations$/,
    method: HttpMethod.POST,
    functionName: FunctionName.CREATE_TRANSLATION,
    requestSchema: CreateTranslationRequestBody,
    requestBody: {} as CreateTranslationRequestBody,
    responseSchema: CreateTranslationResponseBody,
    url: '',
    requestHeaders: {},
  },

  // Batch API
  {
    route_pattern: /^\/v1\/files\/batches$/,
    method: HttpMethod.POST,
    functionName: FunctionName.CREATE_BATCH,
    requestSchema: CreateBatchRequestBody,
    requestBody: {} as CreateBatchRequestBody,
    responseSchema: CreateBatchResponseBody,
    url: '',
    requestHeaders: {},
  },
  {
    route_pattern: /^\/v1\/files\/batches$/,
    method: HttpMethod.GET,
    functionName: FunctionName.LIST_BATCHES,
    requestSchema: ListBatchesRequestBody,
    requestBody: {} as ListBatchesRequestBody,
    responseSchema: ListBatchesResponseBody,
    url: '',
    requestHeaders: {},
  },
  {
    route_pattern: /^\/v1\/files\/batches\/[^/]+$/,
    method: HttpMethod.GET,
    functionName: FunctionName.GET_BATCH_OUTPUT,
    requestSchema: RetrieveBatchRequestBody,
    requestBody: {} as RetrieveBatchRequestBody,
    responseSchema: RetrieveBatchResponseBody,
    url: '',
    requestHeaders: {},
  },
  {
    route_pattern: /^\/v1\/files\/batches\/[^/]+\/cancel$/,
    method: HttpMethod.POST,
    functionName: FunctionName.CANCEL_BATCH,
    requestSchema: CancelBatchRequestBody,
    requestBody: {} as CancelBatchRequestBody,
    responseSchema: CancelBatchResponseBody,
    url: '',
    requestHeaders: {},
  },

  // Chat Completions API
  {
    route_pattern: /^\/v1\/chat\/completions$/,
    method: HttpMethod.POST,
    functionName: FunctionName.CHAT_COMPLETE,
    requestSchema: ChatCompletionRequestBody,
    requestBody: {} as ChatCompletionRequestBody,
    responseSchema: ChatCompletionResponseBody,
    url: '',
    requestHeaders: {},
  },
  {
    route_pattern: /^\/v1\/chat\/completions$/,
    method: HttpMethod.POST,
    functionName: FunctionName.STREAM_CHAT_COMPLETE,
    requestSchema: ChatCompletionRequestBody,
    requestBody: {} as ChatCompletionRequestBody,
    responseSchema: ChatCompletionResponseBody,
    stream: true,
    url: '',
    requestHeaders: {},
  },

  // Completions API
  {
    route_pattern: /^\/v1\/completions$/,
    method: HttpMethod.POST,
    functionName: FunctionName.COMPLETE,
    requestSchema: CompletionRequestBody,
    requestBody: {} as CompletionRequestBody,
    responseSchema: CompletionResponseBody,
    url: '',
    requestHeaders: {},
  },
  {
    route_pattern: /^\/v1\/completions$/,
    method: HttpMethod.POST,
    functionName: FunctionName.STREAM_COMPLETE,
    requestSchema: CompletionRequestBody,
    responseSchema: CompletionResponseBody,
    stream: true,
    requestBody: {} as CompletionRequestBody,
    url: '',
    requestHeaders: {},
  },

  // Embeddings API
  {
    route_pattern: /^\/v1\/embeddings/,
    method: HttpMethod.POST,
    functionName: FunctionName.EMBED,
    requestSchema: CreateEmbeddingsRequestBody,
    requestBody: {} as CreateEmbeddingsRequestBody,
    responseSchema: CreateEmbeddingsResponseBody,
    url: '',
    requestHeaders: {},
  },

  // Files API
  {
    route_pattern: /^\/v1\/files$/,
    method: HttpMethod.POST,
    functionName: FunctionName.UPLOAD_FILE,
    requestSchema: FileUploadRequestBody,
    requestBody: {} as FileUploadRequestBody,
    responseSchema: FileUploadResponseBody,
    url: '',
    requestHeaders: {},
  },
  {
    route_pattern: /^\/v1\/files$/,
    method: HttpMethod.GET,
    functionName: FunctionName.LIST_FILES,
    requestSchema: FileListRequestBody,
    requestBody: {} as FileListRequestBody,
    responseSchema: FileListResponseBody,
    url: '',
    requestHeaders: {},
  },
  {
    route_pattern: /^\/v1\/files\/[^/]+\/content$/,
    method: HttpMethod.GET,
    functionName: FunctionName.RETRIEVE_FILE_CONTENT,
    requestSchema: FileContentRequestBody,
    requestBody: {} as FileContentRequestBody,
    responseSchema: FileContentResponseBody,
    url: '',
    requestHeaders: {},
  },
  {
    route_pattern: /^\/v1\/files\/[^/]+$/,
    method: HttpMethod.GET,
    functionName: FunctionName.RETRIEVE_FILE,
    requestSchema: FileRetrieveRequestBody,
    requestBody: {} as FileRetrieveRequestBody,
    responseSchema: FileRetrieveResponseBody,
    url: '',
    requestHeaders: {},
  },
  {
    route_pattern: /^\/v1\/files\/[^/]+$/,
    method: HttpMethod.DELETE,
    functionName: FunctionName.DELETE_FILE,
    requestSchema: FileDeleteRequestBody,
    requestBody: {} as FileDeleteRequestBody,
    responseSchema: FileDeleteResponseBody,
    url: '',
    requestHeaders: {},
  },

  // Fine-tuning API
  {
    route_pattern: /^\/v1\/fine_tuning\/jobs$/,
    method: HttpMethod.POST,
    functionName: FunctionName.CREATE_FINE_TUNING_JOB,
    requestSchema: CreateFineTuningJobRequestBody,
    requestBody: {} as CreateFineTuningJobRequestBody,
    responseSchema: CreateFineTuningJobResponseBody,
    url: '',
    requestHeaders: {},
  },
  {
    route_pattern: /^\/v1\/fine_tuning\/jobs\/[^/]+\/cancel$/,
    method: HttpMethod.POST,
    functionName: FunctionName.CANCEL_FINE_TUNING_JOB,
    requestSchema: CancelFineTuningJobRequestBody,
    requestBody: {} as CancelFineTuningJobRequestBody,
    responseSchema: CancelFineTuningJobResponseBody,
    url: '',
    requestHeaders: {},
  },
  {
    route_pattern: /^\/v1\/fine_tuning\/jobs$/,
    method: HttpMethod.GET,
    functionName: FunctionName.LIST_FINE_TUNING_JOBS,
    requestSchema: ListFineTuningJobsRequestBody,
    requestBody: {} as ListFineTuningJobsRequestBody,
    responseSchema: ListFineTuningJobsResponseBody,
    url: '',
    requestHeaders: {},
  },
  {
    route_pattern: /^\/v1\/fine_tuning\/jobs\/[^/]+$/,
    method: HttpMethod.GET,
    functionName: FunctionName.RETRIEVE_FINE_TUNING_JOB,
    requestSchema: RetrieveFineTuningJobRequestBody,
    requestBody: {} as RetrieveFineTuningJobRequestBody,
    responseSchema: RetrieveFineTuningJobResponseBody,
    url: '',
    requestHeaders: {},
  },

  // Images API
  {
    route_pattern: /^\/v1\/images\/generations/,
    method: HttpMethod.POST,
    functionName: FunctionName.GENERATE_IMAGE,
    requestSchema: GenerateImageRequestBody,
    requestBody: {} as GenerateImageRequestBody,
    responseSchema: GenerateImageResponseBody,
    url: '',
    requestHeaders: {},
  },

  // Moderations API
  {
    route_pattern: /^\/v1\/moderations/,
    method: HttpMethod.POST,
    functionName: FunctionName.MODERATE,
    requestSchema: ModerationRequestBody,
    requestBody: {} as ModerationRequestBody,
    responseSchema: ModerationResponseBody,
    url: '',
    requestHeaders: {},
  },

  // Realtime API
  // {
  //   pattern: /^\/v1\/realtime/,
  //   method: HttpMethod.GET,
  //   functionName: FunctionName.REALTIME,
  // },

  // Responses API
  {
    route_pattern: /^\/v1\/responses$/,
    method: HttpMethod.POST,
    functionName: FunctionName.CREATE_MODEL_RESPONSE,
    requestSchema: ResponsesRequestBody,
    requestBody: {} as ResponsesRequestBody,
    responseSchema: ResponsesResponseBody,
    url: '',
    requestHeaders: {},
  },
  {
    route_pattern: /^\/v1\/responses$/,
    method: HttpMethod.POST,
    functionName: FunctionName.CREATE_MODEL_RESPONSE,
    requestSchema: ResponsesRequestBody,
    requestBody: {} as ResponsesRequestBody,
    responseSchema: ResponsesResponseBody,
    url: '',
    requestHeaders: {},
    stream: true,
  },
  // {
  //   pattern: /^\/v1\/responses\/[^\/]+\/input_items$/,
  //   method: HttpMethod.GET,
  //   functionName: FunctionName.LIST_RESPONSE_INPUT_ITEMS,
  // },
  // {
  //   pattern: /^\/v1\/responses\/[^\/]+$/,
  //   method: HttpMethod.GET,
  //   functionName: FunctionName.GET_MODEL_RESPONSE,
  // },
  // {
  //   pattern: /^\/v1\/responses\/[^\/]+$/,
  //   method: HttpMethod.DELETE,
  //   functionName: FunctionName.DELETE_MODEL_RESPONSE,
  // },

  // System One API. A decision model answers in one forward pass, so there
  // is nothing to stream and no `stream` variant.
  {
    route_pattern: /^\/v1\/systemone$/,
    method: HttpMethod.POST,
    functionName: FunctionName.SYSTEM_ONE,
    requestSchema: SystemOneRequestBody,
    requestBody: {} as SystemOneRequestBody,
    responseSchema: SystemOneResponseBody,
    url: '',
    requestHeaders: {},
  },
];
