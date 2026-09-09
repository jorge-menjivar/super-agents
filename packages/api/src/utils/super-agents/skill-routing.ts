import type { UserDataStorageConnector } from '@api/types/connector';
import type { AppContext } from '@api/types/hono';
import { RequestEmbeddingError } from '@api/utils/embeddings';
import { resolveEmbeddingModelConfig } from '@api/utils/evaluation-model-resolver';
import { cosineSimilarity } from '@api/utils/math';
import {
  embedIntent,
  embedRequestIntent,
  type RequestIntentEmbedding,
} from '@api/utils/super-agents/intent-embeddings';
import {
  arbitrateSkillForRequest,
  skillArbiterTimeoutMs,
} from '@api/utils/super-agents/skill-arbiter';
import { createSkillForRequest } from '@api/utils/super-agents/skill-creation';
import {
  SKILL_CREATION_LEASE_MS,
  withSkillCreationLease,
} from '@api/utils/super-agents/skill-creation-lease';
import { warn } from '@shared/console-logging';
import type { SuperAgentsRequestData } from '@shared/types/api/request/body';
import type {
  Agent,
  Skill,
  SkillRouting,
  SkillRoutingDecision,
  SkillRoutingMethod,
} from '@shared/types/data';
import {
  describeRequestIntent,
  intentText,
  type RequestIntent,
} from '@shared/utils/request-intent';

/**
 * Past this many samples the mean moves at a fixed rate instead of settling,
 * so a skill keeps following the traffic it actually gets.
 */
const MAX_CENTROID_SAMPLES = 100;

/**
 * How the two halves of an intent weigh against each other. Identity -- the
 * system prompt and tools -- is the surer signal of which skill a request
 * belongs to; the conversation half lets a request that asks for genuinely
 * different work fall below the threshold even through a familiar tool.
 * Calibrated on real traffic: at 0.6/0.4 a new kind of ask lands just below
 * a 0.8 threshold while ordinary requests stay comfortably above it. When a
 * request or a skill is missing one half, the weights renormalise over what
 * is there.
 */
const IDENTITY_WEIGHT = 0.6;
const CONVERSATION_WEIGHT = 0.4;

/**
 * How far a skill's identity similarity has to stand above the next skill's
 * for identity to have chosen between them.
 */
const IDENTITY_SEPARATION = 0.05;

/**
 * How far above the threshold a decision has to land before the skill it
 * chose learns from it.
 */
const LEARNING_MARGIN = 0.05;

/** What a request with no system prompt, tools or message is filed under. */
const DEFAULT_INTENT = 'General requests that carry no instructions or tools';

/**
 * A skill learns from the requests that name it at most this often, so a
 * tool that rewrites its prompt on every request costs one embedding a
 * minute rather than one per request. An intent already embedded is free,
 * but the check that says so is not.
 */
const LEARN_INTERVAL_MS = 60_000;
const MAX_LEARNING_SKILLS = 1000;

export type { SkillRoutingDecision, SkillRoutingMethod };

export interface SkillRoutingResult {
  skill: Skill;
  decision: SkillRoutingDecision;
}

/** A request that cannot be routed; `status` is what the caller should get. */
export class SkillRoutingError extends Error {
  constructor(
    message: string,
    public readonly status: 404 | 422,
  ) {
    super(message);
    this.name = 'SkillRoutingError';
  }
}

/** What a skill says it is for: the one text that is its own. */
export function describeText(skill: Skill): string {
  return `${skill.name}: ${skill.description}`;
}

/**
 * What a skill's identity centroid starts from, before it has served a
 * request: the prompt the gateway created it from, when there is one -- that
 * is what the next request like it will carry -- and otherwise its
 * description.
 *
 * Every skill one caller creates is seeded from that caller's prompt, so
 * these centroids are alike by construction. That is identity doing its job:
 * it marks the skills as this caller's. Telling them apart is the
 * conversation centroid's, which is why that one is seeded from the
 * description instead.
 */
export function seedText(skill: Skill): string {
  return skill.seed_system_prompt || describeText(skill);
}

/** The running mean after one more sample, capped as described above. */
export function advanceCentroid(
  centroid: number[],
  sample: number[],
  sampleCount: number,
): number[] {
  const n = Math.min(sampleCount, MAX_CENTROID_SAMPLES);
  return centroid.map((value, i) => value + (sample[i] - value) / (n + 1));
}

