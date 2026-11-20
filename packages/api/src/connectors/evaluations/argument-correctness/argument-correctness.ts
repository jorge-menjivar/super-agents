import {
  ArgumentCorrectnessEvaluationAIParameters,
  ArgumentCorrectnessEvaluationParameters,
} from '@api/connectors/evaluations/argument-correctness/types';
import type { EvaluationMethodConnector } from '@api/types/connector';
import {
  type EvaluationMethodDetails,
  EvaluationMethodName,
} from '@shared/types/evaluations';
import { evaluateLog } from './service/evaluate';

const methodConfig: EvaluationMethodDetails = {
  method: EvaluationMethodName.ARGUMENT_CORRECTNESS,
  agent_types: ['text'],
  name: 'Argument Correctness',
  description:
    'Evaluates whether an agent generated correct tool call arguments given the input and task using LLM-as-a-judge',
} as const;

export const argumentCorrectnessEvaluationConnector: EvaluationMethodConnector =
  {
    getDetails: () => methodConfig,
    evaluateLog,
    getParameterSchema: ArgumentCorrectnessEvaluationParameters,
    getAIParameterSchema: ArgumentCorrectnessEvaluationAIParameters,
  };
