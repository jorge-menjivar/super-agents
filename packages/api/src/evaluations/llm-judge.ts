import { isAPIKeyRequiredForProvider } from '@api/ai-providers';
import {
  getApiUrl,
  getInternalApiKey,
  SA_SKILL_REQUEST_PARAMS,
} from '@api/constants';
import {
  evaluationCriteria,
  scoringGuidelinesText,
} from '@api/evaluations/generic-judge-defaults';
import {
  type EvaluationInput,
  type LLMJudge,
  type LLMJudgeConfig,
  LLMJudgeResult,
} from '@api/types/evaluations/llm-judge';
import type { AppContext } from '@api/types/hono';
import { error, warn } from '@shared/console-logging';
import type { ReasoningEffort } from '@shared/types/api/routes/shared/thinking';
import {
  type AIProvider,
  AIProvider as AIProviderEnum,
} from '@shared/types/constants';
import { DEFAULT_JUDGE_MAX_TOKENS } from '@shared/types/data/system-settings';
import { CacheMode } from '@shared/types/middleware/cache';
import OpenAI from 'openai';
import { z } from 'zod';

// Constants for retry logic
const LLM_JUDGE_MAX_RETRIES = 3;
const LLM_JUDGE_RETRY_DELAY_BASE = 1000; // 1 second base delay

/**
 * The judge answered nothing readable.
 *
 * A clean stop with an empty answer is transient: a self-hosted model can
 * stop having emitted only reasoning, then answer the identical request
 * properly on the retry. A `length` stop is not. The model spent its whole
 * completion budget before it wrote the answer, and the same request under
 * the same budget does the same thing again, so retrying it only triples the
 * cost of finding out. What fixes it is a setting: a bigger budget, or less
 * reasoning.
 */
export class JudgeEmptyCompletionError extends Error {
  constructor(
    public readonly finishReason: string | null,
    public readonly completionTokens: number,
  ) {
    super(
      finishReason === 'length'
        ? `The judge spent its whole completion budget before answering (${completionTokens} completion tokens, finish_reason: length): raise the judge token budget, or lower its reasoning effort`
        : `The judge returned an empty completion (finish_reason: ${
            finishReason ?? 'none'
          }, ${completionTokens} completion tokens)`,
    );
    this.name = 'JudgeEmptyCompletionError';
  }

  /** Whether the identical request might answer next time. */
  get retryable(): boolean {
    return this.finishReason !== 'length';
  }
}

/**
 * Check if an error is retryable for LLM judge requests
 */
function isRetryableLLMJudgeError(error: unknown): boolean {
  if (error instanceof JudgeEmptyCompletionError) {
    return error.retryable;
  }
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return (
      message.includes('timeout') ||
      message.includes('network') ||
      message.includes('connection') ||
      message.includes('rate limit') ||
      message.includes('too many requests') ||
      message.includes('temporary') ||
      message.includes('server error') ||
      message.includes('gateway') ||
      message.includes('service unavailable') ||
      // A judge that answered garbage may answer properly the second time.
      // (An empty answer is decided above, by how the completion stopped.)
      message.includes('valid json')
    );
  }
  return false;
}

/**
 * Parses the judge's JSON, tolerating what self-hosted models actually
 * send: prose around the object, a trailing comma before a brace.
 */
export function parseJudgeJson(content: string): unknown {
  const attempts = [content];
  const first = content.indexOf('{');
  const last = content.lastIndexOf('}');
  if (first !== -1 && last > first) {
    attempts.push(content.slice(first, last + 1));
  }
  for (const attempt of attempts) {
    for (const candidate of [attempt, attempt.replace(/,\s*([}\]])/g, '$1')]) {
      try {
        return JSON.parse(candidate);
      } catch {
        // Try the next shape.
      }
    }
  }
  throw new Error(
    `The judge did not answer valid JSON: ${content.slice(0, 200)}`,
  );
}

