import { handleGenerateArms } from '@api/optimization/skill-optimizations';
import {
  describeSkillForRequest,
  uniqueSkillName,
} from '@api/optimization/utils/describe-skill';
import { generateEvaluationCreateParams } from '@api/optimization/utils/evaluations';
import type {
  EvaluationMethodConnector,
  UserDataStorageConnector,
} from '@api/types/connector';
import type { AppContext } from '@api/types/hono';
import {
  agentById,
  resolveEmbeddingModelConfig,
} from '@api/utils/evaluation-model-resolver';
import { getInitialClusterCentroids } from '@api/utils/math';
import { emitSSEEvent } from '@api/utils/sse-event-manager';
import type { RequestIntentEmbedding } from '@api/utils/super-agents/intent-embeddings';
import { judgeLogsWithoutRuns } from '@api/utils/super-agents/judge-backlog';
import { error, info, warn } from '@shared/console-logging';
import type { SuperAgentsRequestData } from '@shared/types/api/request/body';
import type { Agent, Skill } from '@shared/types/data';
import { SkillCreateParams } from '@shared/types/data/skill';
import { SkillEventType } from '@shared/types/data/skill-event';
import type { SkillOptimizationClusterCreateParams } from '@shared/types/data/skill-optimization-cluster';
import type { EvaluationMethodName } from '@shared/types/evaluations';
import { extractSystemPrompt } from '@shared/utils/system-prompt';
import { getRuntimeKey } from 'hono/adapter';

/**
 * The clusters a new skill starts with: equally spaced centroids, one per
 * configuration, the same as the create route gives a skill made by hand.
 * Needs the embedding model in system settings; without one there is nothing
 * to place a request against, and the skill gets its clusters later.
 */
export async function createInitialClusters(
  c: AppContext,
  connector: UserDataStorageConnector,
  skill: Skill,
): Promise<void> {
  const embeddingConfig = await resolveEmbeddingModelConfig(
    c,
    connector,
    await agentById(c, connector, skill.agent_id),
  );
  if (!embeddingConfig) {
    return;
  }

  const clusterParams: SkillOptimizationClusterCreateParams[] =
    getInitialClusterCentroids(
      skill.configuration_count,
      embeddingConfig.dimensions,
    ).map((centroid, index) => ({
      agent_id: skill.agent_id,
      skill_id: skill.id,
      name: `${index + 1}`,
      total_steps: 0,
      observability_total_requests: 0,
      centroid,
      embedding_model_id: embeddingConfig.modelId,
    }));

  await connector.createSkillOptimizationClusters(c, clusterParams);
}

/**
 * Generates the skill's evaluations with every method the server has. Each
 * is a model call, so this runs behind the request that created the skill;
 * the requests answered before it returns are judged once it has.
 */
async function generateEvaluations(
  c: AppContext,
  connector: UserDataStorageConnector,
  agent: Agent,
  skill: Skill,
): Promise<void> {
  const connectorsMap = c.get('evaluation_connectors_map');
  if (!connectorsMap) {
    return;
  }

  const entries = Object.entries(connectorsMap) as [
    EvaluationMethodName,
    EvaluationMethodConnector,
  ][];
  if (entries.length === 0) {
    return;
  }
  const createParams = await Promise.all(
    entries.map(([method, evaluationConnector]) =>
      generateEvaluationCreateParams(
        c,
        skill,
        evaluationConnector,
        method,
        agent.description,
        connector,
      ),
    ),
  );

  const created = await connector.createSkillOptimizationEvaluations(
    c,
    createParams,
  );
  for (const evaluation of created) {
    await connector.createSkillEvent(c, {
      agent_id: agent.id,
      skill_id: skill.id,
      cluster_id: null,
      event_type: SkillEventType.EVALUATION_ADDED,
      metadata: { evaluation_method: evaluation.evaluation_method },
    });
  }

  await judgeLogsWithoutRuns(
    c,
    connector,
    c.get('logs_storage_connector'),
    connectorsMap,
    skill,
    created,
  );
}

/**
 * Creates the skill a request should become, ready enough to serve it.
 *
 * The skill is named and described by a model (or, failing that, from the
 * request itself), takes the agent's default models, and keeps the caller's
 * system prompt as `seed_system_prompt`: `handleGenerateArms` uses that
 * verbatim, so on day one the skill is a pass-through and optimization works
 * from there. The routing centroid starts as the request's own intent
 * embedding rather than the description, since that is what the next such
 * request will look like.
 */
