import { markRequestStarted } from '@api/middlewares/logs';
import { repairClusterArms } from '@api/optimization/arm-repair';
import { handleGenerateArms } from '@api/optimization/skill-optimizations';
import type { UserDataStorageConnector } from '@api/types/connector';
import type { AppContext } from '@api/types/hono';
import {
  generateEmbeddingForRequest,
  type TextEmbedding,
} from '@api/utils/embeddings';
import {
  agentById,
  resolveEmbeddingModelConfig,
} from '@api/utils/evaluation-model-resolver';
import {
  cosineSimilarity,
  getInitialClusterCentroids,
  sampleBeta,
} from '@api/utils/math';
import { reviewerHookFor } from '@api/utils/super-agents/reviewer';
import { renderTemplate } from '@api/utils/templates';
import { error, warn } from '@shared/console-logging';
import {
  OptimizationType,
  type SuperAgentsConfig,
  SuperAgentsTarget,
  type SuperAgentsTargetPreProcessed,
  type TargetConfigurationParams,
} from '@shared/types/api/request';
import { ReasoningEffort } from '@shared/types/api/routes/shared/thinking';
import type { AIProvider } from '@shared/types/constants';
import type {
  SkillOptimizationArm,
  SkillOptimizationCluster,
} from '@shared/types/data';
import type { SkillOptimizationClusterCreateParams } from '@shared/types/data/skill-optimization-cluster';
import { HookAgentProviderConfig } from '@shared/types/middleware/hooks';
import { isOptimizedFunction } from '@shared/utils/optimized-functions';
import type { Next } from 'hono';
import { getRuntimeKey } from 'hono/adapter';
import { createMiddleware } from 'hono/factory';

/**
 * Exported for tests. This is the decision that picks which configuration
 * serves a request, and the middleware around it needs a database, an
 * embedding and a resolved skill before it is reached -- so the choice itself
 * is only reachable directly.
 */
export async function getOptimalArm(
  c: AppContext,
  arms: SkillOptimizationArm[],
  skillId: string,
  userDataStorageConnector: UserDataStorageConnector,
  explorationTemperature = 1.0,
): Promise<SkillOptimizationArm> {
  // Implement Thompson Sampling algorithm for multi-armed bandit with weighted evaluations
  // Thompson Sampling uses Bayesian approach: sample from posterior Beta distribution
  // and select the arm with highest sampled value
  //
  // The exploration_temperature parameter controls exploration/exploitation:
  // - temperature = 1.0: Standard Thompson Sampling (balanced)
  // - temperature > 1.0: More exploration (flattens distribution, takes more risks)
  // - temperature < 1.0: More exploitation (sharpens distribution, sticks to known good arms)

  // Fetch evaluations to get weights
  const evaluations =
    await userDataStorageConnector.getSkillOptimizationEvaluations(c, {
      skill_id: skillId,
    });

  // Create a map of evaluation_id -> weight
  const evaluationWeights = new Map<string, number>();
  for (const evaluation of evaluations) {
    evaluationWeights.set(evaluation.id, evaluation.weight);
  }

  let optimalArm = arms[0];
  let maxSample = -Infinity;
  const samples: {
    armId: string;
    n: number;
    weighted_mean: number;
    total_reward: number;
    alpha: number;
    beta: number;
    alpha_adjusted: number;
    beta_adjusted: number;
    baseSample: number;
    sample: number;
  }[] = [];

  for (const arm of arms) {
    // Fetch arm stats for this arm
    const armStats =
      await userDataStorageConnector.getSkillOptimizationArmStats(c, {
        arm_id: arm.id,
      });

    // Calculate weighted average mean and total reward
    let weightedMeanSum = 0;
    let totalWeight = 0;
    let totalRequests = 0;
    let weightedTotalReward = 0;

    for (const stat of armStats) {
      const weight = evaluationWeights.get(stat.evaluation_id) || 1.0;
      weightedMeanSum += stat.mean * weight;
      weightedTotalReward += stat.total_reward * weight;
      totalWeight += weight;
      // Use max n across all evaluations as the request count
      if (stat.n > totalRequests) {
        totalRequests = stat.n;
      }
    }

    // Calculate weighted mean (0 if no stats yet)
    const weightedMean = totalWeight > 0 ? weightedMeanSum / totalWeight : 0;
    const weightedReward =
      totalWeight > 0 ? weightedTotalReward / totalWeight : 0;

    // Beta distribution parameters with uniform prior (Beta(1,1))
    // alpha = successes + 1, beta = failures + 1
    const successes = weightedReward;
    const failures = totalRequests - weightedReward;
    const baseAlpha = successes + 1;
    const baseBeta = failures + 1;

    // Apply temperature to Beta parameters BEFORE sampling
    // Higher temperature (> 1) shrinks parameters toward 1, making distribution more uniform
    // Lower temperature (< 1) exaggerates parameters, making distribution more peaked
    // This is the correct way to apply temperature in Thompson Sampling
    const alpha = (baseAlpha - 1) / explorationTemperature + 1;
    const beta = (baseBeta - 1) / explorationTemperature + 1;

    const baseSample = sampleBeta(alpha, beta);
    const sample = baseSample;

    samples.push({
      armId: arm.id,
      n: totalRequests,
      weighted_mean: weightedMean,
      total_reward: weightedReward,
      alpha: baseAlpha,
      beta: baseBeta,
      alpha_adjusted: alpha,
      beta_adjusted: beta,
      baseSample,
      sample,
    });

    if (sample > maxSample) {
      maxSample = sample;
      optimalArm = arm;
    }
  }

  return optimalArm;
}