/**
 * Fold a caller's extra criteria into a template's user prompt. A metric is
 * described by its own template; a `description` supplied alongside narrows
 * that judgement rather than replacing it, so it is appended instead of being
 * handed to the criteria judge, which builds a generic prompt and drops the
 * template entirely.
 */
export function withExtraCriteria(
  userPrompt: string,
  description?: string,
): string {
  const extra = description?.trim();
  return extra ? `${userPrompt}\n\nAdditional criteria:\n${extra}` : userPrompt;
}

/**
 * Zod schema for evaluation results
 */
const EvaluationResultSchema = z.object({
  score: z.number().min(0).max(1).describe('Evaluation score between 0 and 1'),
  reasoning: z.string().describe('Detailed reasoning for the evaluation'),
});

/**
 * Model configuration for LLM judge
 */
export interface LLMJudgeModelConfig {
  model: string;
  provider: AIProvider;
  /** The provider's API key, where it needs one. */
  apiKey?: string;
  /** The provider's configured base URL, where it has one. */
  customHost?: string;
  /** How long one judging attempt may take, from `options.judge.timeout_ms`. */
  timeoutMs?: number;
  /**
   * How many completion tokens one attempt may spend, from
   * `options.judge.max_tokens`. A reasoning model spends these thinking before
   * it answers, and one that runs out returns nothing at all.
   */
  maxTokens?: number;
  /**
   * How hard a reasoning model may think first, from
   * `options.judge.reasoning_effort`. Null or absent sends nothing.
   */
  reasoningEffort?: ReasoningEffort | null;
}

