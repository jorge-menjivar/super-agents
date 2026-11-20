import {
  KnowledgeRetentionEvaluationAIParameters,
  KnowledgeRetentionEvaluationParameters,
} from '@api/connectors/evaluations/knowledge-retention/types';
import type { EvaluationMethodConnector } from '@api/types/connector';
import {
  type EvaluationMethodDetails,
  EvaluationMethodName,
} from '@shared/types/evaluations';
import { evaluateLog } from './service/evaluate';

// Simplified method configuration constant - only essential fields for standardization
const knowledgeRetentionMethodConfig: EvaluationMethodDetails = {
  method: EvaluationMethodName.KNOWLEDGE_RETENTION,
  agent_types: ['text'],
  name: 'Knowledge Retention',
  description:
    'Evaluates how well an AI system retains and recalls information from provided context',
} as const;

// Evaluation connector constant
export const knowledgeRetentionEvaluationConnector: EvaluationMethodConnector =
  {
    getDetails: () => knowledgeRetentionMethodConfig,
    evaluateLog,
    getParameterSchema: KnowledgeRetentionEvaluationParameters,
    getAIParameterSchema: KnowledgeRetentionEvaluationAIParameters,
  };
