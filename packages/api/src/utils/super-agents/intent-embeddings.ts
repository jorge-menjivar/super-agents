import type { UserDataStorageConnector } from '@api/types/connector';
import type { AppContext } from '@api/types/hono';
import { embedText, RequestEmbeddingError } from '@api/utils/embeddings';
import { compactSystemPrompt } from '@api/utils/super-agents/intent-compaction';
import type { Agent } from '@shared/types/data/agent';
import {
  identityText,
  type RequestIntent,
  SYSTEM_PROMPT_BUDGET,
} from '@shared/utils/request-intent';

/** An embedding of a request's intent, with the model that produced it. */
export interface IntentEmbedding {
  embedding: number[];
  modelId: string;
}

/** An intent embedding the router holds on to. */
export interface CachedIntent extends IntentEmbedding {
  /**
   * The skills whose centroid has absorbed this intent. A tool sends the same
   * prompt with every request; a skill takes it in once and skips the write
   * after that.
   */
  absorbedBy: Set<string>;
}

/**
 * Enough for every tool an agent is likely to see at once. An intent is at
 * most a few kilobytes of text and one vector, so this stays small.
 */
const MAX_ENTRIES = 256;

/**
 * Keyed by model and intent text; holds the promise rather than the value so
 * concurrent requests carrying the same intent share one embedding call. The
 * Map's insertion order is the eviction order: a hit is re-inserted, so the
 * first key is always the least recently used.
 */
const cache = new Map<string, Promise<CachedIntent>>();

const keyOf = (modelId: string, intent: string): string =>
  `${modelId}\n${intent}`;

/**
 * Embeds a request's intent with the given model, once per process.
 *
 * Routing needs the intent of every request that names only the agent, and
 * learning from named traffic needs it too; without this each would be a
 * model call per request. Tools send the same system prompt and tools with
 * every request, so a handful of entries cover almost everything an agent
 * sees, and the cost falls to one embedding per distinct intent.
 *
 * Per process and best effort: an entry lost to eviction or a restart is
 * simply embedded again. Rejections are not kept, so a provider outage is
 * retried by the next request.
 */
export function embedIntent(
  c: AppContext,
  connector: UserDataStorageConnector,
  intent: string,
  modelId: string,
): Promise<CachedIntent> {
  const key = keyOf(modelId, intent);
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }

  const pending = embedText(c, connector, intent).then(
    ({ embedding, modelId: usedModelId }): CachedIntent => {
      if (usedModelId !== modelId) {
        // Settings changed under the request; its centroids are for another
        // model, so the comparison would be meaningless.
        throw new RequestEmbeddingError(
          `The embedding model changed while routing (${modelId} -> ${usedModelId})`,
        );
      }
      return { embedding, modelId, absorbedBy: new Set() };
    },
  );
  cache.set(key, pending);
  pending.catch(() => {
    if (cache.get(key) === pending) {
      cache.delete(key);
    }
  });
  while (cache.size > MAX_ENTRIES) {
    cache.delete(cache.keys().next().value as string);
  }
  return pending;
}

/** A request intent embedded part by part: who is calling, and what the
 * conversation is asking right now. Either can be missing. */
export interface RequestIntentEmbedding {
  identity: CachedIntent | null;
  conversation: CachedIntent | null;
  modelId: string;
}

/**
 * Embeds a request's two-part intent with the given model.
 *
 * The identity half repeats verbatim across a tool's requests, so its
 * embedding is nearly always a cache hit; the conversation half changes
 * turn by turn and usually costs one embedding call. A system prompt too
 * long to embed whole is compacted by a model first (cached by the prompt,
 * so this too happens once per distinct prompt).
 */
export async function embedRequestIntent(
  c: AppContext,
  connector: UserDataStorageConnector,
  agent: Agent,
  intent: RequestIntent,
  modelId: string,
): Promise<RequestIntentEmbedding> {
  const compacted =
    intent.systemPrompt && intent.systemPrompt.length > SYSTEM_PROMPT_BUDGET
      ? await compactSystemPrompt(c, connector, agent, intent.systemPrompt)
      : null;
  const identity = identityText(intent, compacted);

  const [identityEmbedding, conversationEmbedding] = await Promise.all([
    identity ? embedIntent(c, connector, identity, modelId) : null,
    intent.conversation
      ? embedIntent(c, connector, intent.conversation, modelId)
      : null,
  ]);
  return {
    identity: identityEmbedding,
    conversation: conversationEmbedding,
    modelId,
  };
}

/** How many intents are held. For tests. */
export function intentEmbeddingCount(): number {
  return cache.size;
}

/** Forgets every intent. For tests. */
export function clearIntentEmbeddings(): void {
  cache.clear();
}
