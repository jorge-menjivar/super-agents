import type { EvaluationMethodConnector } from '@api/types/connector';
import type { AgentType } from '@shared/types/data/agent';
import {
  type EvaluationMethodName,
  evaluationMethodAppliesTo,
} from '@shared/types/evaluations';

/**
 * The evaluation methods that can judge the skills of an agent of this type,
 * keyed as the connectors map is. A skill is given every method that can read
 * its requests -- a conversation's judges for an LLM agent, the decision judge
 * for a decision agent -- and none that would read nothing.
 */
export function evaluationConnectorsFor(
  connectorsMap: Record<string, EvaluationMethodConnector>,
  agentType: AgentType,
): [EvaluationMethodName, EvaluationMethodConnector][] {
  return (
    Object.entries(connectorsMap) as [
      EvaluationMethodName,
      EvaluationMethodConnector,
    ][]
  ).filter(([, connector]) =>
    evaluationMethodAppliesTo(connector.getDetails(), agentType),
  );
}
