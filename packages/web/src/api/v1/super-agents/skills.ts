import type { SuperAgentsRoute } from '@api/v1';
import {
  Model,
  Skill,
  type SkillCreateParams,
  SkillOptimizationArm,
  SkillOptimizationEvaluationRun,
  type SkillQueryParams,
  type SkillUpdateParams,
} from '@shared/types/data';
import { SkillOptimizationArmStat } from '@shared/types/data/skill-optimization-arm-stats';
import { SkillOptimizationCluster } from '@shared/types/data/skill-optimization-cluster';
import { SkillOptimizationEvaluation } from '@shared/types/data/skill-optimization-evaluation';
import {
  EvaluationMethodDetails,
  type EvaluationMethodName,
} from '@shared/types/evaluations';
import { API_URL } from '@web/constants';
import { hc } from 'hono/client';
import { z } from 'zod';

const client = hc<SuperAgentsRoute>(API_URL, {
  init: {
    credentials: 'include',
  },
});

export async function createSkill(params: SkillCreateParams): Promise<Skill> {
  const response = await client.v1['super-agents'].skills.$post({
    json: params,
  });

  if (!response.ok) {
    throw new Error('Failed to create skill');
  }

  return Skill.parse(await response.json());
}

export async function getSkills(params: SkillQueryParams): Promise<Skill[]> {
  const query: Record<string, string> = {};

  if (params.id) query.id = params.id;
  if (params.agent_id) query.agent_id = params.agent_id;
  if (params.name) query.name = params.name;
  if (params.optimize !== undefined)
    query.optimize = params.optimize.toString();
  if (params.limit) query.limit = params.limit.toString();
  if (params.offset) query.offset = params.offset.toString();

  const response = await client.v1['super-agents'].skills.$get({
    query,
  });

  if (!response.ok) {
    throw new Error('Failed to fetch skills');
  }

  return Skill.array().parse(await response.json());
}

export async function updateSkill(
  id: string,
  params: SkillUpdateParams,
): Promise<Skill> {
  const response = await client.v1['super-agents'].skills[':skillId'].$patch({
    param: {
      skillId: id,
    },
    json: params,
  });

  if (!response.ok) {
    throw new Error('Failed to update skill');
  }

  return Skill.parse(await response.json());
}

export async function deleteSkill(id: string): Promise<void> {
  const response = await client.v1['super-agents'].skills[':skillId'].$delete({
    param: {
      skillId: id,
    },
  });

  if (!response.ok) {
    throw new Error('Failed to delete skill');
  }
}

export async function getSkillModels(skillId: string): Promise<Model[]> {
  const response = await client.v1['super-agents'].skills[
    ':skillId'
  ].models.$get({
    param: {
      skillId,
    },
  });

  if (!response.ok) {
    throw new Error('Failed to fetch models for skill');
  }

  return Model.array().parse(await response.json());
}

export async function addModelsToSkill(
  skillId: string,
  modelIds: string[],
): Promise<void> {
  const response = await client.v1['super-agents'].skills[
    ':skillId'
  ].models.$post({
    param: {
      skillId,
    },
    json: { modelIds },
  });

  if (!response.ok) {
    const data = (await response.json()) as { error?: string };
    throw new Error(data.error || 'Failed to add models to skill');
  }
}

export async function removeModelsFromSkill(
  skillId: string,
  modelIds: string[],
): Promise<void> {
  const response = await client.v1['super-agents'].skills[
    ':skillId'
  ].models.$delete({
    param: {
      skillId,
    },
    query: { ids: modelIds.join(',') },
  });

  if (!response.ok) {
    const data = (await response.json()) as { error?: string };
    throw new Error(data.error || 'Failed to remove models from skill');
  }
}

export async function getSkillClusterStates(
  skillId: string,
): Promise<SkillOptimizationCluster[]> {
  const response = await client.v1['super-agents'].skills[
    ':skillId'
  ].clusters.$get({
    param: {
      skillId,
    },
  });

  if (!response.ok) {
    throw new Error('Failed to fetch cluster states for skill');
  }

  return SkillOptimizationCluster.array().parse(await response.json());
}

export async function getSkillArms(
  skillId: string,
): Promise<SkillOptimizationArm[]> {
  const response = await client.v1['super-agents'].skills[':skillId'].arms.$get(
    {
      param: {
        skillId,
      },
    },
  );

  if (!response.ok) {
    throw new Error('Failed to fetch skill arms');
  }

  return SkillOptimizationArm.array().parse(await response.json());
}

export async function getSkillArmStats(
  skillId: string,
): Promise<SkillOptimizationArmStat[]> {
  const response = await client.v1['super-agents'].skills[':skillId'][
    'arm-stats'
  ].$get({
    param: {
      skillId,
    },
  });

  if (!response.ok) {
    throw new Error('Failed to fetch skill arm stats');
  }

  return SkillOptimizationArmStat.array().parse(await response.json());
}