function mostUsed(skills: Skill[]): Skill {
  return skills.reduce((best, skill) =>
    skill.total_requests > best.total_requests ? skill : best,
  );
}

/** How well an intent matches one skill's centroids. */
interface SkillScore {
  /** The weighted mean of the available halves. */
  score: number;
  identity: number | null;
  conversation: number | null;
}

/**
 * Scores an intent against a skill's centroids: the identity half against
 * the main centroid, the conversation half against the conversation
 * centroid, weights renormalised over the halves both sides have. A skill
 * that has not met a conversation yet is scored on identity alone; a request
 * with no identity compares its conversation against the main centroid, which
 * is what such requests' intents were absorbed into.
 */
export function scoreIntent(
  intent: RequestIntentEmbedding,
  routing: SkillRouting,
): SkillScore | null {
  let weight = 0;
  let sum = 0;
  let identity: number | null = null;
  let conversation: number | null = null;

  if (intent.identity) {
    identity = cosineSimilarity(intent.identity.embedding, routing.centroid);
    sum += IDENTITY_WEIGHT * identity;
    weight += IDENTITY_WEIGHT;
  }
  if (intent.conversation) {
    const centroid =
      routing.conversation_centroid ??
      (intent.identity ? null : routing.centroid);
    if (centroid) {
      conversation = cosineSimilarity(intent.conversation.embedding, centroid);
      sum += CONVERSATION_WEIGHT * conversation;
      weight += CONVERSATION_WEIGHT;
    }
  }
  if (weight === 0) {
    return null;
  }
  return { score: sum / weight, identity, conversation };
}

/**
 * Scores an intent against a whole field of skills at once, so that identity
 * counts for what it can actually tell apart.
 *
 * A skill's identity centroid says which caller a skill belongs to, and an
 * agent fed by one tool sends the same system prompt with every request: the
 * skills of that caller then score alike on identity, whatever the request
 * asks for. Weighted at 0.6 that similarity is a floor under every score --
 * measured on real traffic, an identity pinned at 0.97 holds a request above
 * a 0.8 threshold unless its conversation falls under 0.54, which is to say
 * never. The arbiter, whose whole job is to catch work no skill fits, is
 * then unreachable, and the skill with the broadest centroid keeps every
 * request it wins.
 *
 * So identity narrows the field and the conversation chooses within it: the
 * skills within `IDENTITY_SEPARATION` of the best identity are the ones it
 * could not separate, and among those the score is the conversation alone.
 * Skills it did separate keep the blend, which is how a second caller's
 * skills stay marked down. When identity singles one skill out, it has
 * chosen, and the blend stands for everyone.
 *
 * Returns one score per routing, in order, null where there is nothing to
 * compare.
 */
export function scoreIntentAcrossSkills(
  intent: RequestIntentEmbedding,
  routings: (SkillRouting | undefined)[],
): (SkillScore | null)[] {
  const scores = routings.map((routing) =>
    routing ? scoreIntent(intent, routing) : null,
  );

  const identities = scores
    .map((score) => score?.identity ?? null)
    .filter((identity): identity is number => identity !== null);
  if (identities.length === 0) {
    return scores;
  }

  const floor = Math.max(...identities) - IDENTITY_SEPARATION;
  if (identities.filter((identity) => identity >= floor).length < 2) {
    return scores;
  }

  return scores.map((score) =>
    score !== null &&
    score.identity !== null &&
    score.conversation !== null &&
    score.identity >= floor
      ? { ...score, score: score.conversation }
      : score,
  );
}

/** The absorb-once key for a conversation embedding, per skill. */
const conversationKey = (skillId: string): string => `conversation:${skillId}`;

/**
 * Moves a skill's centroids towards an intent -- or starts them from the
 * intent, when the skill has no routing row under this model -- once per
 * part: a tool sends the same identity with every request, and taking it in
 * again would move nothing, while conversations are new almost every time.
 * Not worth failing a request over; the next one recomputes from whatever
 * is stored.
 */
