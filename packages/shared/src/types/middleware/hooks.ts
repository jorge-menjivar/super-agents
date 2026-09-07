import {
  SuperAgentsRequestBody,
  type SuperAgentsRequestData,
} from '@shared/types/api/request';
import { SuperAgentsResponseBody } from '@shared/types/api/response';
import { AIProvider } from '@shared/types/constants';
import { HttpMethod } from '@shared/types/http';
import { CacheMode } from '@shared/types/middleware/cache';
import { z } from 'zod';

export enum HookType {
  INPUT_HOOK = 'input',
  OUTPUT_HOOK = 'output',
}

export const HookHttpProviderConfig = z.object({
  method: z.enum(HttpMethod),
  url: z.string(),
});

export type HookHttpProviderConfig = z.infer<typeof HookHttpProviderConfig>;

export const HookLLMProviderConfig = z.object({
  model: z.string(),
  provider: z.enum(AIProvider),
  body: z.record(z.string(), z.unknown()).optional(),
});

export type HookLLMProviderConfig = z.infer<typeof HookLLMProviderConfig>;

export enum HookProviderSource {
  DEFAULT = 'default',
}

/**
 * Another agent on this deployment reviews the request, or the response the
 * client is about to receive. The review is an ordinary gateway request to
 * that agent, so its policy is the reviewer skill's system prompt and its
 * verdicts are logged and evaluated like any other traffic.
 */
export const HookAgentProviderConfig = z.object({
  agent_name: z.string(),
  /** Which of the reviewer's skills; omitted lets the router pick one. */
  skill_name: z.string().optional(),
  /** How long the review may take, in milliseconds; a minute by default. */
  timeout_ms: z.int().positive().optional(),
});

export type HookAgentProviderConfig = z.infer<typeof HookAgentProviderConfig>;

export enum HookProvider {
  HTTP = 'http',
  LLM = 'llm',
  AGENT = 'agent',
}

export const Hook = z.object({
  id: z.string(),
  type: z.enum(HookType),
  hook_provider: z.enum(HookProvider),
  config: z.union([
    HookHttpProviderConfig,
    HookLLMProviderConfig,
    HookAgentProviderConfig,
  ]),
  await: z.boolean().optional().default(true),
  cache_mode: z.enum(CacheMode).default(CacheMode.DISABLED),
  /**
   * What a hook that cannot run -- its provider missing, unreachable, or
   * answering with no verdict -- does to the request. False, the default,
   * lets it through as if the hook were absent; true withholds it, for a
   * check that matters more than availability.
   */
  fail_closed: z.boolean().default(false),
  /**
   * Whether a client whose request or response this hook withholds is told
   * why. False, the default, gives it a message saying only which hook
   * withheld it; true relays the hook's `reason` -- or the error that closed
   * it -- in the 446 as well. A reviewer's reason tends to quote what it
   * objected to, and a client told exactly why is a client shown how to
   * rephrase, so this is a choice rather than the rule.
   */
  expose_reason: z.boolean().default(false),
});

export type Hook = z.infer<typeof Hook>;

export const HookResult = z.object({
  deny_request: z.boolean(),
  request_body_override: SuperAgentsRequestBody.optional(),
  response_body_override: SuperAgentsResponseBody.optional(),
  skipped: z.boolean(),
  /** Why the hook decided as it did, in the hook's own words. */
  reason: z.string().optional(),
  /**
   * Set when the hook could not run: the provider was unreachable, or its
   * answer did not fit. Such a hook denies nothing, so this is the only
   * record that the request went unreviewed.
   */
  error: z.string().optional(),
});

export type HookResult = z.infer<typeof HookResult>;

/**
 * The body of the 446 a denial becomes. Its `error` is shaped like every
 * other gateway error, so a client SDK surfaces `message` as it would any
 * failure. The hook's own account of why appears -- in `reason`, and at the
 * end of the message -- only when the hook has `expose_reason`; otherwise
 * the message says which hook withheld what, and no more. The hook log
 * itself stays on the log row: it names the reviewer and carries every
 * hook's reason, none of which is the client's to see.
 */
export const HookDenialResponseBody = z.object({
  error: z.object({
    message: z.string(),
    type: z.literal('hook_denied'),
    hook_id: z.string(),
    reason: z.string().optional(),
  }),
});

export type HookDenialResponseBody = z.infer<typeof HookDenialResponseBody>;

/**
 * What a hook is asked to judge. `responseBody` is set for output hooks,
 * which run once the provider has answered and before the client hears; an
 * input hook runs before the provider is asked and sees the request alone.
 */
export interface HookInput {
  requestData: SuperAgentsRequestData;
  responseBody?: SuperAgentsResponseBody;
  statusCode: number | null;
}
