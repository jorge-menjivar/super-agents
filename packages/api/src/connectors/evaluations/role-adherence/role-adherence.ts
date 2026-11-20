import { evaluateLog } from '@api/connectors/evaluations/role-adherence/service/evaluate';
import {
  RoleAdherenceEvaluationAIParameters,
  RoleAdherenceEvaluationParameters,
} from '@api/connectors/evaluations/role-adherence/types';
import type { EvaluationMethodConnector } from '@api/types/connector';
import {
  type EvaluationMethodDetails,
  EvaluationMethodName,
} from '@shared/types/evaluations';

const roleAdherenceMethodConfig: EvaluationMethodDetails = {
  method: EvaluationMethodName.ROLE_ADHERENCE,
  agent_types: ['text'],
  name: 'Role Adherence',
  description:
    'Evaluates whether assistant output adheres to a specified role and constraints using LLM-as-a-judge',
} as const;

export const roleAdherenceEvaluationConnector: EvaluationMethodConnector = {
  getDetails: () => roleAdherenceMethodConfig,
  evaluateLog,
  getParameterSchema: RoleAdherenceEvaluationParameters,
  getAIParameterSchema: RoleAdherenceEvaluationAIParameters,
};