export async function absorbIntent(
  c: AppContext,
  connector: UserDataStorageConnector,
  agentId: string,
  skillId: string,
  routing: SkillRouting | undefined,
  intent: RequestIntentEmbedding,
): Promise<void> {
  const { conversation } = intent;
  // A request with no identity files its conversation under the main
  // centroid too; that is also what it is compared against.
  const primary = intent.identity ?? conversation;
  if (!primary) {
    return;
  }

  const advancePrimary = !routing || !primary.absorbedBy.has(skillId);
  const advanceConversation =
    conversation !== null &&
    (!routing || !conversation.absorbedBy.has(conversationKey(skillId)));
  if (!advancePrimary && !advanceConversation) {
    return;
  }

  try {
    const centroid = !routing
      ? primary.embedding
      : advancePrimary
        ? advanceCentroid(
            routing.centroid,
            primary.embedding,
            routing.sample_count,
          )
        : routing.centroid;
    const sampleCount = !routing
      ? 1
      : advancePrimary
        ? routing.sample_count + 1
        : routing.sample_count;

    const stored = routing?.conversation_centroid ?? null;
    const conversationCentroid =
      !advanceConversation || conversation === null
        ? stored
        : stored
          ? advanceCentroid(
              stored,
              conversation.embedding,
              routing?.conversation_sample_count ?? 0,
            )
          : conversation.embedding;
    const conversationSampleCount = !advanceConversation
      ? (routing?.conversation_sample_count ?? 0)
      : stored
        ? (routing?.conversation_sample_count ?? 0) + 1
        : 1;

    await connector.upsertSkillRouting(c, {
      skill_id: skillId,
      agent_id: agentId,
      centroid,
      conversation_centroid: conversationCentroid,
      embedding_model_id: intent.modelId,
      sample_count: sampleCount,
      conversation_sample_count: conversationSampleCount,
    });
    if (advancePrimary) {
      primary.absorbedBy.add(skillId);
    }
    if (advanceConversation && conversation !== null) {
      conversation.absorbedBy.add(conversationKey(skillId));
    }
  } catch (e) {
    warn(
      `[SKILL_ROUTING] Could not update the centroids of skill ${skillId}:`,
      e,
    );
  }
}

/** Embeds an intent, or answers null when the embedding path is down. */
async function tryEmbedIntent(
  c: AppContext,
  connector: UserDataStorageConnector,
  agent: Agent,
  intent: RequestIntent,
): Promise<RequestIntentEmbedding | null> {
  try {
    const embeddingConfig = await resolveEmbeddingModelConfig(
      c,
      connector,
      agent,
    );
    if (!embeddingConfig) {
      return null;
    }
    return await embedRequestIntent(
      c,
      connector,
      agent,
      intent,
      embeddingConfig.modelId,
    );
  } catch (e) {
    if (e instanceof RequestEmbeddingError) {
      warn(`[SKILL_ROUTING] Could not embed the request: ${e.message}`);
      return null;
    }
    throw e;
  }
}

type RoutingPass =
  | { kind: 'routed'; result: SkillRoutingResult }
  /** No skill fits: what a new one would be made from, if one may be. */
  | CreatePass;

interface CreatePass {
  kind: 'create';
  skills: Skill[];
  intent: RequestIntentEmbedding | null;
  similarity: number | null;
  identitySimilarity: number | null;
  conversationSimilarity: number | null;
  /** The closest skill anyway, for routing conservatively. */
  best: Skill | null;
  /** False at the agent's cap: the arbiter may still speak, but only to
   * name a skill that already exists. */
  canCreate: boolean;
}

/**
 * One look at the agent's skills: either the skill for the request, or the
 * finding that none fits and a skill should be created.
 */
