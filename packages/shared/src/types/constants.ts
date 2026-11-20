import z from 'zod';

export enum AIProvider {
  AI21 = 'ai21',
  ANTHROPIC = 'anthropic',
  ANYSCALE = 'anyscale',
  AZURE_AI_FOUNDRY = 'azure-ai-foundry',
  AZURE_OPENAI = 'azure-openai',
  BEDROCK = 'bedrock',
  CEREBRAS = 'cerebras',
  COHERE = 'cohere',
  CORTEX = 'cortex',
  DASHSCOPE = 'dashscope',
  DEEPBRICKS = 'deepbricks',
  DEEPINFRA = 'deepinfra',
  DEEPSEEK = 'deepseek',
  FIREWORKS_AI = 'fireworks-ai',
  GITHUB = 'github',
  GOOGLE = 'google',
  GOOGLE_VERTEX_AI = 'vertex-ai',
  GROQ = 'groq',
  HUGGINGFACE = 'huggingface',
  INFERENCE_NET = 'inference-net',
  JINA = 'jina',
  LAMBDA = 'lambda',
  LEMONFOX_AI = 'lemonfox-ai',
  LEPTON = 'lepton',
  LINGYI = 'lingyi',
  MILVUS = 'milvus',
  MISTRAL_AI = 'mistral-ai',
  MONSTERAPI = 'monsterapi',
  MOONSHOT = 'moonshot',
  NACE = 'nace',
  NCOMPASS = 'ncompass',
  NEBIUS = 'nebius',
  NOMIC = 'nomic',
  NOVITA_AI = 'novita-ai',
  OLLAMA = 'ollama',
  OPENAI = 'openai',
  OPENROUTER = 'openrouter',
  PALM = 'palm',
  PERPLEXITY_AI = 'perplexity-ai',
  PREDIBASE = 'predibase',
  RECRFT_AI = 'recraft-ai',
  REKA_AI = 'reka-ai',
  REPLICATE = 'replicate',
  SAGEMAKER = 'sagemaker',
  SAMBANOVA = 'sambanova',
  SEGMIND = 'segmind',
  SILICONFLOW = 'siliconflow',
  STABILITY_AI = 'stability-ai',
  TOGETHER_AI = 'together-ai',
  TRITON = 'triton',
  TYPESAFE = 'typesafe',
  UPSTAGE = 'upstage',
  VOYAGE = 'voyage',
  WORKERS_AI = 'workers-ai',
  XAI = 'xai',
  ZHIPU = 'zhipu',
}

