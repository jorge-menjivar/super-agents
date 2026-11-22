import { generateExampleConversations } from '@api/middlewares/optimizer/system-prompt';
import { BaseArmsParams } from '@api/optimization/base-arms';
import {
  applyRegeneratedEvaluations,
  regenerateEvaluationsWithExamples,
} from '@api/optimization/utils/evaluations';
import {
  generateSeedSystemPromptForSkill,
  generateSeedSystemPromptWithContext,
} from '@api/optimization/utils/system-prompt';
import type {
  EvaluationMethodConnector,
  LogsStorageConnector,
  UserDataStorageConnector,
} from '@api/types/connector';
import type { AppContext } from '@api/types/hono';
import { warn } from '@shared/console-logging';
import { isCompletedLog } from '@shared/types/data/log';
import type { Skill } from '@shared/types/data/skill';
import type {
  SkillOptimizationArmCreateParams,
  SkillOptimizationArmParams,
} from '@shared/types/data/skill-optimization-arm';
import type { EvaluationMethodName } from '@shared/types/evaluations';

/**
 * The prompt a skill's arms start from. A skill the gateway created for a
 * request keeps that request's own system prompt, so it begins as a
 * pass-through; any other skill has one written from its description.
 */
async function seedSystemPrompt(
  c: AppContext,
  skill: Skill,
  connector: UserDataStorageConnector,
): Promise<string> {
  return (
    skill.seed_system_prompt ??
    (await generateSeedSystemPromptForSkill(c, skill, connector))
  );
}

/**
 * Arm generation for a skill, one at a time. Generation reads the arms a
 * skill has, may ask a model for a prompt, then writes arms for what it found
 * missing -- and nothing keeps a cluster's arms unique, so two generations
 * that overlapped each wrote the same arms. A repair racing the first full
 * generation after a model was attached gave a cluster every arm twice.
 * Within a process, generations for one skill now wait their turn.
 *
 * Each is kept as when it started and when it settled: the wait for it is
 * counted from its start, not from when the next one asked, so a queue
 * behind a stuck generation does not time out on one that only just began.
 */
const armGenerations = new Map<
  string,
  { started: Promise<void>; settled: Promise<void> }
>();

/**
 * How long a generation may hold the skill before the next one goes ahead
 * without it. One that never settles -- on Workers, a request cancelled
 * before its work was handed to `waitUntil` -- would otherwise hold every
 * later generation for the skill for as long as the isolate lives. A
 * generation's model calls are the evaluations, then a prompt, each an
 * attempt and a retry of at most two minutes at the default timeouts: eight
 * minutes at the very worst. Ten -- the reflection lock's floor -- is past
 * any generation still going to finish, so one that outlasts it is taken as
 * stuck. A timeout raised far past its default can make a slow generation
 * look stuck; the cost is the duplicate arms this lock exists to prevent,
 * against a skill that could otherwise never be generated again.
 */
export const ARM_GENERATION_WAIT_MS = 10 * 60 * 1000;

/** Settles when `previous` does, or after `ms`, whichever comes first. */
function waitAtMost(
  previous: Promise<unknown>,
  ms: number,
  onTimeout: () => void,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      onTimeout();
      resolve();
    }, ms);
  });
  return Promise.race([
    previous.then(
      () => undefined,
      () => undefined,
    ),
    timedOut,
  ]).finally(() => clearTimeout(timer));
}

export function withArmGenerationLock<T>(
  skillId: string,
  generate: () => Promise<T>,
): Promise<T> {
  const previous = armGenerations.get(skillId);
  // Resolves when this generation may start, and never rejects.
  const started = previous
    ? previous.started.then(() =>
        waitAtMost(previous.settled, ARM_GENERATION_WAIT_MS, () =>
          warn(
            `[ARM_GENERATION] The arm generation before this one for skill ${skillId} has not finished in ${ARM_GENERATION_WAIT_MS / 1000}s; generating without waiting for it any longer`,
          ),
        ),
      )
    : Promise.resolve();
  const run = started.then(generate);
  const settled = run.then(
    () => undefined,
    () => undefined,
  );
  const generation = { started, settled };
  armGenerations.set(skillId, generation);
  void settled.then(() => {
    if (armGenerations.get(skillId) === generation) {
      armGenerations.delete(skillId);
    }
  });
  return run;
}

export function handleGenerateArms(
  c: AppContext,
  userStorageConnector: UserDataStorageConnector,
  skillId: string,
  clusterId?: string, // Optional: if provided, only regenerate arms for this cluster
) {
  return withArmGenerationLock(skillId, () =>
    generateArms(c, userStorageConnector, skillId, clusterId),
  );
}