/** Exported for tests, for the same reason as `getOptimalArm`. */
export function getOptimalCluster(
  embedding: number[],
  clusters: SkillOptimizationCluster[],
): SkillOptimizationCluster {
  // Find the cluster with the highest cosine similarity to the embedding
  let optimalCluster = clusters[0];
  let maxSimilarity = -1;

  for (const cluster of clusters) {
    const similarity = cosineSimilarity(embedding, cluster.centroid);
    if (similarity > maxSimilarity) {
      maxSimilarity = similarity;
      optimalCluster = cluster;
    }
  }

  return optimalCluster;
}

/**
 * Whether a cluster's centroid can be compared with a request's embedding:
 * computed by the same model -- or by one the cluster did not record -- and
 * of the same length. A centroid from another model is not comparable even
 * at the same length, and one of another length used to throw, failing every
 * optimized request with a 500 once an agent named its own embedding model.
 */
function comparable(
  embedding: TextEmbedding,
  cluster: SkillOptimizationCluster,
): boolean {
  return (
    (!cluster.embedding_model_id ||
      cluster.embedding_model_id === embedding.modelId) &&
    cluster.centroid.length === embedding.embedding.length
  );
}

/**
 * The cluster a request belongs to, among those it can be compared with; the
 * first cluster when it can be compared with none, as for a request whose
 * embedding failed. Reclustering recomputes the centroids with the model the
 * requests are embedded with, and they are comparable again.
 */
function nearestCluster(
  embedding: TextEmbedding,
  clusters: SkillOptimizationCluster[],
): SkillOptimizationCluster {
  const candidates = clusters.filter((cluster) =>
    comparable(embedding, cluster),
  );
  if (candidates.length === 0) {
    warn(
      `[OPTIMIZER] No cluster's centroid was computed with embedding model ${embedding.modelId}; serving from the first until the skill is reclustered`,
    );
    return clusters[0];
  }
  return getOptimalCluster(embedding.embedding, candidates);
}

/**
 * The arms to serve a request matched to a cluster that has none, in a skill
 * that has models, while `repairClusterArms` gives that cluster its arms.
 *
 * The request does not wait for the repair if it does not have to: it goes to
 * the nearest cluster that can serve it -- as a request whose embedding
 * failed goes to any cluster -- and the repair finishes behind it. Only when
 * no cluster has arms does it wait, and then it is served by what the repair
 * made. None, if the repair failed.
 */
