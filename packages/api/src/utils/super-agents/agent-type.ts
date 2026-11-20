import type { UserDataStorageConnector } from '@api/types/connector';
import type { AppContext } from '@api/types/hono';
import { FunctionName } from '@shared/types/api/request/function-name';
import type { Agent, AgentType } from '@shared/types/data/agent';

/**
 * An agent is served by models of one type, `agent.agent_type`: its default
 * models and its skills' models are all of it, and it answers only the
 * requests those models can. The database refuses a serving model of the
 * wrong type (`agent_models_validate_type`, `skill_models_validate_type`);
 * these are the readable answers, given before it has to.
 */

const PRETTY_AGENT_TYPE: Record<AgentType, string> = {
  text: 'an LLM agent',
  decision: 'a decision agent',
};

/**
 * The type of agent a gateway request is for, or null when the request says
 * nothing about it: an embedding, say, sent with a target of its own.
 */
export function agentTypeFor(functionName: FunctionName): AgentType | null {
  switch (functionName) {
    case FunctionName.CHAT_COMPLETE:
    case FunctionName.STREAM_CHAT_COMPLETE:
    case FunctionName.COMPLETE:
    case FunctionName.STREAM_COMPLETE:
    case FunctionName.CREATE_MODEL_RESPONSE:
      return 'text';
    case FunctionName.SYSTEM_ONE:
      return 'decision';
    default:
      return null;
  }
}

/**
 * Why this agent cannot answer a request of this kind, or null when it can.
 * A decision agent has no model that writes, and an LLM agent none that
 * answers System One, so the request would otherwise fail deep in the
 * handler, at whichever arm it drew, as a provider that does not support it.
 */
export function requestTypeProblem(
  agent: Pick<Agent, 'name' | 'agent_type'>,
  functionName: FunctionName,
): string | null {
  const wanted = agentTypeFor(functionName);
  if (wanted === null || wanted === agent.agent_type) {
    return null;
  }
  return wanted === 'decision'
    ? `Agent "${agent.name}" is ${PRETTY_AGENT_TYPE[agent.agent_type]}, and System One requests are for decision agents.`
    : `Agent "${agent.name}" is ${PRETTY_AGENT_TYPE[agent.agent_type]}; ask it through /v1/systemone.`;
}

/**
 * Why these models cannot serve this agent, or null when they all can.
 */
export async function servingModelsProblem(
  c: AppContext,
  connector: UserDataStorageConnector,
  agent: Pick<Agent, 'name' | 'agent_type'>,
  modelIds: string[],
): Promise<string | null> {
  for (const id of modelIds) {
    const [model] = await connector.getModels(c, { id });
    if (!model) {
      return `Model ${id} does not exist.`;
    }
    if (model.model_type !== agent.agent_type) {
      return `"${model.model_name}" is a ${model.model_type} model, and agent "${agent.name}" is ${PRETTY_AGENT_TYPE[agent.agent_type]}, served by ${agent.agent_type} models.`;
    }
  }
  return null;
}

/**
 * Why this agent's type cannot change, or null when it can: an agent with
 * models, its own or its skills', keeps the type they are of.
 */
export async function agentTypeChangeProblem(
  c: AppContext,
  connector: UserDataStorageConnector,
  agent: Pick<Agent, 'id' | 'agent_type'>,
  agentType: AgentType | undefined,
): Promise<string | null> {
  if (agentType === undefined || agentType === agent.agent_type) {
    return null;
  }
  const own = await connector.getAgentModels(c, agent.id);
  if (own.length > 0) {
    return 'An agent with default models keeps its type; remove them first.';
  }
  const skills = await connector.getSkills(c, { agent_id: agent.id });
  for (const skill of skills) {
    if ((await connector.getSkillModels(c, skill.id)).length > 0) {
      return 'An agent whose skills have models keeps its type; remove them first.';
    }
  }
  return null;
}
