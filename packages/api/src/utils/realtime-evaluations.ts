import type {
  EvaluateLogOptions,
  EvaluationMethodConnector,
  UserDataStorageConnector,
} from '@api/types/connector';
import type { AppContext } from '@api/types/hono';
import { error } from '@shared/console-logging';
import type {
  SkillOptimizationEvaluation,
  SkillOptimizationEvaluationResult,
} from '@shared/types/data';
import type { CompletedLog } from '@shared/types/data/log';
import type { EvaluationMethodName } from '@shared/types/evaluations';

/**
 * Run realtime evaluations for a single log using skill optimization evaluations
 */
export async function runEvaluationsForLog(
  c: AppContext,
  log: CompletedLog,
  skillOptimizationEvaluations: SkillOptimizationEvaluation[],
  evaluationConnectorsMap: Partial<
    Record<EvaluationMethodName, EvaluationMethodConnector>
  >,
  storageConnector: UserDataStorageConnector,
  options?: EvaluateLogOptions,
): Promise<SkillOptimizationEvaluationResult[]> {
  if (skillOptimizationEvaluations.length === 0) {
    return [];
  }

  // Execute all evaluations in parallel for better performance
  const evaluationPromises = skillOptimizationEvaluations.map(
    async (evaluation) => {
      try {
        const connector = evaluationConnectorsMap[evaluation.evaluation_method];
        if (!connector?.evaluateLog) {
          error(
            `[REALTIME_EVAL] No connector found for evaluation method: ${evaluation.evaluation_method}`,
          );
          return;
        }

        // Use the evaluation ID for skill optimization evaluations
        return await connector.evaluateLog(
          c,
          evaluation,
          log,
          storageConnector,
          options,
        );
      } catch (err) {
        // Don't throw - we want other evaluations to continue even if one fails
        error(
          `[REALTIME_EVAL] Failed to evaluate log ${log.id} with method ${evaluation.evaluation_method}:`,
          err instanceof Error ? err.message : String(err),
        );
      }
    },
  );

  try {
    return (await Promise.allSettled(evaluationPromises))
      .filter((result) => result.status === 'fulfilled')
      .map((result) => result.value)
      .filter(
        (value): value is SkillOptimizationEvaluationResult =>
          value !== undefined,
      );
  } catch (e) {
    if (e instanceof Error) {
      throw new Error('Error in skill optimization evaluations batch:', e);
    }
    throw new Error(
      'Error in skill optimization evaluations batch: unknown error',
    );
  }
}

/**
 * Check if a request should trigger realtime evaluations
 */
export function shouldTriggerRealtimeEvaluation(
  status: number,
  url: URL,
): boolean {
  // Only trigger on successful responses
  if (status !== 200) {
    return false;
  }

  // Only evaluate actual AI provider calls, not internal Super Agents API calls
  if (!url.pathname.startsWith('/v1/')) {
    return false;
  }

  // Don't evaluate Super Agents internal API calls
  if (url.pathname.startsWith('/v1/super-agents')) {
    return false;
  }

  return true;
}
