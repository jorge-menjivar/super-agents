import { evaluateLog } from '@api/connectors/evaluations/task-completion/service/evaluate';
import {
  TaskCompletionEvaluationAIParameters,
  TaskCompletionEvaluationParameters,
} from '@api/connectors/evaluations/task-completion/types';
import type { EvaluationMethodConnector } from '@api/types/connector';
import {
  type EvaluationMethodDetails,
  EvaluationMethodName,
} from '@shared/types/evaluations';

// Simplified method configuration constant - only essential fields for standardization
const taskCompletionMethodConfig: EvaluationMethodDetails = {
  method: EvaluationMethodName.TASK_COMPLETION,
  agent_types: ['text'],
  name: 'Task Completion',
  description:
    'Evaluates whether an AI agent successfully completed a given task using LLM-as-a-judge',
} as const;

// Evaluation connector constant
export const taskCompletionEvaluationConnector: EvaluationMethodConnector = {
  getDetails: () => taskCompletionMethodConfig,
  evaluateLog,
  getParameterSchema: TaskCompletionEvaluationParameters,
  getAIParameterSchema: TaskCompletionEvaluationAIParameters,
};
