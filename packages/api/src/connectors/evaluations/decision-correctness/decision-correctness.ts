import { evaluateLog } from '@api/connectors/evaluations/decision-correctness/service/evaluate';
import { DecisionCorrectnessEvaluationParameters } from '@api/connectors/evaluations/decision-correctness/types';
import type { EvaluationMethodConnector } from '@api/types/connector';
import {
  type EvaluationMethodDetails,
  EvaluationMethodName,
} from '@shared/types/evaluations';

const methodConfig: EvaluationMethodDetails = {
  method: EvaluationMethodName.DECISION_CORRECTNESS,
  agent_types: ['decision'],
  name: 'Decision Correctness',
  description:
    "How much of its probability a decision model put on the right answers, against a judge's own answers to the same questions",
};

export const decisionCorrectnessEvaluationConnector: EvaluationMethodConnector =
  {
    getDetails: () => methodConfig,
    evaluateLog,
    getParameterSchema: DecisionCorrectnessEvaluationParameters,
    // The questions already say what a right answer is, so there is nothing
    // for a model to fill in when the evaluation is created.
  };