export async function createSkillForRequest(
  c: AppContext,
  connector: UserDataStorageConnector,
  agent: Agent,
  saRequestData: SuperAgentsRequestData,
  intent: string,
  intentEmbedding: RequestIntentEmbedding | null,
  existingSkills: Skill[],
): Promise<Skill> {
  const takenNames = existingSkills.map((skill) => skill.name);
  const naming = await describeSkillForRequest(
    c,
    connector,
    agent,
    intent,
    takenNames,
  );
  const name = uniqueSkillName(naming.name, takenNames);
  const seedSystemPrompt = extractSystemPrompt(saRequestData);

  let skill: Skill;
  try {
    skill = await connector.createSkill(
      c,
      SkillCreateParams.parse({
        agent_id: agent.id,
        name,
        description: naming.description,
        metadata: {},
        optimize: true,
        auto_created: true,
        seed_system_prompt: seedSystemPrompt,
      }),
    );
  } catch (e) {
    // Two first requests can race to the same name; the loser takes the
    // winner's skill rather than failing.
    const existing = await connector.getSkills(c, {
      agent_id: agent.id,
      name,
    });
    if (existing.length > 0) {
      return existing[0];
    }
    throw e;
  }
  info(
    `[SKILL_CREATION] Created skill ${skill.name} (${skill.id}) for agent ${agent.name}`,
  );

  await createInitialClusters(c, connector, skill);

  const primaryIntent =
    intentEmbedding?.identity ?? intentEmbedding?.conversation ?? null;
  if (intentEmbedding && primaryIntent) {
    await connector.upsertSkillRouting(c, {
      skill_id: skill.id,
      agent_id: agent.id,
      centroid: primaryIntent.embedding,
      conversation_centroid: intentEmbedding.conversation?.embedding ?? null,
      embedding_model_id: intentEmbedding.modelId,
      sample_count: 1,
      conversation_sample_count: intentEmbedding.conversation ? 1 : 0,
    });
  }

  const models = await connector.getAgentModels(c, agent.id);
  if (models.length > 0) {
    await connector.addModelsToSkill(
      c,
      skill.id,
      models.map((model) => model.id),
    );
    // With a seed prompt this makes no model call: every arm starts as the
    // caller's own prompt.
    await handleGenerateArms(c, connector, skill.id);
  } else {
    warn(
      `[SKILL_CREATION] Agent ${agent.name} has no default models, so skill ${skill.name} cannot serve optimized requests until one is attached`,
    );
  }

  await connector.createSkillEvent(c, {
    agent_id: agent.id,
    skill_id: skill.id,
    cluster_id: null,
    event_type: SkillEventType.AUTO_CREATED,
    metadata: { intent: intent.slice(0, 500), model_count: models.length },
  });
  emitSSEEvent('skill:created', { skillId: skill.id, agentId: agent.id });

  const evaluations = generateEvaluations(c, connector, agent, skill).catch(
    (e) => {
      error(
        `[SKILL_CREATION] Could not generate evaluations for skill ${skill.name}:`,
        e,
      );
    },
  );
  if (getRuntimeKey() === 'workerd') {
    c.executionCtx.waitUntil(evaluations);
  }

  return skill;
}

/**
 * Gives the agent's new default models to the skills the gateway created
 * for it while it had none.
 *
 * A skill created for an agent without default models starts with no models
 * and no arms, and answers 422 until it gets some. The defaults arriving
 * later is the fix the user reaches for, so they are applied to those skills
 * the way they would have been at creation -- arms included, which with a
 * seed prompt costs no model call, and the evaluations the skill is missing,
 * generated in the background as creation does. Skills made by hand, and
 * skills that already have models, are left as they are. Answers the skills
 * equipped.
 */
export async function adoptDefaultModels(
  c: AppContext,
  connector: UserDataStorageConnector,
  agent: Agent,
  modelIds: string[],
): Promise<Skill[]> {
  if (modelIds.length === 0) {
    return [];
  }
  const skills = await connector.getSkills(c, { agent_id: agent.id });
  const equipped: Skill[] = [];

  for (const skill of skills.filter((skill) => skill.auto_created)) {
    const models = await connector.getSkillModels(c, skill.id);
    if (models.length > 0) {
      continue;
    }

    await connector.addModelsToSkill(c, skill.id, modelIds);
    for (const modelId of modelIds) {
      const [model] = await connector.getModels(c, { id: modelId });
      if (model) {
        await connector.createSkillEvent(c, {
          agent_id: agent.id,
          skill_id: skill.id,
          cluster_id: null,
          event_type: SkillEventType.MODEL_ADDED,
          metadata: { model_id: model.id, model_name: model.model_name },
        });
      }
    }
    // A skill created before system settings had an embedding model also
    // has no clusters, and arms are generated per cluster -- without them
    // handleGenerateArms makes none. Give it the clusters creation would
    // have given it.
    const clusters = await connector.getSkillOptimizationClusters(c, {
      skill_id: skill.id,
    });
    if (clusters.length === 0) {
      await createInitialClusters(c, connector, skill);
    }

    await handleGenerateArms(c, connector, skill.id);

    // Creation generates evaluations in the background, and that can fail --
    // most often because system settings had no models yet -- with nothing
    // retrying it. This is the moment the user is repairing the skill, so
    // missing evaluations are generated again the same way.
    if (skill.optimize) {
      const evaluations = await connector.getSkillOptimizationEvaluations(c, {
        skill_id: skill.id,
      });
      if (evaluations.length === 0) {
        const generated = generateEvaluations(c, connector, agent, skill).catch(
          (e) => {
            error(
              `[SKILL_CREATION] Could not generate evaluations for skill ${skill.name}:`,
              e,
            );
          },
        );
        if (getRuntimeKey() === 'workerd') {
          c.executionCtx.waitUntil(generated);
        }
      }
    }

    info(
      `[SKILL_CREATION] Gave agent ${agent.name}'s default models to skill ${skill.name}`,
    );
    equipped.push(skill);
  }

  return equipped;
}
