import { evaluationLockWindowMs } from '@api/middlewares/optimizer/locks';
import { generateExampleConversations } from '@api/middlewares/optimizer/system-prompt';
import { repairSkillNaming } from '@api/optimization/utils/describe-skill';
import {
  applyRegeneratedEvaluations,
  regenerateEvaluationsWithExamples,
} from '@api/optimization/utils/evaluations';
import { generateSeedSystemPromptWithContext } from '@api/optimization/utils/system-prompt';
import type {
  EvaluationMethodConnector,
  LogsStorageConnector,
  UserDataStorageConnector,
} from '@api/types/connector';
import type { AppContext } from '@api/types/hono';
import { agentById } from '@api/utils/evaluation-model-resolver';
import { emitSSEEvent } from '@api/utils/sse-event-manager';
import { judgeLogsWithoutRuns } from '@api/utils/super-agents/judge-backlog';
import { FunctionName } from '@shared/types/api/request';
import type {
  Skill,
  SkillOptimizationArm,
  SkillOptimizationEvaluationResult,
  SkillOptimizationEvaluationRunCreateParams,
} from '@shared/types/data';
import { isCompletedLog } from '@shared/types/data/log';
import { SkillEventType } from '@shared/types/data/skill-event';
import type { EvaluationMethodName } from '@shared/types/evaluations';

/** The shortest a regeneration lock is ever held. */
const EVALUATION_LOCK_FLOOR_MS = 5 * 60 * 1000;

export async function addSkillOptimizationEvaluationRun(
  c: AppContext,
  userDataStorageConnector: UserDataStorageConnector,
  arm: SkillOptimizationArm,
  logId: string,
  evaluationResults: SkillOptimizationEvaluationResult[],
) {
  const createParams: SkillOptimizationEvaluationRunCreateParams = {
    agent_id: arm.agent_id,
    skill_id: arm.skill_id,
    cluster_id: arm.cluster_id,
    log_id: logId,
    results: evaluationResults,
  };

  const evaluationRun =
    await userDataStorageConnector.createSkillOptimizationEvaluationRun(
      c,
      createParams,
    );

  // Emit SSE event for evaluation run creation with full evaluation data
  emitSSEEvent('skill-optimization:evaluation-run-created', {
    evaluationRun: evaluationRun,
    agentId: arm.agent_id,
    skillId: arm.skill_id,
    clusterId: arm.cluster_id,
    logId: logId,
  });
}

/**
 * Checks if we should regenerate system prompts and evaluations with real examples.
 * This happens after the first 5 requests to use actual usage data.
 */