/**
 * `handleGenerateArms` for a caller that already holds the skill's lock --
 * `withArmGenerationLock` -- and must look at the arms under it first.
 */
export async function generateArms(
  c: AppContext,
  userStorageConnector: UserDataStorageConnector,
  skillId: string,
  clusterId?: string,
) {
  const skills = await userStorageConnector.getSkills(c, {
    id: skillId,
  });

  if (skills.length === 0) {
    return c.json({ error: 'Skill not found' }, 404);
  }

  const skill = skills[0];

  // Get logs storage connector and evaluation connectors from context
  const logsStorageConnector = c.get('logs_storage_connector');
  const evaluationConnectorsMap = c.get('evaluation_connectors_map');

  // Check if we have at least 5 logs with embeddings to use context-aware generation
  let hasEnoughLogsForContext = false;
  let logs: Awaited<ReturnType<LogsStorageConnector['getLogs']>> = [];

  if (logsStorageConnector) {
    logs = await logsStorageConnector.getLogs(c, {
      skill_id: skill.id,
      embedding_not_null: true,
      limit: 5,
    });
    hasEnoughLogsForContext = logs.length >= 5;
  }

  // If we have enough logs, regenerate evaluations with context before creating arms
  // Only do this for skill-wide regeneration (not cluster-specific)
  if (hasEnoughLogsForContext && !clusterId) {
    const exampleLogs = logs.filter(isCompletedLog).slice(0, 5);
    const examples = generateExampleConversations(exampleLogs);

    // Get existing evaluations
    const existingEvaluations =
      await userStorageConnector.getSkillOptimizationEvaluations(c, {
        skill_id: skill.id,
      });

    if (existingEvaluations.length > 0 && examples.length > 0) {
      // Get agent description for context
      const agents = await userStorageConnector.getAgents(c, {
        id: skill.agent_id,
      });

      if (agents.length > 0) {
        const agent = agents[0];

        // Extract existing evaluation methods
        const existingMethods = existingEvaluations.map(
          (e) => e.evaluation_method,
        );

        // Regenerate evaluations with context
        const regeneratedEvaluationParams =
          await regenerateEvaluationsWithExamples(
            c,
            skill,
            agent.description,
            examples,
            evaluationConnectorsMap as Record<
              string,
              EvaluationMethodConnector
            >,
            existingMethods as EvaluationMethodName[],
            userStorageConnector,
          );

        // In place, so the ids -- and every score the skill's logs were
        // given against these evaluations -- stay
        await applyRegeneratedEvaluations(
          c,
          userStorageConnector,
          existingEvaluations,
          regeneratedEvaluationParams,
          evaluationConnectorsMap,
        );
      }
    }
  }

  // Get existing arms - either for specific cluster or entire skill
  const existingArms = clusterId
    ? await userStorageConnector.getSkillOptimizationArms(c, {
        cluster_id: clusterId,
      })
    : await userStorageConnector.getSkillOptimizationArms(c, {
        skill_id: skill.id,
      });

  // Reset cluster step count - either specific cluster or all clusters
  let clusters: Awaited<
    ReturnType<UserDataStorageConnector['getSkillOptimizationClusters']>
  >;

  if (clusterId) {
    clusters = await userStorageConnector.getSkillOptimizationClusters(c, {
      id: clusterId,
    });
    if (clusters.length === 0) {
      return c.json({ error: 'Cluster not found' }, 404);
    }
    // Only reset the specific cluster (already done in caller, but ensure consistency)
    await userStorageConnector.updateSkillOptimizationCluster(c, clusterId, {
      total_steps: 0,
    });
  } else {
    clusters = await userStorageConnector.getSkillOptimizationClusters(c, {
      skill_id: skill.id,
    });
    if (!clusters) {
      return c.json({ error: 'Clusters not found' }, 404);
    }
    // Reset all clusters
    for (const cluster of clusters) {
      await userStorageConnector.updateSkillOptimizationCluster(c, cluster.id, {
        total_steps: 0,
      });
    }
  }

  const skillModels = await userStorageConnector.getSkillModels(c, skill.id);
  // Use the clusters we already fetched (either specific one or all)
  const skillClusters = clusters;

  if (!skillModels || !skillClusters) {
    return c.json({ error: 'Skill models or clusters not found' }, 404);
  }

  // We don't need to create arms if there are no models or clusters
  if (skillModels.length === 0 || skillClusters.length === 0) {
    // Delete existing arms if any
    for (const arm of existingArms) {
      await userStorageConnector.deleteSkillOptimizationArmStats(c, {
        arm_id: arm.id,
      });
    }
    return c.json({ updatedArms: [] }, 200);
  }

  // Generate system prompt based on whether we have enough context
  let systemPrompt: string;
  if (hasEnoughLogsForContext) {
    const exampleLogs = logs.filter(isCompletedLog).slice(0, 5);
    const examples = generateExampleConversations(exampleLogs);

    // Get agent description for context
    const agents = await userStorageConnector.getAgents(c, {
      id: skill.agent_id,
    });

    if (agents.length > 0 && examples.length > 0) {
      const agent = agents[0];
      // As early regeneration does: the output schema the requests asked
      // for, and the template variables the skill's callers send -- without
      // them, the prompt written here quietly dropped both.
      const responseFormat = exampleLogs
        .map((log) => log.ai_provider_request_log.request_body)
        .find(
          (body) => 'response_format' in body && body.response_format,
        )?.response_format;
      systemPrompt = await generateSeedSystemPromptWithContext(
        c,
        agent.description,
        skill.description,
        examples,
        userStorageConnector,
        responseFormat,
        skill.allowed_template_variables,
        skill.seed_system_prompt,
        agent,
      );
    } else {
      systemPrompt = await seedSystemPrompt(c, skill, userStorageConnector);
    }
  } else {
    systemPrompt = await seedSystemPrompt(c, skill, userStorageConnector);
  }

  // Build a map of existing arms by cluster_id -> list of arms (not just IDs)
  const existingArmsByCluster = new Map<string, (typeof existingArms)[0][]>();
  for (const arm of existingArms) {
    if (!existingArmsByCluster.has(arm.cluster_id)) {
      existingArmsByCluster.set(arm.cluster_id, []);
    }
    existingArmsByCluster.get(arm.cluster_id)!.push(arm);
  }

  // Process each cluster independently to ensure arms are named 1-n per cluster
  const updatedArms: string[] = [];
  const armsToCreate: SkillOptimizationArmCreateParams[] = [];
  const matchedArmIds = new Set<string>();

  for (const cluster of skillClusters) {
    const availableArms = existingArmsByCluster.get(cluster.id) || [];
    // Track used names in this cluster to avoid conflicts
    const usedNames = new Set<string>();
    // Track next available name counter for new arms
    let nextNameCounter = 1;

    for (const model of skillModels) {
      for (const baseArm of BaseArmsParams) {
        const armParams: SkillOptimizationArmParams = {
          ...baseArm,
          model_id: model.id,
          system_prompt: systemPrompt,
        };

        // Try to reuse an existing arm for this cluster
        const existingArm = availableArms.shift();

        if (existingArm) {
          // Update existing arm in-place, keeping its original name
          await userStorageConnector.updateSkillOptimizationArm(
            c,
            existingArm.id,
            {
              params: armParams,
            },
          );
          // Delete arm stats to reset performance history
          await userStorageConnector.deleteSkillOptimizationArmStats(c, {
            arm_id: existingArm.id,
          });
          updatedArms.push(existingArm.id);
          matchedArmIds.add(existingArm.id);
          usedNames.add(existingArm.name);
        } else {
          // Find next available name that doesn't conflict with existing arms
          while (usedNames.has(`${nextNameCounter}`)) {
            nextNameCounter++;
          }
          const newName = `${nextNameCounter}`;
          usedNames.add(newName);
          nextNameCounter++;

          // Need to create new arm
          armsToCreate.push({
            agent_id: skill.agent_id,
            skill_id: skill.id,
            cluster_id: cluster.id,
            name: newName,
            params: armParams,
          });
        }
      }
    }
  }

  // Create any new arms needed
  if (armsToCreate.length > 0) {
    const createdArms = await userStorageConnector.createSkillOptimizationArms(
      c,
      armsToCreate,
    );
    updatedArms.push(...createdArms.map((a) => a.id));
  }

  // Delete any orphaned arms that don't match expected structure
  for (const arm of existingArms) {
    if (!matchedArmIds.has(arm.id)) {
      await userStorageConnector.deleteSkillOptimizationArmStats(c, {
        arm_id: arm.id,
      });
      await userStorageConnector.deleteSkillOptimizationArm(c, arm.id);
    }
  }

  return c.json({ updatedArms }, 200);
}
