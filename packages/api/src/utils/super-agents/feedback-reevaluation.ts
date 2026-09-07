import type { AppContext } from '@api/types/hono';
import { runEvaluationsForLog } from '@api/utils/realtime-evaluations';
import { emitSSEEvent } from '@api/utils/sse-event-manager';
import { error } from '@shared/console-logging';
import type { Feedback } from '@shared/types/data/feedback';
import { isCompletedLog } from '@shared/types/data/log';
import { getRuntimeKey } from 'hono/adapter';

/**
 * Thumbs up/down on a log re-runs all of its evaluations with the human
 * verdict folded into the judges' prompts, and REPLACES the log's stored
 * evaluation runs with the verdict-informed one -- the log's displayed
 * score, and the contrastive examples reflection picks its lessons from,
 * should reflect what a human verified rather than an unanchored guess.
 *
 * Arm stats are left alone: a log does not record which arm served it, and
 * the original run already paid its stats forward.
 */
export async function reevaluateLogFromFeedback(
  c: AppContext,
  feedback: Feedback,
): Promise<void> {
  const userDataConnector = c.get('user_data_storage_connector');
  const logsConnector = c.get('logs_storage_connector');
  const evaluationConnectorsMap = c.get('evaluation_connectors_map');

  const [log] = await logsConnector.getLogs(c, { id: feedback.log_id });
  if (!log) {
    error(`[FEEDBACK_REEVAL] Log ${feedback.log_id} not found`);
    return;
  }

  // Feedback can only be left on a request that answered, but the row is
  // fetched by id and the type cannot know that.
  if (!isCompletedLog(log)) {
    return;
  }

  const evaluations = await userDataConnector.getSkillOptimizationEvaluations(
    c,
    { agent_id: log.agent_id, skill_id: log.skill_id },
  );
  if (evaluations.length === 0) {
    return;
  }

  const humanVerdict = feedback.score >= 0.5 ? 'good' : 'bad';
  const results = await runEvaluationsForLog(
    c,
    log,
    evaluations,
    evaluationConnectorsMap,
    userDataConnector,
    { humanVerdict, humanVerdictReason: feedback.feedback ?? undefined },
  );
  if (results.length === 0) {
    error(
      `[FEEDBACK_REEVAL] No evaluations produced results for log ${log.id}`,
    );
    return;
  }

  // Replace, not append: the eval-score view averages every run of a log,
  // and the pre-verdict scores are exactly what the human just corrected.
  const previousRuns =
    await userDataConnector.getSkillOptimizationEvaluationRuns(c, {
      log_id: log.id,
    });
  for (const run of previousRuns) {
    await userDataConnector.deleteSkillOptimizationEvaluationRun(c, run.id);
  }

  const evaluationRun =
    await userDataConnector.createSkillOptimizationEvaluationRun(c, {
      agent_id: log.agent_id,
      skill_id: log.skill_id,
      cluster_id: log.cluster_id ?? null,
      log_id: log.id,
      results,
    });

  emitSSEEvent('skill-optimization:evaluation-run-created', {
    evaluationRun,
    agentId: log.agent_id,
    skillId: log.skill_id,
    clusterId: log.cluster_id ?? null,
    logId: log.id,
  });
}

/**
 * Fire-and-forget wrapper for the feedback route: the POST answers as soon
 * as the feedback row exists, and the judges run behind it.
 */
export function scheduleFeedbackReevaluation(
  c: AppContext,
  feedback: Feedback,
): void {
  const reevaluation = reevaluateLogFromFeedback(c, feedback).catch((e) => {
    error(
      `[FEEDBACK_REEVAL] Re-evaluation for log ${feedback.log_id} failed:`,
      e instanceof Error ? e.message : String(e),
    );
  });
  if (getRuntimeKey() === 'workerd') {
    c.executionCtx.waitUntil(reevaluation);
  }
}