export async function checkAndRegenerateEvaluationsEarly(
  c: AppContext,
  functionName: FunctionName,
  userDataStorageConnector: UserDataStorageConnector,
  logsStorageConnector: LogsStorageConnector,
  skill: Skill,
  agentDescription: string,
  evaluationConnectorsMap: Record<string, EvaluationMethodConnector>,
): Promise<void> {
  try {
    // Only attempt to optimize for specific endpoints
    if (
      !(
        functionName === FunctionName.CHAT_COMPLETE ||
        functionName === FunctionName.STREAM_CHAT_COMPLETE ||
        functionName === FunctionName.CREATE_MODEL_RESPONSE
      )
    ) {
      return;
    }

    // Re-fetch skill to get latest metadata state (critical for lock check)
    // This ensures we see any locks or completion flags set by concurrent requests
    const latestSkills = await userDataStorageConnector.getSkills(c, {
      id: skill.id,
    });

    if (latestSkills.length === 0) {
      return;
    }

    const latestSkill = latestSkills[0];

    // Check if skill has evaluations_regenerated_at set
    const hasRegeneratedEvaluations =
      latestSkill.evaluations_regenerated_at !== null;

    if (hasRegeneratedEvaluations) {
      // Already regenerated once, skip
      return;
    }

    // Check if a regeneration lock exists and still covers its work. Five
    // minutes is the floor; the window grows with the timeouts of the calls
    // the lock guards, so raising one for a slow model does not start
    // letting a second request in on top of the first.
    const lockTimestamp = latestSkill.evaluation_lock_acquired_at;
    if (lockTimestamp) {
      const lockAge = Date.now() - new Date(lockTimestamp).getTime();
      const lockWindow = await evaluationLockWindowMs(
        c,
        userDataStorageConnector,
        EVALUATION_LOCK_FLOOR_MS,
      );

      if (lockAge < lockWindow) {
        return;
      }
    }

    // Try to acquire lock by updating the skill
    const lockTime = new Date().toISOString();
    try {
      await userDataStorageConnector.updateSkill(c, skill.id, {
        evaluation_lock_acquired_at: lockTime,
      });
    } catch (_error) {
      return;
    }

    // CRITICAL: Double-check the lock after acquisition to detect race conditions
    // Re-fetch the skill and verify:
    // 1. The lock we just set is still there (not overwritten by another process)
    // 2. No completion flag has been set (another process didn't complete while we were setting the lock)
    const postLockSkills = await userDataStorageConnector.getSkills(c, {
      id: skill.id,
    });

    if (postLockSkills.length === 0) {
      return;
    }

    const postLockSkill = postLockSkills[0];

    // Check if completion flag was set by another process
    if (postLockSkill.evaluations_regenerated_at !== null) {
      await userDataStorageConnector.updateSkill(c, skill.id, {
        evaluation_lock_acquired_at: null,
      });
      return;
    }

    // Check if our lock is still there (not overwritten by another process)
    // Compare as Date objects to handle different ISO string formats (Z vs +00:00)
    const postLockTime = postLockSkill.evaluation_lock_acquired_at
      ? new Date(postLockSkill.evaluation_lock_acquired_at).getTime()
      : null;
    const expectedLockTime = new Date(lockTime).getTime();

    if (postLockTime !== expectedLockTime) {
      return;
    }

    // Count total logs for this skill
    const logs = await logsStorageConnector.getLogs(c, {
      skill_id: skill.id,
      embedding_not_null: true,
      limit: 10, // Get a few more than needed
    });

    // Need at least 5 logs to regenerate
    if (logs.length < 5) {
      // Release lock
      await userDataStorageConnector.updateSkill(c, skill.id, {
        evaluation_lock_acquired_at: null,
      });
      return;
    }

    // Only finished requests carry a provider exchange to learn from; a row
    // still running, or one that failed before a provider answered, has none.
    const exampleLogs = logs.filter(isCompletedLog).slice(0, 5);
    const examples = generateExampleConversations(exampleLogs);

    if (examples.length === 0) {
      // Release lock
      await userDataStorageConnector.updateSkill(c, skill.id, {
        evaluation_lock_acquired_at: null,
      });
      return;
    }

    // A skill born before system settings had models kept its heuristic
    // fallback naming -- `describeSkillForRequest` could not be asked, and
    // nothing else revisits naming. This pass is that retry too, and it runs
    // first so the regenerated prompt and evaluations build on the real
    // description rather than the boilerplate.
    const repairedNaming = await repairSkillNaming(
      c,
      userDataStorageConnector,
      skill,
      agentDescription,
      examples[0],
    );
    const describedSkill = repairedNaming
      ? { ...skill, ...repairedNaming }
      : skill;

    // Extract response format from the first log that has one (needed for system prompt)
    let responseFormat: unknown;
    for (const log of exampleLogs) {
      const requestBody = log.ai_provider_request_log.request_body;
      if ('response_format' in requestBody && requestBody.response_format) {
        responseFormat = requestBody.response_format;
        break;
      }
    }

    // Generate new system prompt with schema and examples
    const newSystemPrompt = await generateSeedSystemPromptWithContext(
      c,
      agentDescription,
      describedSkill.description,
      examples,
      userDataStorageConnector,
      responseFormat,
      skill.allowed_template_variables,
      skill.seed_system_prompt,
      await agentById(c, userDataStorageConnector, skill.agent_id),
    );

    // Get existing evaluations to know which methods to regenerate. A skill
    // the gateway created can have none at all: its evaluations are generated
    // in the background at creation, that can fail -- system settings without
    // an evaluation model yet, a provider down -- and nothing else retries.
    // This pass is the retry: an auto-created skill with no evaluations gets
    // every method the server has, generated from these first real examples.
    const existingEvaluations =
      await userDataStorageConnector.getSkillOptimizationEvaluations(c, {
        skill_id: skill.id,
      });
    const methodsToGenerate =
      existingEvaluations.length > 0
        ? existingEvaluations.map((e) => e.evaluation_method)
        : skill.auto_created
          ? (Object.keys(evaluationConnectorsMap) as EvaluationMethodName[])
          : [];

    // Regenerate evaluations with real examples
    const newEvaluationParams = await regenerateEvaluationsWithExamples(
      c,
      describedSkill,
      agentDescription,
      examples,
      evaluationConnectorsMap,
      methodsToGenerate,
      userDataStorageConnector,
    );

    // In place, so the ids -- and every score recorded against them -- stay
    await applyRegeneratedEvaluations(
      c,
      userDataStorageConnector,
      existingEvaluations,
      newEvaluationParams,
    );

    // The from-scratch case: record what was generated, the way creation
    // would have.
    if (existingEvaluations.length === 0 && newEvaluationParams.length > 0) {
      const createdEvaluations =
        await userDataStorageConnector.createSkillOptimizationEvaluations(
          c,
          newEvaluationParams,
        );
      for (const evaluation of createdEvaluations) {
        await userDataStorageConnector.createSkillEvent(c, {
          agent_id: skill.agent_id,
          skill_id: skill.id,
          cluster_id: null,
          event_type: SkillEventType.EVALUATION_ADDED,
          metadata: { evaluation_method: evaluation.evaluation_method },
        });
      }
      // Every request so far was answered against no evaluations
      await judgeLogsWithoutRuns(
        c,
        userDataStorageConnector,
        logsStorageConnector,
        evaluationConnectorsMap,
        skill,
        createdEvaluations,
      );
    }

    // Update all arms in-place with new system prompts
    // This preserves arm IDs and cluster associations
    const allArms = await userDataStorageConnector.getSkillOptimizationArms(c, {
      skill_id: skill.id,
    });

    for (const arm of allArms) {
      await userDataStorageConnector.updateSkillOptimizationArm(c, arm.id, {
        params: {
          ...arm.params,
          system_prompt: newSystemPrompt,
        },
      });
    }

    // Reset all arm stats since we have new evaluations and system prompts
    // This forces Thompson Sampling to re-explore with the new configurations
    for (const arm of allArms) {
      await userDataStorageConnector.deleteSkillOptimizationArmStats(c, {
        arm_id: arm.id,
      });
    }

    // Reset all cluster total_steps to 0 for early regeneration
    // This restarts the exploration/exploitation balance
    const allClusters =
      await userDataStorageConnector.getSkillOptimizationClusters(c, {
        skill_id: skill.id,
      });

    for (const cluster of allClusters) {
      await userDataStorageConnector.updateSkillOptimizationCluster(
        c,
        cluster.id,
        {
          total_steps: 0,
        },
      );
    }

    // Mark completion and release lock atomically
    await userDataStorageConnector.updateSkill(c, skill.id, {
      evaluations_regenerated_at: new Date().toISOString(),
      evaluation_lock_acquired_at: null, // Release lock
    });

    // Create event for context generation
    await userDataStorageConnector.createSkillEvent(c, {
      agent_id: skill.agent_id,
      skill_id: skill.id,
      cluster_id: null, // Skill-wide event
      event_type: SkillEventType.CONTEXT_GENERATED,
      metadata: {
        log_count: exampleLogs.length,
      },
    });

    // Emit SSE event
    emitSSEEvent('skill-optimization:evaluations-regenerated', {
      skillId: skill.id,
      reason: 'early-regeneration',
      exampleCount: examples.length,
    });
  } catch (error) {
    console.error('[EARLY_EVAL_REGEN] Error during regeneration:', error);
    // Release lock on error
    try {
      await userDataStorageConnector.updateSkill(c, skill.id, {
        evaluation_lock_acquired_at: null,
      });
    } catch (unlockError) {
      console.error('[EARLY_EVAL_REGEN] Failed to release lock:', unlockError);
    }
    // Don't throw - we don't want to break the request flow
  }
}
