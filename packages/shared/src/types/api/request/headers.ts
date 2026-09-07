import { SuperAgentsRequestBody } from '@shared/types/api/request/body';
import { ReasoningEffort } from '@shared/types/api/routes/shared/thinking';

import { AIProvider, RETRY_STATUS_CODES } from '@shared/types/constants';
import { CacheMode, CacheSettings } from '@shared/types/middleware/cache';
import { Hook } from '@shared/types/middleware/hooks';
import { removeEndingPath, removeTrailingSlash } from '@shared/utils/url';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';

export enum HeaderKey {
  CONFIG = 'sa-config',
  CONTENT_TYPE = 'content-type',
}

/**
 * Settings for retrying requests.
 */
export const RetrySettings = z.object({
  /** The maximum number of retry attempts. */
  attempts: z.number(),
  /** The HTTP status codes on which to retry. */
  on_status_codes: z.array(z.number()).default(RETRY_STATUS_CODES).optional(),
  /** Whether to use the provider's retry wait. */
  use_retry_after_header: z.boolean().optional(),
});

export type RetrySettings = z.infer<typeof RetrySettings>;

export const AzureOpenAIConfig = z.object({
  url: z
    .url({ error: '`url` is required' })
    .transform(removeTrailingSlash)
    .transform(removeEndingPath),
});

export const AzureAIFoundryConfig = z.object({
  url: z
    .url({ error: '`url` is required' })
    .transform(removeTrailingSlash)
    .transform(removeEndingPath),
});

export const AnthropicConfig = z.object({
  url: z
    .url({ error: '`url` is required' })
    .transform(removeTrailingSlash)
    .transform(removeEndingPath),
});

export const SuperAgentsTargetBase = z.object({
  // Target Details
  id: z.string().optional(),
  index: z.number().optional(),

  // Target Settings
  weight: z.number().default(1),
  on_status_codes: z.array(z.number()).optional(),
  request_timeout: z.number().optional(),
  custom_host: z.string().optional(),
  forward_headers: z.array(z.string()).optional(),
  cache: CacheSettings.default({ mode: CacheMode.DISABLED }),
  retry: RetrySettings.default({ attempts: 0 }),

  inner_provider: z.enum(AIProvider).optional(),
  // TODO: Remove this required field and allow defining through the UI
  api_key: z
    .string()
    .optional()
    .describe('The API key for the provider if not defined through the UI'),

  // Reference to stored API key - alternative to direct api_key
  api_key_id: z
    .string()
    .uuid()
    .optional()
    .describe('Reference to stored API key ID from ai_provider_api_keys table'),

  // Anthropic specific
  anthropic_beta: z.string().optional(),
  anthropic_version: z.string().optional(),

  // AWS specific
  aws_secret_access_key: z.string().optional(),
  aws_access_key_id: z.string().optional(),
  aws_session_token: z.string().optional(),
  aws_region: z.string().optional(),
  aws_auth_type: z.string().optional(),
  aws_role_arn: z.string().optional(),
  aws_external_id: z.string().optional(),
  aws_s3_bucket: z.string().optional(),
  aws_s3_object_key: z.string().optional(),
  aws_bedrock_model: z.string().optional(),
  aws_server_side_encryption: z.string().optional(),
  aws_server_side_encryption_kms_key_id: z.string().optional(),

  // Azure OpenAI specific
  azure_openai_config: AzureOpenAIConfig.optional(),

  // Azure AI Foundry specific
  azure_ai_foundry_config: AzureAIFoundryConfig.optional(),

  // Azure Other
  azure_extra_params: z.string().optional(),
  azure_auth_mode: z.string().optional(),
  azure_managed_client_id: z.string().optional(),
  azure_entra_client_id: z.string().optional(),
  azure_entra_client_secret: z.string().optional(),
  azure_entra_tenant_id: z.string().optional(),
  azure_ad_auth: z.string().optional(),
  azure_ad_token: z.string().optional(),

  // Cortex specific
  snowflake_account: z.string().optional(),

  // Fireworks fine-tune required fields
  fireworks_account_id: z.string().optional(),

  // Google specific
  vertex_service_account_json: z.string().optional(),
  vertex_region: z.string().optional(),
  vertex_project_id: z.string().optional(),
  vertex_storage_bucket_name: z.string().optional(),
  vertex_model_name: z.string().optional(),
  // Required for file uploads with google.
  filename: z.string().optional(),

  // Hugging Face specific
  huggingface_base_url: z.string().optional(),

  // Mistral specific
  // Parameter to determine if fim/completions endpoint is to be used
  mistral_fim_completion: z.string().optional(),

  // OpenAI specific
  openai_project: z.string().optional(),
  openai_organization: z.string().optional(),
  openai_beta: z.string().optional(),

  // Sagemaker specific
  amzn_sagemaker_custom_attributes: z.string().optional(),
  amzn_sagemaker_target_model: z.string().optional(),
  amzn_sagemaker_target_variant: z.string().optional(),
  amzn_sagemaker_target_container_hostname: z.string().optional(),
  amzn_sagemaker_inference_id: z.string().optional(),
  amzn_sagemaker_session_id: z.string().optional(),
  amzn_sagemaker_model_name: z.string().optional(),

  // Stability AI specific
  stability_client_id: z.string().optional(),
  stability_client_user_id: z.string().optional(),
  stability_client_version: z.string().optional(),
  stability_url_to_fetch: z.string().optional(),

  // Ollama specific
  ollama_url_to_fetch: z.string().optional(),

  // Mistral AI specific
});