export const PrettyAIProvider: Record<AIProvider, string> = {
  [AIProvider.AI21]: 'AI21',
  [AIProvider.ANTHROPIC]: 'Anthropic',
  [AIProvider.ANYSCALE]: 'Anyscale',
  [AIProvider.AZURE_AI_FOUNDRY]: 'Azure AI Foundry',
  [AIProvider.AZURE_OPENAI]: 'Azure OpenAI',
  [AIProvider.BEDROCK]: 'Bedrock',
  [AIProvider.CEREBRAS]: 'Cerebras',
  [AIProvider.COHERE]: 'Cohere',
  [AIProvider.CORTEX]: 'Cortex',
  [AIProvider.DASHSCOPE]: 'DashScope',
  [AIProvider.DEEPBRICKS]: 'DeepBricks',
  [AIProvider.DEEPINFRA]: 'DeepInfra',
  [AIProvider.DEEPSEEK]: 'DeepSeek',
  [AIProvider.FIREWORKS_AI]: 'Fireworks AI',
  [AIProvider.GITHUB]: 'GitHub',
  [AIProvider.GOOGLE]: 'Google',
  [AIProvider.GOOGLE_VERTEX_AI]: 'Google Vertex AI',
  [AIProvider.GROQ]: 'Groq',
  [AIProvider.HUGGINGFACE]: 'Hugging Face',
  [AIProvider.INFERENCE_NET]: 'Inference Net',
  [AIProvider.JINA]: 'Jina',
  [AIProvider.LAMBDA]: 'Lambda',
  [AIProvider.LEMONFOX_AI]: 'LemonFox AI',
  [AIProvider.LEPTON]: 'Lepton',
  [AIProvider.LINGYI]: 'Lingyi',
  [AIProvider.MILVUS]: 'Milvus',
  [AIProvider.MISTRAL_AI]: 'Mistral AI',
  [AIProvider.MONSTERAPI]: 'MonsterAPI',
  [AIProvider.MOONSHOT]: 'Moonshot',
  [AIProvider.NACE]: 'Nace.AI',
  [AIProvider.NCOMPASS]: 'NCompass',
  [AIProvider.NEBIUS]: 'Nebius',
  [AIProvider.NOMIC]: 'Nomic',
  [AIProvider.NOVITA_AI]: 'Novita AI',
  [AIProvider.OLLAMA]: 'Ollama',
  [AIProvider.OPENAI]: 'OpenAI',
  [AIProvider.OPENROUTER]: 'OpenRouter',
  [AIProvider.PALM]: 'PaLM',
  [AIProvider.PERPLEXITY_AI]: 'Perplexity AI',
  [AIProvider.PREDIBASE]: 'Predibase',
  [AIProvider.RECRFT_AI]: 'Recraft AI',
  [AIProvider.REKA_AI]: 'Reka AI',
  [AIProvider.REPLICATE]: 'Replicate',
  [AIProvider.SAGEMAKER]: 'SageMaker',
  [AIProvider.SAMBANOVA]: 'SambaNova',
  [AIProvider.SEGMIND]: 'Segmind',
  [AIProvider.SILICONFLOW]: 'SiliconFlow',
  [AIProvider.STABILITY_AI]: 'Stability AI',
  [AIProvider.TOGETHER_AI]: 'Together AI',
  [AIProvider.TRITON]: 'Triton',
  [AIProvider.TYPESAFE]: 'TypeSafe AI',
  [AIProvider.UPSTAGE]: 'Upstage',
  [AIProvider.VOYAGE]: 'Voyage',
  [AIProvider.WORKERS_AI]: 'Workers AI',
  [AIProvider.XAI]: 'xAI',
  [AIProvider.ZHIPU]: 'Zhipu',
};

export const MAX_RETRY_LIMIT_MS = 60 * 1000; // 60 seconds

export const POSSIBLE_RETRY_STATUS_HEADERS = [
  'retry-after-ms',
  'x-ms-retry-after-ms',
  'retry-after',
];

export const RETRY_STATUS_CODES = [429, 500, 502, 503, 504];
export const MAX_RETRIES = 5;
export const REQUEST_TIMEOUT_STATUS_CODE = 408;
export const PRECONDITION_CHECK_FAILED_STATUS_CODE = 412;

export enum ContentTypeName {
  APPLICATION_JSON = 'application/json',
  MULTIPART_FORM_DATA = 'multipart/form-data',
  EVENT_STREAM = 'text/event-stream',
  AUDIO_MPEG = 'audio/mpeg',
  APPLICATION_OCTET_STREAM = 'application/octet-stream',
  BINARY_OCTET_STREAM = 'binary/octet-stream',
  GENERIC_AUDIO_PATTERN = 'audio',
  PLAIN_TEXT = 'text/plain',
  HTML = 'text/html',
  GENERIC_IMAGE_PATTERN = 'image/',
}

export const FileExtensionName = z.enum([
  'mp4',
  'jpeg',
  'jpg',
  'png',
  'bmp',
  'tiff',
  'webp',
  'pdf',
  'csv',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'html',
  'md',
  'mp3',
  'wav',
  'txt',
  'mov',
  'mpeg',
  'mpg',
  'avi',
  'wmv',
  'mpegps',
  'flv',
  'webm',
]);

export type FileExtensionName = z.infer<typeof FileExtensionName>;

