import { aI21Config } from '@api/ai-providers/ai21';
import { anthropicConfig } from '@api/ai-providers/anthropic';
import { anyscaleConfig } from '@api/ai-providers/anyscale';
import {
  azureAIInferenceConfig,
  githubModelAPiConfig,
} from '@api/ai-providers/azure-ai-foundry';
import { azureOpenAIConfig } from '@api/ai-providers/azure-openai';
// Bedrock uses @smithy/signature-v4 which has issues in Cloudflare Workers global scope
// We lazy-load it to avoid the initialization issue
import { cerebrasProviderAPIConfig } from '@api/ai-providers/cerebras';
import { deepbricksConfig } from '@api/ai-providers/deepbricks';
import { deepInfraConfig } from '@api/ai-providers/deepinfra';
import { deepSeekConfig } from '@api/ai-providers/deepseek';
import { googleConfig } from '@api/ai-providers/google';
import { googleVertexAIConfig } from '@api/ai-providers/google-vertex-ai';
import { groqConfig } from '@api/ai-providers/groq';
import { mistralAIConfig } from '@api/ai-providers/mistral-ai';
import { naceConfig } from '@api/ai-providers/nace';
import { ollamaConfig } from '@api/ai-providers/ollama';
import { openAIConfig } from '@api/ai-providers/openai';
import { openrouterConfig } from '@api/ai-providers/openrouter';
import { palmAIConfig } from '@api/ai-providers/palm';
import { predibaseConfig } from '@api/ai-providers/predibase';
import { typesafeConfig } from '@api/ai-providers/typesafe';
import { xaiConfig } from '@api/ai-providers/xai';
import type { AIProviderConfig } from '@shared/types/ai-providers/config';
import { AIProvider } from '@shared/types/constants';

// NOTE: Bedrock is temporarily disabled due to @smithy/signature-v4 initialization issues in Cloudflare Workers
// The library generates random values at import time which is not allowed in global scope.
// TODO: Re-enable when a workaround is found (e.g., using web crypto polyfill or dynamic import)

export const providerConfigs: {
  [key in AIProvider]: AIProviderConfig | undefined;
} = {
  [AIProvider.AI21]: aI21Config,
  [AIProvider.ANTHROPIC]: anthropicConfig,
  [AIProvider.ANYSCALE]: anyscaleConfig,
  [AIProvider.AZURE_AI_FOUNDRY]: azureAIInferenceConfig,
  [AIProvider.AZURE_OPENAI]: azureOpenAIConfig,
  [AIProvider.BEDROCK]: undefined, // Disabled - @smithy/signature-v4 incompatible with CF Workers
  [AIProvider.CEREBRAS]: cerebrasProviderAPIConfig,
  [AIProvider.COHERE]: undefined,
  [AIProvider.CORTEX]: undefined,
  [AIProvider.DASHSCOPE]: undefined,
  [AIProvider.DEEPBRICKS]: deepbricksConfig,
  [AIProvider.DEEPINFRA]: deepInfraConfig,
  [AIProvider.DEEPSEEK]: deepSeekConfig,
  [AIProvider.FIREWORKS_AI]: undefined,
  [AIProvider.GITHUB]: githubModelAPiConfig,
  [AIProvider.GOOGLE]: googleConfig,
  [AIProvider.GOOGLE_VERTEX_AI]: googleVertexAIConfig,
  [AIProvider.GROQ]: groqConfig,
  [AIProvider.HUGGINGFACE]: undefined,
  [AIProvider.INFERENCE_NET]: undefined,
  [AIProvider.JINA]: undefined,
  [AIProvider.LAMBDA]: undefined,
  [AIProvider.LEMONFOX_AI]: undefined,
  [AIProvider.LEPTON]: undefined,
  [AIProvider.LINGYI]: undefined,
  [AIProvider.MILVUS]: undefined,
  [AIProvider.MISTRAL_AI]: mistralAIConfig,
  [AIProvider.MONSTERAPI]: undefined,
  [AIProvider.MOONSHOT]: undefined,
  [AIProvider.NACE]: naceConfig,
  [AIProvider.NCOMPASS]: undefined,
  [AIProvider.NEBIUS]: undefined,
  [AIProvider.NOMIC]: undefined,
  [AIProvider.NOVITA_AI]: undefined,
  [AIProvider.OLLAMA]: ollamaConfig,
  [AIProvider.OPENAI]: openAIConfig,
  [AIProvider.OPENROUTER]: openrouterConfig,
  [AIProvider.PALM]: palmAIConfig,
  [AIProvider.PERPLEXITY_AI]: undefined,
  [AIProvider.PREDIBASE]: predibaseConfig,
  [AIProvider.RECRFT_AI]: undefined,
  [AIProvider.REKA_AI]: undefined,
  [AIProvider.REPLICATE]: undefined,
  [AIProvider.SAGEMAKER]: undefined,
  [AIProvider.SAMBANOVA]: undefined,
  [AIProvider.SEGMIND]: undefined,
  [AIProvider.SILICONFLOW]: undefined,
  [AIProvider.STABILITY_AI]: undefined,
  [AIProvider.TOGETHER_AI]: undefined,
  [AIProvider.TRITON]: undefined,
  [AIProvider.TYPESAFE]: typesafeConfig,
  [AIProvider.UPSTAGE]: undefined,
  [AIProvider.VOYAGE]: undefined,
  [AIProvider.WORKERS_AI]: undefined,
  [AIProvider.XAI]: xaiConfig,
  [AIProvider.ZHIPU]: undefined,
};

/**
 * Whether a provider needs an API key before it can be called.
 *
 * Self-hosted providers carry no key -- Ollama sets `isAPIKeyRequired: false`
 * -- so treating a missing key as a misconfiguration would make every internal
 * skill call refuse to run against them. Providers we have no config for are
 * assumed to need one, matching what `/v1/super-agents/ai-providers/schemas`
 * reports to the dashboard.
 */
export function isAPIKeyRequiredForProvider(provider: string): boolean {
  const config = providerConfigs[provider as AIProvider];
  return config?.api.isAPIKeyRequired ?? true;
}