export async function generateSkillArms(
  skillId: string,
): Promise<SkillOptimizationArm[]> {
  const response = await client.v1['super-agents'].skills[':skillId'][
    'generate-arms'
  ].$post({
    param: {
      skillId,
    },
  });

  if (!response.ok) {
    throw new Error('Failed to generate skill arms');
  }

  return SkillOptimizationArm.array().parse(await response.json());
}

export async function getSkillEvaluationRuns(
  skillId: string,
  logId?: string,
): Promise<SkillOptimizationEvaluationRun[]> {
  const query: Record<string, string> = {};
  if (logId) query.log_id = logId;

  const response = await client.v1['super-agents'].skills[':skillId'][
    'evaluation-runs'
  ].$get({
    param: {
      skillId,
    },
    query,
  });

  if (!response.ok) {
    throw new Error('Failed to fetch evaluation runs');
  }

  return SkillOptimizationEvaluationRun.array().parse(await response.json());
}

export async function getSkillEvaluationScoresByTimeBucket(
  skillId: string,
  params: {
    cluster_id?: string;
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

  const response = await client.v1['super-agents'].skills[':skillId'][
    'evaluation-scores-by-time-bucket'
  ].$post({
    param: {
      skillId,
    },
    json: params,
  });

  if (!response.ok) {
    throw new Error('Failed to fetch skill evaluation scores by time bucket');
  }

  const z = await import('zod');
  return z.z
    .array(EvaluationScoresByTimeBucketResult)
    .parse(await response.json());
}

export async function getEvaluationMethods(): Promise<
  EvaluationMethodDetails[]
> {
  const response = await client.v1['super-agents']['evaluation-methods'].$get();

  if (!response.ok) {
    throw new Error('Failed to fetch evaluation methods');
  }

  return z.array(EvaluationMethodDetails).parse(await response.json());
}

export async function getSkillEvaluations(
  skillId: string,
): Promise<SkillOptimizationEvaluation[]> {
  const response = await client.v1['super-agents'].skills[
    ':skillId'
  ].evaluations.$get({
    param: {
      skillId,
    },
  });

  if (!response.ok) {
    throw new Error('Failed to fetch skill evaluations');
  }

  return SkillOptimizationEvaluation.array().parse(await response.json());
}

export async function createSkillEvaluation(
  skillId: string,
  methods: EvaluationMethodName[],
): Promise<SkillOptimizationEvaluation[]> {
  const response = await client.v1['super-agents'].skills[
    ':skillId'
  ].evaluations.$post({
    param: {
      skillId,
    },
    json: {
      methods,
    },
  });

  if (!response.ok) {
    throw new Error('Failed to create skill evaluation');
  }

  return SkillOptimizationEvaluation.array().parse(await response.json());
}

export async function updateSkillEvaluation(
  skillId: string,
  evaluationId: string,
  params: {
    weight: number;
    params?: Record<string, unknown>;
    model_id?: string | null;
  },
): Promise<SkillOptimizationEvaluation> {
  const response = await client.v1['super-agents'].skills[
    ':skillId'
  ].evaluations[':evaluationId'].$patch({
    param: {
      skillId,
      evaluationId,
    },
    json: params,
  });

  if (!response.ok) {
    const errorData = await response.json();
    const errorMessage =
      (errorData as { details?: string })?.details ||
      (errorData as { error?: string })?.error ||
      'Failed to update skill evaluation';
    throw new Error(errorMessage);
  }

  return SkillOptimizationEvaluation.parse(await response.json());
}

export async function deleteSkillEvaluation(
  skillId: string,
  evaluationId: string,
): Promise<void> {
  const response = await client.v1['super-agents'].skills[
    ':skillId'
  ].evaluations[':evaluationId'].$delete({
    param: {
      skillId,
      evaluationId,
    },
  });

  if (!response.ok) {
    throw new Error('Failed to delete skill evaluation');
  }
}

export async function resetCluster(
  skillId: string,
  clusterId: string,
  clearObservabilityCount = false,
): Promise<void> {
  const response = await client.v1['super-agents'].skills[':skillId'].clusters[
    ':clusterId'
  ].reset.$post({
    param: {
      skillId,
      clusterId,
    },
    query: {
      clearObservabilityCount: clearObservabilityCount.toString(),
    },
  });

  if (!response.ok) {
    throw new Error('Failed to reset cluster');
  }
}

export async function resetSkill(
  skillId: string,
  clearObservabilityCount = false,
): Promise<void> {
  const response = await client.v1['super-agents'].skills[
    ':skillId'
  ].reset.$post({
    param: {
      skillId,
    },
    query: {
      clearObservabilityCount: clearObservabilityCount.toString(),
    },
  });

  if (!response.ok) {
    throw new Error('Failed to reset skill');
  }
}