export type SuperAgentsTargetBase = z.infer<typeof SuperAgentsTargetBase>;

export enum OptimizationType {
  AUTO = 'auto',
  NONE = 'none',
}

export const SuperAgentsTargetPreProcessed = SuperAgentsTargetBase.extend({
  /** Super Agents optimization type */
  optimization: z
    .enum(OptimizationType)
    .optional()
    .default(OptimizationType.NONE)
    .describe('The name of the Super Agents configuration to use'),

  /** Super Agents optimization version */
  optimization_version: z
    .number()
    .min(0)
    .optional()
    .describe('The version of the Super Agents configuration to use'),

  /** The AI provider to use if no configuration is provided */
  provider: z
    .enum(AIProvider, {
      error: (err) => {
        return `Invalid provider: ${err.input}`;
      },
    })
    .optional()
    .describe('The AI provider to use if no configuration is provided'),

  /** The AI model to use if no configuration is provided */
  model: z
    .string()
    .optional()
    .describe('The AI model to use if no configuration is provided'),
})
  .refine((data) => {
    if (!data.provider && data.optimization === OptimizationType.NONE) {
      return false;
    }
    return true;
  }, '`provider` is required when optimization is not set to auto')
  .refine((data) => {
    if (
      data.optimization_version &&
      data.optimization === OptimizationType.NONE
    ) {
      return false;
    }
    return true;
  }, '`optimization_version` is defined, but `optimization` is set to none. Set `optimization` to auto to use an optimization version.')
  .refine((data) => {
    if (data.provider && !data.model) {
      return false;
    }
    return true;
  }, 'A model is required when using a provider.');

export type SuperAgentsTargetPreProcessed = z.infer<
  typeof SuperAgentsTargetPreProcessed
>;

// Configuration parameters - the AI parameters for a specific version
export const TargetConfigurationParams = z.object({
  ai_provider: z.enum(AIProvider),
  model: z.string().min(1),
  system_prompt: z.string().min(1).nullable(),
  temperature: z.number().min(0).max(2).nullable(),
  max_tokens: z.number().int().positive().nullable(),
  top_p: z.number().min(0).max(1).nullable(),
  frequency_penalty: z.number().min(-2).max(2).nullable(),
  presence_penalty: z.number().min(-2).max(2).nullable(),
  stop: z.array(z.string()).nullable(),
  seed: z.number().int().nullable(),
  reasoning_effort: z.enum(ReasoningEffort).nullable(),
  // Additional provider-specific parameters can be added here
  additional_params: z.record(z.string(), z.unknown()).nullable(),
});
export type TargetConfigurationParams = z.infer<
  typeof TargetConfigurationParams
>;

/** Super Agents Target with configuration name and version validated and processed.
 * The configuration options have already been applied to the target.
 *
 * For example, the `provider` and `model` fields have already been set to the value of the configuration. */