export function createLLMJudge(
  c: AppContext,
  config: Partial<LLMJudgeConfig> = {},
  modelConfig?: LLMJudgeModelConfig,
  openaiClient?: OpenAI,
): LLMJudge {
  const judgeConfig = {
    model: modelConfig?.model || config.model || 'gpt-5-mini',
    temperature: config.temperature || 0.1,
    // The resolved model carries what system settings say; an evaluation's
    // own parameters win over that, being the more specific answer. Absent
    // from both, the shared default applies.
    max_tokens:
      config.max_tokens ?? modelConfig?.maxTokens ?? DEFAULT_JUDGE_MAX_TOKENS,
    reasoning_effort:
      config.reasoning_effort ?? modelConfig?.reasoningEffort ?? null,
    timeout: modelConfig?.timeoutMs ?? config.timeout ?? 30000,
  };

  // Provider and API key from model config or defaults
  const provider = modelConfig?.provider || AIProviderEnum.OPENAI;
  const apiKey = modelConfig?.apiKey || '';
  const customHost = modelConfig?.customHost;

  // Create OpenAI client once (or use injected client for testing)
  const client =
    openaiClient ||
    new OpenAI({
      apiKey: getInternalApiKey(c),
      baseURL: `${getApiUrl(c)}/v1`,
      dangerouslyAllowBrowser: true, // Safe in server-side Node.js context
      // This was computed into `judgeConfig` and never passed on, so every
      // judging call ran under the client's ten-minute default, retried
      // twice -- three times the lock it holds.
      timeout: judgeConfig.timeout,
      maxRetries: 1,
    });

  /**
   * Generate evaluation prompt for text evaluation
   */
  function generateEvaluationPrompt(input: EvaluationInput): {
    systemPrompt: string;
    userPrompt: string;
  } {
    // A caller that built its own prompts has them used verbatim. Everything
    // else is scored by the criteria judge. The judge used to re-derive a
    // system/user split from `text` instead, guessing at blank lines and
    // prompt wording -- a template whose opening paragraph mentioned JSON
    // was read as an extraction and scored a flat 1.0 whatever it answered.
    if (input.systemPrompt !== undefined && input.userPrompt !== undefined) {
      return {
        systemPrompt: input.systemPrompt,
        userPrompt: input.userPrompt,
      };
    }

    return criteriaBasedPrompt(input);
  }

  /** The generic criteria judge. */
  function criteriaBasedPrompt(input: EvaluationInput): {
    systemPrompt: string;
    userPrompt: string;
  } {
    const criteria =
      input.evaluationCriteria?.criteria || evaluationCriteria.general;

    const systemPrompt = `You are a quality evaluator. Evaluate the given text based on these criteria:

${criteria.map((criterion: string) => `- ${criterion}`).join('\n')}

Scoring Guidelines:
${scoringGuidelinesText}

Provide a score between 0 and 1 where:
- 1.0 means excellent quality, exceeds expectations
- 0.5 means adequate quality, partially meets expectations  
- 0.0 means very poor quality, fails to meet expectations`;

    const userPrompt = `Please evaluate the following text:

${input.text}

Provide a score between 0 and 1 with detailed reasoning for your evaluation.`;

    return { systemPrompt, userPrompt };
  }

  /**
   * Core evaluation method using OpenAI library
   */
  async function evaluate(input: EvaluationInput): Promise<LLMJudgeResult> {
    // Self-hosted providers such as Ollama are called without a key, so only
    // the providers that need one are held to it.
    if (apiKey.trim() === '' && isAPIKeyRequiredForProvider(provider)) {
      warn('[LLM_JUDGE] API key not configured for evaluation model');
      return getFallbackResult('no_api_key', undefined, {
        retryCount: 0,
        maxRetries: LLM_JUDGE_MAX_RETRIES,
      });
    }

    let lastError: unknown;
    let retryCount = 0;
    for (let i = 0; i < LLM_JUDGE_MAX_RETRIES; i++) {
      try {
        const prompt = generateEvaluationPrompt(input);
        // Identical requests share a cache entry, and a retry is identical to
        // the attempt whose answer was no good. It has to bypass the cache or
        // it is handed that same answer again; the fresh one takes its place.
        const saConfig = {
          targets: [
            {
              provider: provider,
              model: judgeConfig.model,
              cache: {
                mode: CacheMode.SIMPLE,
              },
              ...(apiKey ? { api_key: apiKey } : {}),
              ...(customHost ? { custom_host: customHost } : {}),
            },
          ],
          agent_name: 'super-agents',
          skill_name: 'judge',
          ...(i > 0 ? { force_refresh: true } : {}),
        };
        const clientWithHeaders = client.withOptions({
          defaultHeaders: {
            'sa-config': JSON.stringify(saConfig),
          },
        });

        const response = await clientWithHeaders.chat.completions.create({
          ...SA_SKILL_REQUEST_PARAMS,
          model: judgeConfig.model,
          // Both were computed into `judgeConfig` and never sent, so an
          // evaluation's configured parameters had no effect on judging.
          temperature: judgeConfig.temperature,
          max_tokens: judgeConfig.max_tokens,
          // Only when set: a model that takes no such parameter is left alone.
          ...(judgeConfig.reasoning_effort
            ? { reasoning_effort: judgeConfig.reasoning_effort }
            : {}),
          messages: [
            { role: 'system', content: prompt.systemPrompt },
            { role: 'user', content: prompt.userPrompt },
          ],
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'evaluation_result',
              strict: true,
              schema: z.toJSONSchema(EvaluationResultSchema),
            },
          },
        });

        const choice = response.choices?.[0];
        if (!choice?.message) {
          throw new Error('No message in the AI provider response');
        }
        const content = choice.message.content;
        if (!content) {
          // Distinct from the parse failure below, and carrying what tells
          // the two apart in a log: a model that burned completion tokens and
          // stopped cleanly did answer, it just answered nowhere we can read.
          // One that stopped on length never got to answer at all.
          throw new JudgeEmptyCompletionError(
            choice.finish_reason ?? null,
            response.usage?.completion_tokens ?? 0,
          );
        }
        // The SDK's `.parse()` throws on anything but strict JSON, and a
        // self-hosted judge answers with a trailing comma often enough that
        // evaluations kept dying on it.
        const parsed = parseJudgeJson(content);
        if (!parsed || typeof parsed !== 'object') {
          // Content that parsed to a non-object -- a bare `null` or number.
          // Unique to this branch now that an empty answer says so itself.
          throw new Error('No parsed response from AI provider');
        }

        return LLMJudgeResult.parse(parsed);
      } catch (err) {
        lastError = err;
        if (i < LLM_JUDGE_MAX_RETRIES - 1 && isRetryableLLMJudgeError(err)) {
          const delay = LLM_JUDGE_RETRY_DELAY_BASE * 2 ** i;
          warn(
            `[LLM_JUDGE] Retrying evaluation (${i + 1}/${LLM_JUDGE_MAX_RETRIES}) after ${delay}ms:`,
            err instanceof Error ? err.message : String(err),
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
          retryCount++;
        } else {
          break;
        }
      }
    }

    // Categorize error type for better fallback messaging
    const retryInfo = {
      retryCount,
      maxRetries: LLM_JUDGE_MAX_RETRIES,
    };

    if (lastError instanceof Error) {
      error('[LLM_JUDGE] Evaluation failed:', {
        errorMessage: lastError.message,
        errorStack: lastError.stack,
        retryCount,
        model: judgeConfig.model,
      });

      if (
        lastError instanceof JudgeEmptyCompletionError &&
        !lastError.retryable
      ) {
        return getFallbackResult(
          'budget_exhausted',
          lastError.message,
          retryInfo,
        );
      }
      if (
        lastError.message.includes('fetch') ||
        lastError.message.includes('network')
      ) {
        return getFallbackResult('network_error', lastError.message, retryInfo);
      }
      if (
        lastError.message.includes('JSON') ||
        lastError.message.includes('parse') ||
        lastError.message.includes('No valid message output') ||
        lastError.message.includes('No valid text content') ||
        lastError.message.includes('empty completion')
      ) {
        return getFallbackResult('parse_error', lastError.message, retryInfo);
      }
      if (
        lastError.message.includes('timeout') ||
        lastError.message.includes('abort')
      ) {
        return getFallbackResult('timeout_error', lastError.message, retryInfo);
      }
      if (
        lastError.message.includes('unknown') ||
        lastError.message.includes('Unknown')
      ) {
        return getFallbackResult('unknown_error', lastError.message, retryInfo);
      }
      return getFallbackResult('api_error', lastError.message, retryInfo);
    }

    error('[LLM_JUDGE] Evaluation failed with unknown error:', {
      error: String(lastError),
      retryCount,
      model: judgeConfig.model,
    });

    return getFallbackResult('unknown_error', String(lastError), retryInfo);
  }

  return {
    evaluate,
    config: judgeConfig,
  };
}