async function armsWhileRepairing(
  c: AppContext,
  connector: UserDataStorageConnector,
  skill: { id: string; name: string },
  cluster: SkillOptimizationCluster,
  clusters: SkillOptimizationCluster[],
  embedding: TextEmbedding | null,
): Promise<SkillOptimizationArm[]> {
  const repaired = repairClusterArms(c, connector, skill, cluster.id).then(
    () => true,
    (e: unknown) => {
      error(`[ARM_REPAIR] Could not repair cluster ${cluster.id}:`, e);
      return false;
    },
  );

  // Nearest first, of those the request can be compared with; the rest
  // after them, in order.
  const others = clusters.filter((other) => other.id !== cluster.id);
  if (embedding) {
    const similarity = (other: SkillOptimizationCluster) =>
      comparable(embedding, other)
        ? cosineSimilarity(embedding.embedding, other.centroid)
        : Number.NEGATIVE_INFINITY;
    others.sort((a, b) => similarity(b) - similarity(a));
  }
  for (const other of others) {
    const arms = await connector.getSkillOptimizationArms(c, {
      skill_id: skill.id,
      cluster_id: other.id,
    });
    if (arms.length > 0) {
      if (getRuntimeKey() === 'workerd') {
        c.executionCtx.waitUntil(repaired);
      }
      return arms;
    }
  }

  if (!(await repaired)) {
    return [];
  }
  return connector.getSkillOptimizationArms(c, {
    skill_id: skill.id,
    cluster_id: cluster.id,
  });
}

