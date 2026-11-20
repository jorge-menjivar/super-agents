import {
  TurnRelevancyEvaluationAIParameters,
  TurnRelevancyEvaluationParameters,
} from '@api/connectors/evaluations/turn-relevancy/types';
import type { EvaluationMethodConnector } from '@api/types/connector';
import {
  type EvaluationMethodDetails,
  EvaluationMethodName,
} from '@shared/types/evaluations';
import { evaluateLog } from './service/evaluate';

const methodConfig: EvaluationMethodDetails = {
  method: EvaluationMethodName.TURN_RELEVANCY,
  agent_types: ['text'],
  name: 'Turn Relevancy',
  description:
    'Evaluates whether a conversation turn is relevant to the prior context',
} as const;

export const turnRelevancyEvaluationConnector: EvaluationMethodConnector = {
  getDetails: () => methodConfig,
  evaluateLog,
  getParameterSchema: TurnRelevancyEvaluationParameters,
  getAIParameterSchema: TurnRelevancyEvaluationAIParameters,
};