async function routeOnce(
  c: AppContext,
  connector: UserDataStorageConnector,
  agent: Agent,
  requestIntent: RequestIntent | null,
): Promise<RoutingPass> {
  const skills = await connector.getSkills(c, { agent_id: agent.id });
  const autoCreate = agent.auto_create_skills;
  const underCap =
    skills.filter((skill) => skill.auto_created).length <
    agent.max_auto_created_skills;

  const decide = (
    method: SkillRoutingMethod,
    score: SkillScore | null = null,
    threshold: number | null = null,
  ): SkillRoutingDecision => ({
    method,
    similarity: score?.score ?? null,
    threshold,
    candidates: skills.length,
    identity_similarity: score?.identity ?? null,
    conversation_similarity: score?.conversation ?? null,
  });
  const routed = (
    skill: Skill,
    decision: SkillRoutingDecision,
  ): RoutingPass => ({
    kind: 'routed',
    result: { skill, decision },
  });
  const onlySkill = (): RoutingPass => routed(skills[0], decide('only_skill'));
  const fallback = (): RoutingPass =>
    skills.length === 1
      ? onlySkill()
      : routed(mostUsed(skills), decide('most_used'));
  const create = (
    intent: RequestIntentEmbedding | null,
    score: SkillScore | null,
    best: Skill | null,
    canCreate = true,
  ): RoutingPass => ({
    kind: 'create',
    skills,
    intent,
    similarity: score?.score ?? null,
    identitySimilarity: score?.identity ?? null,
    conversationSimilarity: score?.conversation ?? null,
    best,
    canCreate,
  });

  if (skills.length === 0) {
    if (!autoCreate || !underCap) {
      throw new SkillRoutingError(
        `Agent ${agent.name} has no skills to route to. Create one, or name it in the path: /v1/agents/${agent.name}/skills/{skill_name}/...`,
        404,
      );
    }
    // Nothing to compare against: the first request gets the first skill.
    return create(
      requestIntent
        ? await tryEmbedIntent(c, connector, agent, requestIntent)
        : null,
      null,
      null,
    );
  }

  if (skills.length === 1 && !autoCreate) {
    return onlySkill();
  }
  if (!requestIntent) {
    return fallback();
  }

  const embeddingConfig = await resolveEmbeddingModelConfig(
    c,
    connector,
    agent,
  );
  if (!embeddingConfig) {
    if (skills.length === 1) {
      return onlySkill();
    }
    throw new SkillRoutingError(
      `Routing between the ${skills.length} skills of agent ${agent.name} needs an embedding model in system settings. Configure one, or name the skill in the path: /v1/agents/${agent.name}/skills/{skill_name}/...`,
      422,
    );
  }

  try {
    const routings = await connector.getSkillRoutings(c, {
      agent_id: agent.id,
    });
    const bySkill = new Map<string, SkillRouting>(
      routings
        .filter((r) => r.embedding_model_id === embeddingConfig.modelId)
        .map((r) => [r.skill_id, r]),
    );

    // Skills the router has not met yet start from their descriptions.
    await Promise.all(
      skills
        .filter((skill) => !bySkill.has(skill.id))
        .map(async (skill) => {
          // Both halves from the start: a skill whose conversation centroid
          // is null is scored on identity alone, and identity is what the
          // skills of one caller share.
          const [seed, described] = await Promise.all([
            embedIntent(
              c,
              connector,
              seedText(skill),
              embeddingConfig.modelId,
              agent,
            ),
            embedIntent(
              c,
              connector,
              describeText(skill),
              embeddingConfig.modelId,
              agent,
            ),
          ]);
          const routing = await connector.upsertSkillRouting(c, {
            skill_id: skill.id,
            agent_id: agent.id,
            centroid: seed.embedding,
            conversation_centroid: described.embedding,
            embedding_model_id: embeddingConfig.modelId,
            sample_count: 1,
            conversation_sample_count: 1,
          });
          bySkill.set(skill.id, routing);
        }),
    );

    const intent = await embedRequestIntent(
      c,
      connector,
      agent,
      requestIntent,
      embeddingConfig.modelId,
    );

    const inOrder = skills.map((skill) => bySkill.get(skill.id));
    const scores = scoreIntentAcrossSkills(intent, inOrder);

    let best: {
      skill: Skill;
      routing: SkillRouting;
      score: SkillScore;
    } | null = null;
    skills.forEach((skill, i) => {
      const routing = inOrder[i];
      const score = scores[i];
      if (!routing || !score) {
        return;
      }
      if (!best || score.score > best.score.score) {
        best = { skill, routing, score };
      }
    });
    if (!best) {
      throw new RequestEmbeddingError('No skill has a routing centroid');
    }
    const chosen: {
      skill: Skill;
      routing: SkillRouting;
      score: SkillScore;
    } = best;

    if (autoCreate && chosen.score.score < agent.skill_match_threshold) {
      // Asked even at the cap. The arbiter cannot make a skill there, but its
      // existing-skill verdict is the one way a request the centroids misfile
      // reaches the skill it belongs to, and the cap is on how many skills an
      // agent has rather than on whether its router may be corrected.
      return create(intent, chosen.score, chosen.skill, underCap);
    }

    // Learn from the decision, so skills follow their traffic -- but only
    // from decisions that were not close calls. A skill that takes in every
    // request it barely won broadens until it is the nearest centroid to
    // everything the agent is sent, and the agent collapses onto it; the
    // narrow skills it swallowed never get another chance, because only the
    // winner ever learns. Requests that name their skill teach it whatever
    // its traffic is (`learnSkillIntent`), and so does an arbitrated verdict,
    // so nothing here is the only way a skill can follow its work.
    if (chosen.score.score >= agent.skill_match_threshold + LEARNING_MARGIN) {
      await absorbIntent(
        c,
        connector,
        agent.id,
        chosen.skill.id,
        chosen.routing,
        intent,
      );
    }

    return routed(
      chosen.skill,
      decide(
        'embedding',
        chosen.score,
        autoCreate ? agent.skill_match_threshold : null,
      ),
    );
  } catch (e) {
    if (e instanceof RequestEmbeddingError) {
      warn(
        `[SKILL_ROUTING] Could not embed the request for agent ${agent.name}; using its most used skill: ${e.message}`,
      );
      return fallback();
    }
    throw e;
  }
}