function getRandomValueInRange(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

const ReasoningMap: Record<number, ReasoningEffort | null> = {
  0: null,
  1: null,
  2: ReasoningEffort.MINIMAL,
  3: ReasoningEffort.MINIMAL,
  4: ReasoningEffort.LOW,
  5: ReasoningEffort.LOW,
  6: ReasoningEffort.MEDIUM,
  7: ReasoningEffort.MEDIUM,
  8: ReasoningEffort.HIGH,
  9: ReasoningEffort.HIGH,
};

function getRandomReasoningEffortFromRange(
  min: number,
  max: number,
): ReasoningEffort | null {
  const randomValue = getRandomValueInRange(min, max) * 9.9;

  const randomIndex = Math.floor(randomValue);

  return ReasoningMap[randomIndex];
}

async function validateTargetConfiguration(
  c: AppContext,
  userDataStorageConnector: UserDataStorageConnector,
  saTargetPreProcessed: SuperAgentsTargetPreProcessed,
  embedding: TextEmbedding | null,
  systemPromptVariables?: Record<string, unknown>,
): Promise<SuperAgentsTarget | Response> {
  let saTargetConfiguration: TargetConfigurationParams;
  let resolvedApiKey: string | undefined;
  let resolvedCustomHost: string | undefined;

  // Apply optimization if specified. A request the optimizer works on whose
  // embedding could not be generated -- the embedding call failed, or a
  // System One request came with no state to embed -- is still served: it
  // cannot be matched to its cluster, but any cluster's arms beat refusing
  // the request.
  const optimized = isOptimizedFunction(c.get('sa_request_data')?.functionName);
  if (
    (embedding || optimized) &&
    saTargetPreProcessed.optimization === OptimizationType.AUTO
  ) {
    try {
      const skill = c.get('skill');

      let clusters =
        await userDataStorageConnector.getSkillOptimizationClusters(c, {
          skill_id: skill.id,
        });

      // Get embedding model config for cluster centroids
      const embeddingConfig = await resolveEmbeddingModelConfig(
        c,
        userDataStorageConnector,
        await agentById(c, userDataStorageConnector, skill.agent_id),
      );

      if (clusters.length === 0) {
        // Only create clusters if embedding model is configured
        if (embeddingConfig) {
          try {
            // Create initial clusters with equally spaced centroids
            const initialCentroids = getInitialClusterCentroids(
              skill.configuration_count,
              embeddingConfig.dimensions,
            );
            const clusterParams: SkillOptimizationClusterCreateParams[] =
              initialCentroids.map((centroid, index) => ({
                agent_id: skill.agent_id,
                skill_id: skill.id,
                name: `${index + 1}`,
                total_steps: 0,
                observability_total_requests: 0,
                centroid,
                embedding_model_id: embeddingConfig.modelId,
              }));

            clusters =
              await userDataStorageConnector.createSkillOptimizationClusters(
                c,
                clusterParams,
              );

            await handleGenerateArms(c, userDataStorageConnector, skill.id);
          } catch (_error) {
            // If cluster creation fails (e.g., duplicate from concurrent request),
            // fetch the existing clusters instead
            clusters =
              await userDataStorageConnector.getSkillOptimizationClusters(c, {
                skill_id: skill.id,
              });
            // If we still have no clusters, throw the original error
            if (clusters.length === 0) {
              throw _error;
            }
          }
        }
      }

      if (clusters.length === 0) {
        return c.json(
          {
            error: `Skill ${c.get('skill').name} has no optimization clusters; configure an embedding model in system settings and try again.`,
          },
          422,
        );
      }

      const optimalCluster = embedding
        ? nearestCluster(embedding, clusters)
        : clusters[0];

      let arms = await userDataStorageConnector.getSkillOptimizationArms(c, {
        skill_id: skill.id,
        cluster_id: optimalCluster.id,
      });

      if (arms.length === 0) {
        const models = await userDataStorageConnector.getSkillModels(
          c,
          skill.id,
        );
        // A skill with models has arms in every cluster, so this cluster's
        // generation was cut short. It repairs itself.
        if (models.length > 0) {
          arms = await armsWhileRepairing(
            c,
            userDataStorageConnector,
            skill,
            optimalCluster,
            clusters,
            embedding,
          );
        }
        // A skill without models has no arms; say so instead of crashing on
        // the empty list below. The usual way here is a skill the gateway
        // created for an agent that had no default models to give it.
        if (arms.length === 0) {
          const agent = c.get('agent');
          const error =
            models.length > 0
              ? `Skill ${skill.name} has models, but no configurations could be generated to serve it. The gateway log says why; generating the skill's arms again will retry.`
              : skill.auto_created
                ? `Skill ${skill.name} was created automatically, but agent ${agent?.name ?? skill.agent_id} had no default models to give it. Add default models to the agent -- its automatic skills take them -- or attach a model to the skill, and try again.`
                : `Skill ${skill.name} has no configurations to serve an optimized request. Attach a model to the skill, or default models to its agent, and try again.`;
          return c.json({ error }, 422);
        }
      }

      const optimalArm = await getOptimalArm(
        c,
        arms,
        skill.id,
        userDataStorageConnector,
        skill.exploration_temperature,
      );

      c.set('pulled_arm', optimalArm);

      const renderedSystemPrompt = renderTemplate(
        optimalArm.params.system_prompt!,
        systemPromptVariables || {},
        skill.allowed_template_variables,
      );

      // Resolve model_id to get model name and provider
      const models = await userDataStorageConnector.getModels(c, {
        id: optimalArm.params.model_id,
      });

      if (models.length === 0) {
        return c.json(
          {
            error: `Model with ID '${optimalArm.params.model_id}' not found`,
          },
          422,
        );
      }

      const model = models[0];

      // Get the provider from the associated API key
      const apiKeyRecord =
        await userDataStorageConnector.getAIProviderAPIKeyById(
          c,
          model.ai_provider_id,
        );

      if (!apiKeyRecord) {
        return c.json(
          {
            error: `API key with ID '${model.ai_provider_id}' not found for model`,
          },
          422,
        );
      }

      resolvedApiKey = apiKeyRecord.api_key || undefined;
      resolvedCustomHost =
        (apiKeyRecord.custom_fields?.custom_host as string) || undefined;

      const reasoningEffort = getRandomReasoningEffortFromRange(
        optimalArm.params.thinking_min,
        optimalArm.params.thinking_max,
      );

      saTargetConfiguration = {
        ai_provider: apiKeyRecord.ai_provider as AIProvider,
        model: model.model_name,
        // An arm with an empty prompt has none to serve -- a new decision
        // skill, before its policy is written -- and null is how a
        // configuration says it has no system prompt.
        system_prompt: renderedSystemPrompt || null,
        temperature: getRandomValueInRange(
          optimalArm.params.temperature_min,
          optimalArm.params.temperature_max,
        ),
        top_p: getRandomValueInRange(
          optimalArm.params.top_p_min,
          optimalArm.params.top_p_max,
        ),
        frequency_penalty: getRandomValueInRange(
          optimalArm.params.frequency_penalty_min,
          optimalArm.params.frequency_penalty_max,
        ),
        presence_penalty: getRandomValueInRange(
          optimalArm.params.presence_penalty_min,
          optimalArm.params.presence_penalty_max,
        ),
        reasoning_effort: reasoningEffort,
        seed: null,
        max_tokens: null,
        additional_params: null,
        stop: null,
      };
    } catch (e) {
      error(e);
      return c.json(
        {
          error: `Failed to load optimization parameters: ${e instanceof Error ? e.message : 'Unknown error'}`,
        },
        500,
      );
    }
  } else if (saTargetPreProcessed.provider) {
    const provider = saTargetPreProcessed.provider;
    const model = saTargetPreProcessed.model;

    if (!model) {
      return c.json(
        {
          error: `model must be defined`,
        },
        422,
      );
    }

    saTargetConfiguration = {
      ai_provider: provider,
      model: model,
      system_prompt: null,
      temperature: null,
      max_tokens: null,
      top_p: null,
      frequency_penalty: null,
      presence_penalty: null,
      stop: null,
      seed: null,
      additional_params: null,
      reasoning_effort: null,
    };
  } else {
    return c.json(
      {
        error: `No configuration_name or provider defined`,
      },
      500,
    );
  }

  if (saTargetPreProcessed.api_key) {
    resolvedApiKey = saTargetPreProcessed.api_key;
  }

  const rawData = {
    ...saTargetPreProcessed,
    configuration: saTargetConfiguration,
    api_key: resolvedApiKey,
    // Use resolved custom_host from API key if available, otherwise keep any directly provided value
    custom_host: resolvedCustomHost || saTargetPreProcessed.custom_host,
    provider: undefined,
    configuration_name: undefined,
    configuration_version: undefined,
    model: undefined,
  };

  const parseResult = SuperAgentsTarget.safeParse(rawData);

  if (!parseResult.success) {
    error(
      'Error while parsing Super Agents target configuration',
      parseResult.error,
    );
    return c.json(
      {
        error: `Error while parsing Super Agents target configuration`,
      },
      500,
    );
  }

  return parseResult.data;
}

export const saConfigurationInjectorMiddleware = createMiddleware(
  async (c: AppContext, next: Next) => {
    const url = new URL(c.req.url);

    // Only set variables for API requests
    if (url.pathname.startsWith('/v1/')) {
      // Don't set variables for Super Agents API requests
      if (!url.pathname.startsWith('/v1/super-agents')) {
        const saConfigPreProcessed = c.get('sa_config_pre_processed');
        const saRequestData = c.get('sa_request_data');

        // Generate embeddings for specific endpoints
        // The embedding will be saved with the log after the request is completed
        let embedding: TextEmbedding | null = null;
        if (saRequestData && isOptimizedFunction(saRequestData.functionName)) {
          try {
            embedding = await generateEmbeddingForRequest(
              c,
              saRequestData,
              c.get('user_data_storage_connector'),
              c.get('agent') ?? null,
            );
          } catch {
            embedding = null;
          }
          c.set('embedding', embedding?.embedding ?? null);
        }

        const saTargetsOrResponses = await Promise.all(
          saConfigPreProcessed.targets.map((target) =>
            validateTargetConfiguration(
              c,
              c.get('user_data_storage_connector'),
              target,
              embedding,
              saConfigPreProcessed.system_prompt_variables,
            ),
          ),
        );

        // In case of an error return a response
        for (const saTargetOrResponse of saTargetsOrResponses) {
          if (saTargetOrResponse instanceof Response) {
            return saTargetOrResponse;
          }
        }

        const saTargets = saTargetsOrResponses.filter(
          (target) => !(target instanceof Response),
        ) as SuperAgentsTarget[];

        // The agent's reviewer, when it has one, reviews every response;
        // it is added here so that no client header can leave it out.
        const reviewerHook = await reviewerHookFor(
          c,
          c.get('user_data_storage_connector'),
          c.get('agent'),
          saConfigPreProcessed,
        );
        if (reviewerHook) {
          c.set(
            'reviewer_agent_name',
            HookAgentProviderConfig.parse(reviewerHook.config).agent_name,
          );
        }

        const saConfig: SuperAgentsConfig = {
          ...saConfigPreProcessed,
          // Filled in by `agentAndSkillMiddleware` when the caller named only
          // the agent; the skill on the context is the one it resolved.
          skill_name: saConfigPreProcessed.skill_name ?? c.get('skill').name,
          targets: saTargets,
          hooks: reviewerHook
            ? [...saConfigPreProcessed.hooks, reviewerHook]
            : saConfigPreProcessed.hooks,
        };

        c.set('sa_config', saConfig);

        // The row again, now that the request has a configuration: which one
        // was pulled, the prompt it rendered and the model that will answer.
        // Until the provider does, this is the only account of what the
        // request is being sent as.
        markRequestStarted(c);
      }
    }
    await next();
  },
);
