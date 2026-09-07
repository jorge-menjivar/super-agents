import { LatencyEvaluationParameters } from '@api/connectors/evaluations/latency/types';
import type { EvaluationMethodConnector } from '@api/types/connector';
import {
  type EvaluationMethodDetails,
  EvaluationMethodName,
} from '@shared/types/evaluations';
import { evaluateLog } from './service/evaluate';

const methodConfig: EvaluationMethodDetails = {
  method: EvaluationMethodName.LATENCY,
  name: 'Latency',
  description:
    "Evaluates the provider's time to first token (TTFT) for streaming responses, or its total response time for non-streaming",
} as const;

export const latencyEvaluationConnector: EvaluationMethodConnector = {
  getDetails: () => methodConfig,
  evaluateLog,
  getParameterSchema: LatencyEvaluationParameters,
  // Latency evaluation doesn't use AI for parameter generation, so we omit getAIParameterSchema
};