export const fileExtensionMimeTypeMap: Record<FileExtensionName, string> = {
  [FileExtensionName.enum.mp4]: 'video/mp4',
  [FileExtensionName.enum.jpeg]: 'image/jpeg',
  [FileExtensionName.enum.jpg]: 'image/jpeg',
  [FileExtensionName.enum.png]: 'image/png',
  [FileExtensionName.enum.bmp]: 'image/bmp',
  [FileExtensionName.enum.tiff]: 'image/tiff',
  [FileExtensionName.enum.webp]: 'image/webp',
  [FileExtensionName.enum.pdf]: 'application/pdf',
  [FileExtensionName.enum.csv]: 'text/csv',
  [FileExtensionName.enum.doc]: 'application/msword',
  [FileExtensionName.enum.docx]:
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  [FileExtensionName.enum.xls]: 'application/vnd.ms-excel',
  [FileExtensionName.enum.xlsx]:
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  [FileExtensionName.enum.html]: 'text/html',
  [FileExtensionName.enum.md]: 'text/markdown',
  [FileExtensionName.enum.mp3]: 'audio/mp3',
  [FileExtensionName.enum.wav]: 'audio/wav',
  [FileExtensionName.enum.txt]: 'text/plain',
  [FileExtensionName.enum.mov]: 'video/mov',
  [FileExtensionName.enum.mpeg]: 'video/mpeg',
  [FileExtensionName.enum.mpg]: 'video/mpg',
  [FileExtensionName.enum.avi]: 'video/avi',
  [FileExtensionName.enum.wmv]: 'video/wmv',
  [FileExtensionName.enum.mpegps]: 'video/mpegps',
  [FileExtensionName.enum.flv]: 'video/flv',
  [FileExtensionName.enum.webm]: 'video/webm',
};

export const imagesMimeTypes = [
  fileExtensionMimeTypeMap.jpeg,
  fileExtensionMimeTypeMap.jpg,
  fileExtensionMimeTypeMap.png,
  fileExtensionMimeTypeMap.bmp,
  fileExtensionMimeTypeMap.tiff,
  fileExtensionMimeTypeMap.webp,
];

export const documentMimeTypes = [
  fileExtensionMimeTypeMap.pdf,
  fileExtensionMimeTypeMap.csv,
  fileExtensionMimeTypeMap.doc,
  fileExtensionMimeTypeMap.docx,
  fileExtensionMimeTypeMap.xls,
  fileExtensionMimeTypeMap.xlsx,
  fileExtensionMimeTypeMap.html,
  fileExtensionMimeTypeMap.md,
  fileExtensionMimeTypeMap.txt,
];

export const OPTIONAL_API_KEY_PROVIDERS: readonly AIProvider[] = [
  AIProvider.OLLAMA,
  AIProvider.TRITON,
  AIProvider.MISTRAL_AI,
];

// Default URLs for self-hosted providers
export const DEFAULT_SELF_HOSTED_URLS: Partial<Record<AIProvider, string>> = {
  [AIProvider.OLLAMA]: 'http://localhost:11434',
  [AIProvider.TRITON]: 'http://localhost:8000',
  [AIProvider.MISTRAL_AI]: 'http://localhost:8000',
  // Drex's own server, `kapitsa-systemone`, listens here by default.
  [AIProvider.NACE]: 'http://localhost:8000',
  // Add more providers as needed
};

/**
 * The providers that serve decision models, and the models each offers.
 *
 * A decision model answers questions about some material with probabilities
 * -- the System One API, `/v1/systemone` -- rather than writing text, so its
 * models are `decision` models and the dashboard suggests these ids for them
 * instead of models.dev's catalogue, which lists none.
 */
export const DECISION_PROVIDER_MODELS: Partial<
  Record<AIProvider, readonly string[]>
> = {
  [AIProvider.TYPESAFE]: ['jev-latest', 'jev-preview'],
  [AIProvider.NACE]: [
    'drex-latest',
    'drex-v2.0',
    'drex-max-v1.1',
    'drex-max-finance',
  ],
};

/** Whether a provider serves decision models, and only those. */
export function isDecisionProvider(
  provider: string | null | undefined,
): boolean {
  return (
    provider !== null &&
    provider !== undefined &&
    provider in DECISION_PROVIDER_MODELS
  );
}
