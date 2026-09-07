import {
  getApiUrl,
  getInternalApiKey,
  SA_SKILL_REQUEST_PARAMS,
} from '@api/constants';
import type { UserDataStorageConnector } from '@api/types/connector';
import type { AppContext } from '@api/types/hono';
import { resolveSystemSettingsModel } from '@api/utils/evaluation-model-resolver';
import { warn } from '@shared/console-logging';
import { SYSTEM_PROMPT_BUDGET } from '@shared/utils/request-intent';
import OpenAI from 'openai';

/** A little under the budget, so the instruction has room to be overshot. */
const COMPACT_TARGET_CHARS = 3500;

const COMPACTOR_SYSTEM_PROMPT = `You compact system prompts for an AI gateway that routes requests by what they ask for. Rewrite the prompt as a summary of at most ${COMPACT_TARGET_CHARS} characters that preserves what identifies the job: the role, the domain, the main instructions, and any distinctive names or terms. Drop boilerplate, formatting rules and examples. Reply with the summary only.`;

/**
 * Keyed by the prompt itself -- the Map hashes it -- and holding the promise
 * so concurrent requests carrying the same prompt share one model call. A
 * tool sends the same prompt with every request, so a handful of entries
 * cover everything an agent sees. Insertion order is the eviction order; a
 * hit is re-inserted, so the first key is always the least recently used.
 */
const cache = new Map<string, Promise<string>>();
const MAX_ENTRIES = 64;

async function compactOnce(
  c: AppContext,
  connector: UserDataStorageConnector,
  prompt: string,
): Promise<string> {
  const modelConfig = await resolveSystemSettingsModel(
    c,
    'intent_compaction',
    connector,
  );
  if (!modelConfig) {
    throw new Error('No intent compaction model configured');
  }

  const client = new OpenAI({
    apiKey: getInternalApiKey(c),
    baseURL: `${getApiUrl(c)}/v1`,
    // One attempt; the client retries once, so the whole call takes at most
    // twice this.
    timeout: modelConfig.timeoutMs,
    maxRetries: 1,
  });
  const saConfig = {
    targets: [
      {
        provider: modelConfig.provider,
        model: modelConfig.model,
        ...(modelConfig.apiKey ? { api_key: modelConfig.apiKey } : {}),
        ...(modelConfig.customHost
          ? { custom_host: modelConfig.customHost }
          : {}),
      },
    ],
    agent_name: 'super-agents',
    skill_name: 'compact-intent',
  };

  const response = await client
    .withOptions({
      defaultHeaders: { 'sa-config': JSON.stringify(saConfig) },
    })
    .chat.completions.create({
      ...SA_SKILL_REQUEST_PARAMS,
      // Only when the role's setting names one: a model that takes no such
      // parameter is left at its own default.
      ...(modelConfig.reasoningEffort
        ? { reasoning_effort: modelConfig.reasoningEffort }
        : {}),
      model: modelConfig.model,
      // Deterministic, so the summary -- and with it the identity embedding
      // -- stays put across restarts instead of drifting per process.
      temperature: 0,
      messages: [
        { role: 'system', content: COMPACTOR_SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
    });

  const summary = response.choices[0]?.message?.content?.trim();
  if (!summary) {
    throw new Error('The model answered with no summary');
  }
  return summary.slice(0, SYSTEM_PROMPT_BUDGET);
}

/**
 * A system prompt too long to embed verbatim, compacted by a model to what
 * identifies the job -- once per distinct prompt, cached by the prompt
 * itself. Falls back to cutting the prompt at its budget when the model
 * cannot be asked, and does not keep the failure, so the next such request
 * tries again.
 */
export function compactSystemPrompt(
  c: AppContext,
  connector: UserDataStorageConnector,
  prompt: string,
): Promise<string> {
  let pending = cache.get(prompt);
  if (pending) {
    cache.delete(prompt);
    cache.set(prompt, pending);
  } else {
    pending = compactOnce(c, connector, prompt);
    cache.set(prompt, pending);
    const created = pending;
    created.catch(() => {
      if (cache.get(prompt) === created) {
        cache.delete(prompt);
      }
    });
    while (cache.size > MAX_ENTRIES) {
      cache.delete(cache.keys().next().value as string);
    }
  }

  // Every caller gets the fallback, so a shared in-flight failure cannot
  // escape as a rejection from a routing path that did not create it.
  return pending.catch((e) => {
    warn(
      `[SKILL_ROUTING] Could not compact a ${prompt.length}-character system prompt; embedding its head instead:`,
      e instanceof Error ? e.message : e,
    );
    return prompt.slice(0, SYSTEM_PROMPT_BUDGET);
  });
}

/** Forgets every compacted prompt. For tests. */
export function clearCompactedPrompts(): void {
  cache.clear();
}
