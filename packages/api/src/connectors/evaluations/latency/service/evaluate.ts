import { LatencyEvaluationParameters } from '@api/connectors/evaluations/latency/types';
import type { UserDataStorageConnector } from '@api/types/connector';
import type { AppContext } from '@api/types/hono';
import type {
  SkillOptimizationEvaluation,
  SkillOptimizationEvaluationResult,
} from '@shared/types/data';
import type { CompletedLog, Log } from '@shared/types/data/log';
import { EvaluationMethodName } from '@shared/types/evaluations';

/**
 * Calculate latency score based on measured latency and thresholds
 *
 * Score formula:
 * - If latency <= target: score = 1.0
 * - If latency >= max: score = 0.0
 * - Otherwise: linear interpolation between 1.0 and 0.0
 */
function calculateLatencyScore(
  latency_ms: number,
  target_latency_ms: number,
  max_latency_ms: number,
): number {
  if (latency_ms <= target_latency_ms) {
    return 1.0;
  }
  if (latency_ms >= max_latency_ms) {
    return 0.0;
  }

  // Linear interpolation between target and max
  const range = max_latency_ms - target_latency_ms;
  const position = latency_ms - target_latency_ms;
  return 1.0 - position / range;
}

/** How long the model took, and which span of the log the number came from. */
interface LatencyMeasurement {
  latency_ms: number;
  /** To the first token, or to the whole answer when the request did not stream. */
  measured: 'ttft' | 'response';
  /**
   * `provider` counts from the moment the provider was asked. `request`
   * counts from the moment the request arrived, which is all a log written
   * before the gateway recorded the provider's own timing has to offer.
   */
  measured_from: 'provider' | 'request';
}

/**
 * How long the model took, read from the log.
 *
 * The provider's own timing is preferred. The log row's `start_time` is when
 * the request arrived, and everything the gateway did before asking the
 * provider -- choosing the skill, embedding the request, the input hooks --
 * sits between the two; its `end_time` likewise waits for the output hooks,
 * a reviewer among them. None of that is the model's to answer for, and a
 * score that counted it would move with the gateway's load rather than with
 * the configuration under test. A log without the provider's timing is
 * measured across the whole request, as every log once was.
 */
function extractLatency(log: Log): LatencyMeasurement | null {
  const provider = log.ai_provider_request_log;
  const firstToken = log.first_token_time ?? null;

  if (provider?.start_time !== undefined) {
    if (firstToken !== null) {
      return {
        latency_ms: firstToken - provider.start_time,
        measured: 'ttft',
        measured_from: 'provider',
      };
    }
    if (provider.end_time !== undefined) {
      return {
        latency_ms: provider.end_time - provider.start_time,
        measured: 'response',
        measured_from: 'provider',
      };
    }
  }

  if (firstToken !== null) {
    return {
      latency_ms: firstToken - log.start_time,
      measured: 'ttft',
      measured_from: 'request',
    };
  }
  if (log.duration === null) {
    return null;
  }
  return {
    latency_ms: log.duration,
    measured: 'response',
    measured_from: 'request',
  };
}

export function evaluateLog(
  _c: AppContext,
  evaluation: SkillOptimizationEvaluation,
  log: CompletedLog,
  _storageConnector: UserDataStorageConnector,
): Promise<SkillOptimizationEvaluationResult> {
  const start_time = Date.now();

  try {
    const params = LatencyEvaluationParameters.parse(evaluation.params);

    const measurement = extractLatency(log);

    // If we couldn't extract latency, return 0.5 (neutral score)
    if (measurement === null) {
      const execution_time = Date.now() - start_time;
      return Promise.resolve({
        evaluation_id: evaluation.id,
        method: EvaluationMethodName.LATENCY,
        score: 0.5,
        extra_data: {
          error: 'Could not extract latency from log',
          execution_time,
        },
        display_info: [
          {
            label: 'Error',
            content: 'Could not extract latency from log',
          },
        ],
        judge_model_name: null,
        judge_model_provider: null,
      });
    }

    const { latency_ms, measured, measured_from } = measurement;

    const score = calculateLatencyScore(
      latency_ms,
      params.target_latency_ms,
      params.max_latency_ms,
    );

    const execution_time = Date.now() - start_time;

    // Format latency performance for display
    const latencyType =
      measured === 'ttft'
        ? 'Time to First Token (TTFT)'
        : measured_from === 'provider'
          ? 'Provider Response Time'
          : 'Total Response Time';
    const measuredFrom =
      measured_from === 'provider'
        ? 'when the provider was asked'
        : "when the request arrived (this log predates the provider's own timing)";

    const performance =
      latency_ms <= params.target_latency_ms
        ? '✓ Excellent - Below target'
        : latency_ms >= params.max_latency_ms
          ? '✗ Poor - Exceeds maximum'
          : '⚠ Acceptable - Between target and maximum';

    const result: SkillOptimizationEvaluationResult = {
      evaluation_id: evaluation.id,
      method: EvaluationMethodName.LATENCY,
      score,
      extra_data: {
        latency_ms,
        target_latency_ms: params.target_latency_ms,
        max_latency_ms: params.max_latency_ms,
        has_first_token_time: log.first_token_time !== null,
        measured,
        measured_from,
        execution_time,
      },
      display_info: [
        {
          label: 'Performance',
          content: performance,
        },
        {
          label: 'Latency Measurement',
          content: `${latencyType}: ${latency_ms}ms\nMeasured from: ${measuredFrom}\nTarget: ${params.target_latency_ms}ms\nMaximum: ${params.max_latency_ms}ms\nScore: ${(score * 100).toFixed(1)}%`,
        },
      ],
      judge_model_name: null,
      judge_model_provider: null,
    };

    return Promise.resolve(result);
  } catch (err) {
    const execution_time = Date.now() - start_time;
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    return Promise.resolve({
      evaluation_id: evaluation.id,
      method: EvaluationMethodName.LATENCY,
      score: 0.5,
      extra_data: {
        error: errorMessage,
        execution_time,
      },
      display_info: [
        {
          label: 'Error',
          content: errorMessage,
        },
      ],
      judge_model_name: null,
      judge_model_provider: null,
    });
  }
}