/**
 * Picks the skill for a request that named only the agent.
 *
 * The request's intent -- who is calling (system prompt and tools) and what
 * the conversation is asking right now (its last few messages), see
 * `describeRequestIntent` -- is embedded part by part and compared with each
 * skill's centroids; a skill the router has not met yet is seeded from its
 * description first. The winner's centroids then absorb the request, so
 * skills follow their traffic as it evolves, turn by turn.
 *
 * When the agent creates skills automatically, a request that resembles none
 * of them -- combined score below the agent's threshold -- goes to the
 * arbiter: measured on real traffic, embeddings cannot tell a new kind of
 * job from familiar work on unfamiliar material, so a model makes that call
 * (`arbitrateSkillForRequest`). An existing-skill verdict routes there and
 * teaches the centroids; a new-job verdict creates a skill, up to the
 * agent's cap; no verdict routes to the closest skill and creates nothing.
 * An agent without skills gets its first one from its first request without
 * asking. Creating happens under the agent's lease, after a second look at
 * its skills: concurrent first requests would otherwise each create one, and
 * the request that held the lease before may have created exactly the skill
 * this one needs. With creation off, one skill needs no deciding and an
 * agent without skills is refused.
 *
 * When the intent cannot be embedded -- no text, or the embedding provider
 * failing -- the most used skill serves the request rather than failing it,
 * and the decision says so.
 */
export async function routeRequestToSkill(
  c: AppContext,
  connector: UserDataStorageConnector,
  agent: Agent,
  saRequestData: SuperAgentsRequestData,
): Promise<SkillRoutingResult> {
  const requestIntent = describeRequestIntent(saRequestData);
  const first = await routeOnce(c, connector, agent, requestIntent);
  if (first.kind === 'routed') {
    return first.result;
  }

  const settings = await connector.getSystemSettings(c);

  const settle = async (pass: CreatePass): Promise<SkillRoutingResult> => {
    const decision = (method: SkillRoutingMethod): SkillRoutingDecision => ({
      method,
      similarity: pass.similarity,
      threshold: agent.skill_match_threshold,
      candidates: pass.skills.length,
      identity_similarity: pass.identitySimilarity,
      conversation_similarity: pass.conversationSimilarity,
    });

    // An agent with skills gets the arbiter's judgment before a new one is
    // made; an agent without any gets its first skill straight away.
    if (pass.skills.length > 0 && requestIntent) {
      const verdict = await arbitrateSkillForRequest(
        c,
        connector,
        agent,
        pass.skills,
        requestIntent,
        settings,
      );
      if (verdict.kind === 'existing') {
        // Teach the router, so the next such request needs no arbiter. A
        // verdict is worth learning from where a close call is not: a model
        // read the request and named the skill.
        if (pass.intent) {
          const [routing] = await connector.getSkillRoutings(c, {
            skill_id: verdict.skill.id,
          });
          await absorbIntent(
            c,
            connector,
            agent.id,
            verdict.skill.id,
            routing?.embedding_model_id === pass.intent.modelId
              ? routing
              : undefined,
            pass.intent,
          );
        }
        return { skill: verdict.skill, decision: decision('arbitrated') };
      }
      if (verdict.kind === 'unavailable') {
        // The conservative side: the closest skill, and nothing created.
        return {
          skill: pass.best ?? mostUsed(pass.skills),
          decision: decision('embedding'),
        };
      }
      if (!pass.canCreate) {
        // New work, and nowhere to put it: the agent is at its cap. The
        // closest skill serves it, as it did before the arbiter was asked.
        warn(
          `[SKILL_ROUTING] Agent ${agent.name} is at its cap of ${agent.max_auto_created_skills} auto-created skills; routing to ${(pass.best ?? mostUsed(pass.skills)).name}`,
        );
        return {
          skill: pass.best ?? mostUsed(pass.skills),
          decision: decision('embedding'),
        };
      }
    }

    return {
      skill: await createSkillForRequest(
        c,
        connector,
        agent,
        saRequestData,
        requestIntent ? intentText(requestIntent) : DEFAULT_INTENT,
        pass.intent,
        pass.skills,
      ),
      decision: decision('created'),
    };
  };

  // At the cap nothing is created, so there is nothing to serialise and no
  // reason to make concurrent requests queue behind one arbiter call.
  if (!first.canCreate) {
    return settle(first);
  }

  // The arbiter is asked under the lease, so the lease has to outlast its
  // budget -- one attempt and the client's one retry -- on top of creation.
  const leaseMs =
    SKILL_CREATION_LEASE_MS + 2 * skillArbiterTimeoutMs(agent, settings);

  const underLease = async (): Promise<SkillRoutingResult> => {
    const again = await routeOnce(c, connector, agent, requestIntent);
    if (again.kind === 'routed') {
      return again.result;
    }
    return settle(again);
  };

  return withSkillCreationLease(c, connector, agent, underLease, leaseMs);
}

