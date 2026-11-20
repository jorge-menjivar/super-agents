import { z } from 'zod';
import { AgentType } from './data/agent';

export enum EvaluationMethodName {
  TASK_COMPLETION = 'task_completion',
  ARGUMENT_CORRECTNESS = 'argument_correctness',
  ROLE_ADHERENCE = 'role_adherence',
  TURN_RELEVANCY = 'turn_relevancy',
  TOOL_CORRECTNESS = 'tool_correctness',
  KNOWLEDGE_RETENTION = 'knowledge_retention',
  CONVERSATION_COMPLETENESS = 'conversation_completeness',
  LATENCY = 'latency',
  DECISION_CORRECTNESS = 'decision_correctness',
}

export const EvaluationMethodDetails = z.object({
  method: z.enum(EvaluationMethodName),
  name: z.string(),
  description: z.string(),
  /**
   * The agents whose skills the method can judge. A method reads what the
   * skill's requests are: a conversation judge has nothing to read in a
   * decision model's probabilities, and a decision judge nothing in a
   * conversation. Latency reads only timing, which both have.
   */
  agent_types: z.array(AgentType).min(1),
  parameterSchema: z.record(z.string(), z.unknown()).optional(), // JSON representation of the schema shape
});
export type EvaluationMethodDetails = z.infer<typeof EvaluationMethodDetails>;

/** Whether a method can judge the skills of an agent of this type. */
export function evaluationMethodAppliesTo(
  details: Pick<EvaluationMethodDetails, 'agent_types'>,
  agentType: AgentType,
): boolean {
  return details.agent_types.includes(agentType);
}
