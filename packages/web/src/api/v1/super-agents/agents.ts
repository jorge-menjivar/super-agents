import type { SuperAgentsRoute } from '@api/v1';
import {
  Agent,
  type AgentCreateParams,
  type AgentQueryParams,
  type AgentUpdateParams,
  Model,
  SkillOptimizationEvaluationRun,
} from '@shared/types/data';
import { API_URL } from '@web/constants';
import { hc } from 'hono/client';

const client = hc<SuperAgentsRoute>(API_URL, {
  init: {
    credentials: 'include',
  },
});

export async function createAgent(params: AgentCreateParams): Promise<Agent> {
  const response = await client.v1['super-agents'].agents.$post({
    json: params,
  });

  if (!response.ok) {
    throw new Error('Failed to create agent');
  }

  return Agent.parse(await response.json());
}

export async function getAgents(params: AgentQueryParams): Promise<Agent[]> {
  const response = await client.v1['super-agents'].agents.$get({
    query: {
      id: params.id,
      name: params.name,
      limit: params.limit?.toString(),
      offset: params.offset?.toString(),
    },
  });

  if (!response.ok) {
    throw new Error('Failed to fetch agents');
  }

  return Agent.array().parse(await response.json());
}

export async function updateAgent(
  agentId: string,
  params: AgentUpdateParams,
): Promise<Agent> {
  const response = await client.v1['super-agents'].agents[':agentId'].$patch({
    param: {
      agentId: agentId,
    },
    json: params,
  });

  if (!response.ok) {
    throw new Error('Failed to update agent');
  }

  return Agent.parse(await response.json());
}

export async function deleteAgent(id: string): Promise<void> {
  const response = await client.v1['super-agents'].agents[':agentId'].$delete({
    param: {
      agentId: id,
    },
  });

  if (!response.ok) {
    throw new Error('Failed to delete agent');
  }
}

export async function getAgentEvaluationRuns(
  agentId: string,
  logId?: string,
): Promise<SkillOptimizationEvaluationRun[]> {
  const query: Record<string, string> = {};
  if (logId) query.log_id = logId;

  const response = await client.v1['super-agents'].agents[':agentId'][
    'evaluation-runs'
  ].$get({
    param: {
      agentId,
    },
    query,
  });

  if (!response.ok) {
    throw new Error('Failed to fetch agent evaluation runs');
  }

  return SkillOptimizationEvaluationRun.array().parse(await response.json());
}

export async function getAgentEvaluationScoresByTimeBucket(
  agentId: string,
  params: {
    interval_minutes: number;
    start_time: string;
    end_time: string;
    /** Also the bucket nearest outside each end, so a line can cross an edge */
    include_edge_buckets?: boolean;
  },
): Promise<
  import('@shared/types/data/evaluation-runs-with-scores').EvaluationScoresByTimeBucketResult[]
> {
  const { EvaluationScoresByTimeBucketResult } = await import(
    '@shared/types/data/evaluation-runs-with-scores'
  );

  const response = await client.v1['super-agents'].agents[':agentId'][
    'evaluation-scores-by-time-bucket'
  ].$post({
    param: {
      agentId,
    },
    json: params,
  });

  if (!response.ok) {
    throw new Error('Failed to fetch agent evaluation scores by time bucket');
  }

  const z = await import('zod');
  return z.z
    .array(EvaluationScoresByTimeBucketResult)
    .parse(await response.json());
}

/** The agent's default models: what a skill the gateway creates for it starts with. */
export async function getAgentModels(agentId: string): Promise<Model[]> {
  const response = await client.v1['super-agents'].agents[
    ':agentId'
  ].models.$get({ param: { agentId } });

  if (!response.ok) {
    throw new Error('Failed to fetch models for agent');
  }

  return Model.array().parse(await response.json());
}

export async function addModelsToAgent(
  agentId: string,
  modelIds: string[],
): Promise<void> {
  const response = await client.v1['super-agents'].agents[
    ':agentId'
  ].models.$post({
    param: { agentId },
    json: { modelIds },
  });

  if (!response.ok) {
    const data = (await response.json()) as { error?: string };
    throw new Error(data.error || 'Failed to add models to agent');
  }
}

export async function removeModelsFromAgent(
  agentId: string,
  modelIds: string[],
): Promise<void> {
  const response = await client.v1['super-agents'].agents[
    ':agentId'
  ].models.$delete({
    param: { agentId },
    query: { ids: modelIds.join(',') },
  });

  if (!response.ok) {
    const data = (await response.json()) as { error?: string };
    throw new Error(data.error || 'Failed to remove models from agent');
  }
}