/** When each skill last learned from a request that named it. */
const lastLearnedAt = new Map<string, number>();

/**
 * Teaches the router from a request that named its skill.
 *
 * That is the surest sign of what a skill is for -- surer than the router's
 * own decisions, which only ever confirm themselves -- and it is how an agent
 * whose skills have always been named gets centroids that reflect their
 * traffic rather than their descriptions, ready for the day a request names
 * only the agent.
 *
 * Meant to run once the response is on its way. An intent the skill has
 * already taken in costs nothing; a new one costs its embeddings, at most
 * once per `LEARN_INTERVAL_MS` per skill. Nothing here can fail the request.
 */
export async function learnSkillIntent(
  c: AppContext,
  connector: UserDataStorageConnector,
  agent: Agent,
  skill: Skill,
  saRequestData: SuperAgentsRequestData,
): Promise<void> {
  const requestIntent = describeRequestIntent(saRequestData);
  if (!requestIntent) {
    return;
  }

  const now = Date.now();
  const last = lastLearnedAt.get(skill.id);
  if (last !== undefined && now - last < LEARN_INTERVAL_MS) {
    return;
  }
  lastLearnedAt.delete(skill.id);
  lastLearnedAt.set(skill.id, now);
  while (lastLearnedAt.size > MAX_LEARNING_SKILLS) {
    lastLearnedAt.delete(lastLearnedAt.keys().next().value as string);
  }

  try {
    // Checked here first so a deployment without an embedding model is not
    // warned about it on every attempt.
    const settings = await connector.getSystemSettings(c);
    if (!settings.embedding_model_id) {
      return;
    }
    const embeddingConfig = await resolveEmbeddingModelConfig(
      c,
      connector,
      agent,
    );
    if (!embeddingConfig) {
      return;
    }

    const intent = await embedRequestIntent(
      c,
      connector,
      agent,
      requestIntent,
      embeddingConfig.modelId,
    );
    const primary = intent.identity ?? intent.conversation;
    if (
      primary?.absorbedBy.has(skill.id) &&
      (!intent.conversation ||
        intent.conversation.absorbedBy.has(conversationKey(skill.id)))
    ) {
      return;
    }
    const [routing] = await connector.getSkillRoutings(c, {
      skill_id: skill.id,
    });
    await absorbIntent(
      c,
      connector,
      agent.id,
      skill.id,
      routing?.embedding_model_id === embeddingConfig.modelId
        ? routing
        : undefined,
      intent,
    );
  } catch (e) {
    if (e instanceof RequestEmbeddingError) {
      warn(
        `[SKILL_ROUTING] Could not learn from a request to skill ${skill.name}: ${e.message}`,
      );
      return;
    }
    throw e;
  }
}

/** Forgets when skills last learned. For tests. */
export function resetSkillLearning(): void {
  lastLearnedAt.clear();
}
