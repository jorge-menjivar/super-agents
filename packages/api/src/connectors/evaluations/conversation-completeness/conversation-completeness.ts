import {
  ConversationCompletenessEvaluationAIParameters,
  ConversationCompletenessEvaluationParameters,
} from '@api/connectors/evaluations/conversation-completeness/types';
import type { EvaluationMethodConnector } from '@api/types/connector';
import {
  type EvaluationMethodDetails,
  EvaluationMethodName,
} from '@shared/types/evaluations';
import { evaluateLog } from './service/evaluate';

// Simplified method configuration constant - only essential fields for standardization
const conversationCompletenessMethodConfig: EvaluationMethodDetails = {
  method: EvaluationMethodName.CONVERSATION_COMPLETENESS,
  agent_types: ['text'],
  name: 'Conversation Completeness',
  description:
    'Evaluates how well an AI assistant completes conversations by satisfying user needs throughout the interaction',
} as const;

// Evaluation connector constant
export const conversationCompletenessEvaluationConnector: EvaluationMethodConnector =
  {
    getDetails: () => conversationCompletenessMethodConfig,
    evaluateLog,
    getParameterSchema: ConversationCompletenessEvaluationParameters,
    getAIParameterSchema: ConversationCompletenessEvaluationAIParameters,
  };