export const SuperAgentsTarget = SuperAgentsTargetBase.extend({
  configuration: TargetConfigurationParams,
  api_key: z.string().describe('The API key for the provider').optional(),
});

export type SuperAgentsTarget = z.infer<typeof SuperAgentsTarget>;

export enum StrategyModes {
  LOADBALANCE = 'loadbalance',
  FALLBACK = 'fallback',
  SINGLE = 'single',
  CONDITIONAL = 'conditional',
}

export const Strategy = z.object({
  mode: z.enum(StrategyModes).describe('The strategy mode to use'),
  on_status_codes: z.array(z.number()).optional(),
  conditions: z
    .array(
      z.object({
        query: z.record(z.string(), z.unknown()),
        target: z.string(),
      }),
    )
    .optional(),
  default: z.string().optional(),
});

export type Strategy = z.infer<typeof Strategy>;

export const NonPrivateSuperAgentsConfig = z.object({
  agent_name: z.string({ error: 'Agent name is required' }),
  skill_name: z.string({ error: 'Skill name is required' }),
  override_params: SuperAgentsRequestBody.optional(),
  request_timeout: z.number().optional(),
  forward_headers: z.array(z.string()).optional(),
  force_refresh: z.boolean().optional(),
  force_hook_refresh: z.boolean().optional(),
  strict_open_ai_compliance: z.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),

  /** Variables for the system prompt template in the Super Agents configuration */
  system_prompt_variables: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      'The variables for the system prompt template in the Super Agents configuration',
    ),
});

export type NonPrivateSuperAgentsConfig = z.infer<
  typeof NonPrivateSuperAgentsConfig
>;

export const BaseSuperAgentsConfig = NonPrivateSuperAgentsConfig.extend({
  strategy: Strategy.default({
    mode: StrategyModes.SINGLE,
  }),
  hooks: z.array(Hook).default([]),
  /**
   * Set by the gateway on the request it sends a reviewer agent: the trace
   * of the request under review. A review is never itself reviewed, which is
   * what keeps two agents that review each other from looping.
   */
  reviewing_trace_id: z.string().optional(),

  // Observability
  app_id: z.string().optional(),
  // Use a function to generate UUID lazily at parse time, not module load time
  // This is required for Cloudflare Workers which disallow random generation in global scope
  trace_id: z.string().default(() => uuidv4()),
  span_id: z.string().optional(),
  span_name: z.string().optional(),
  parent_span_id: z.string().optional(),
  user_human_name: z.string().optional(),
});

export type BaseSuperAgentsConfig = z.infer<typeof BaseSuperAgentsConfig>;

export const SuperAgentsConfig = BaseSuperAgentsConfig.extend({
  targets: z.array(SuperAgentsTarget),
})
  // Validate Google Vertex AI specific fields
  .refine(
    (value) => {
      for (const target of value.targets) {
        const isGoogleVertexAIProvider =
          target.configuration.ai_provider === AIProvider.GOOGLE_VERTEX_AI;
        const hasGoogleVertexAIFields =
          (target.vertex_project_id && target.vertex_region) ||
          (target.vertex_region && target.vertex_service_account_json);
        if (isGoogleVertexAIProvider && !hasGoogleVertexAIFields) {
          return false;
        }
      }
      return true;
    },
    {
      message: `Invalid configuration. ('vertex_project_id' and 'vertex_region') or ('vertex_service_account_json' and 'vertex_region') are required for Google Vertex AI provider. Example: { 'provider': 'vertex-ai', 'vertex_project_id': 'my-project-id', 'vertex_region': 'us-central1', api_key: 'ya29...' }`,
    },
  );

export type SuperAgentsConfig = z.infer<typeof SuperAgentsConfig>;

export const SuperAgentsConfigPreProcessed = BaseSuperAgentsConfig.extend({
  /**
   * Optional here, unlike in the resolved config: a request that names only
   * the agent is routed to one of its skills by the gateway, which fills this
   * in before anything downstream reads it.
   */
  skill_name: z.string().optional(),
  targets: z.preprocess(
    (val) => val ?? [{ optimization: OptimizationType.AUTO }],
    z.array(SuperAgentsTargetPreProcessed),
  ),
});

export type SuperAgentsConfigPreProcessed = z.infer<
  typeof SuperAgentsConfigPreProcessed
>;