/**
 * Get fallback result with specific error type and optional details
 */
function getFallbackResult(
  errorType:
    | 'no_api_key'
    | 'network_error'
    | 'parse_error'
    | 'budget_exhausted'
    | 'timeout_error'
    | 'api_error'
    | 'unknown_error',
  errorDetails?: string,
  retryInfo?: {
    retryCount: number;
    maxRetries: number;
  },
): LLMJudgeResult {
  const errorMessages = {
    no_api_key: 'Evaluation skipped - OpenAI API key not configured',
    network_error: 'Evaluation failed - network connection error',
    parse_error: 'Evaluation failed - response parsing error',
    budget_exhausted:
      'Evaluation failed - the judge spent its whole token budget before answering',
    timeout_error: 'Evaluation failed - request timeout',
    api_error: 'Evaluation failed - OpenAI API error',
    unknown_error: 'Evaluation failed - unknown error occurred',
  };

  const reasoning =
    retryInfo && retryInfo.retryCount > 0
      ? `${errorMessages[errorType]} (retried ${retryInfo.retryCount}/${retryInfo.maxRetries} times)`
      : errorMessages[errorType];

  return {
    score: 0.5,
    reasoning,
    metadata: {
      fallback: true,
      errorType,
      ...(errorDetails && { errorDetails }),
      ...(retryInfo && retryInfo.retryCount > 0 && { retryInfo }),
    },
  };
}
