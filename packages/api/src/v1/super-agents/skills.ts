import { handleGenerateArms } from '@api/optimization/skill-optimizations';
import { generateEvaluationCreateParams } from '@api/optimization/utils/evaluations';
import type { AppEnv } from '@api/types/hono';
import { parseDatabaseError } from '@api/utils/database-error';
import {
  agentById,
  resolveEmbeddingModelConfig,
} from '@api/utils/evaluation-model-resolver';
import { getInitialClusterCentroids } from '@api/utils/math';
import { emitSSEEvent } from '@api/utils/sse-event-manager';
import { zValidator } from '@hono/zod-validator';
import type { SkillOptimizationClusterCreateParams } from '@shared/types/data';
import {
  SkillCreateParams,
  SkillQueryParams,
  SkillUpdateParams,
} from '@shared/types/data/skill';
import { SkillEventType } from '@shared/types/data/skill-event';
import { SkillOptimizationEvaluationUpdateParams } from '@shared/types/data/skill-optimization-evaluation';
import { EvaluationMethodName } from '@shared/types/evaluations';
import { Hono } from 'hono';
import { z } from 'zod';

const ResetQuerySchema = z.object({
  clearObservabilityCount: z
    .string()
    .optional()
    .transform((val) => val === 'true'),
});

export const skillsRouter = new Hono<AppEnv>()
  .post('/', zValidator('json', SkillCreateParams), async (c) => {
    try {
      const data = c.req.valid('json');
      const userDataStorageConnector = c.get('user_data_storage_connector');

      const newSkill = await userDataStorageConnector.createSkill(c, data);

      // Centroids belong to the skill, so they are computed with the model
      // its agent embeds by -- the same one that will score its requests.
      const embeddingConfig = await resolveEmbeddingModelConfig(
        c,
        userDataStorageConnector,
        await agentById(c, userDataStorageConnector, newSkill.agent_id),
      );

      // Only create clusters if embedding model is configured
      if (embeddingConfig) {
        const initialCentroids = getInitialClusterCentroids(
          newSkill.configuration_count,
          embeddingConfig.dimensions,
        );
        const clusterParams: SkillOptimizationClusterCreateParams[] =
          initialCentroids.map((centroid, index) => ({
            agent_id: newSkill.agent_id,
            skill_id: newSkill.id,
            name: `${index + 1}`,
            total_steps: 0,
            observability_total_requests: 0,
            centroid,
            embedding_model_id: embeddingConfig.modelId,
          }));

        await userDataStorageConnector.createSkillOptimizationClusters(
          c,
          clusterParams,
        );
      }

      return c.json(newSkill, 201);
    } catch (error) {
      console.error('Error creating skill:', error);
      const errorInfo = parseDatabaseError(error);
      return c.json({ error: errorInfo.message }, errorInfo.statusCode);
    }
  })
  .get('/', zValidator('query', SkillQueryParams), async (c) => {
    try {
      const query = c.req.valid('query');
      const connector = c.get('user_data_storage_connector');

      const skills = await connector.getSkills(c, query);

      return c.json(skills, 200);
    } catch (error) {
      console.error('Error fetching skills:', error);
      const errorInfo = parseDatabaseError(error);
      return c.json({ error: errorInfo.message }, errorInfo.statusCode);
    }
  })
  .patch(
    '/:skillId',
    zValidator('param', z.object({ skillId: z.uuid() })),
    zValidator('json', SkillUpdateParams),
    async (c) => {
      try {
        const { skillId } = c.req.valid('param');
        const data = c.req.valid('json');
        const userDataStorageConnector = c.get('user_data_storage_connector');

        // Get the current skill for comparison
        const currentSkill = await userDataStorageConnector.getSkills(c, {
          id: skillId,
        });
        if (currentSkill.length === 0) {
          return c.json({ error: 'Skill not found' }, 404);
        }
        const skill = currentSkill[0];

        // If description actually changes, reset evaluation regeneration
        // so that early regeneration happens again with the new description
        const descriptionChanged =
          data.description !== undefined &&
          data.description !== skill.description;

        if (descriptionChanged) {
          await userDataStorageConnector.updateSkill(c, skillId, {
            evaluations_regenerated_at: null,
          });

          // Create event for description update
          await userDataStorageConnector.createSkillEvent(c, {
            agent_id: skill.agent_id,
            skill_id: skillId,
            cluster_id: null, // Skill-wide event
            event_type: SkillEventType.DESCRIPTION_UPDATED,
            metadata: {
              old_description: skill.description || '',
              new_description: data.description,
            },
          });
        }

        // If optimization status changes, create event
        if (data.optimize !== undefined && data.optimize !== skill.optimize) {
          await userDataStorageConnector.createSkillEvent(c, {
            agent_id: skill.agent_id,
            skill_id: skillId,
            cluster_id: null, // Skill-wide event
            event_type: data.optimize
              ? SkillEventType.OPTIMIZATION_ENABLED
              : SkillEventType.OPTIMIZATION_DISABLED,
            metadata: {},
          });
        }

        const updatedSkill = await userDataStorageConnector.updateSkill(
          c,
          skillId,
          data,
        );

        // Only reset clusters if configuration_count (partition count) actually changed
        const configurationCountChanged =
          data.configuration_count !== undefined &&
          data.configuration_count !== skill.configuration_count;

        if (configurationCountChanged) {
          const currentClusters =
            await userDataStorageConnector.getSkillOptimizationClusters(c, {
              skill_id: updatedSkill.id,
            });

          // Delete old clusters (observability counts will reset since the cluster definitions changed)
          // Skill-level total_requests counter preserves lifetime statistics
          for (const cluster of currentClusters) {
            await userDataStorageConnector.deleteSkillOptimizationCluster(
              c,
              cluster.id,
            );
          }

          // Get embedding model config for cluster centroids
          const embeddingConfig = await resolveEmbeddingModelConfig(
            c,
            userDataStorageConnector,
            await agentById(c, userDataStorageConnector, skill.agent_id),
          );

          // Only create clusters if embedding model is configured
          if (embeddingConfig) {
            const initialCentroids = getInitialClusterCentroids(
              updatedSkill.configuration_count,
              embeddingConfig.dimensions,
            );
            const clusterParams: SkillOptimizationClusterCreateParams[] =
              initialCentroids.map((centroid, index) => ({
                agent_id: updatedSkill.agent_id,
                skill_id: updatedSkill.id,
                name: `${index + 1}`,
                total_steps: 0,
                observability_total_requests: 0, // Reset to 0 since this is a new cluster configuration
                centroid,
                embedding_model_id: embeddingConfig.modelId,
              }));

            await userDataStorageConnector.createSkillOptimizationClusters(
              c,
              clusterParams,
            );
          }

          // Create event for partition reclustering
          await userDataStorageConnector.createSkillEvent(c, {
            agent_id: updatedSkill.agent_id,
            skill_id: skillId,
            cluster_id: null, // Skill-wide event
            event_type: SkillEventType.PARTITIONS_RECLUSTERED,
            metadata: {
              old_count: skill.configuration_count,
              new_count: data.configuration_count,
            },
          });
        }

        // Regenerate arms if description or partition count changed
        const shouldRegenerateArms =
          descriptionChanged || configurationCountChanged;

        if (shouldRegenerateArms) {
          await handleGenerateArms(c, userDataStorageConnector, skillId);
        }

        // Emit SSE event for skill update
        emitSSEEvent('skill:updated', {
          skillId: updatedSkill.id,
          agentId: updatedSkill.agent_id,
        });

        return c.json(updatedSkill, 200);
      } catch (error) {
        console.error('Error updating skill:', error);
        const errorInfo = parseDatabaseError(error);
        return c.json({ error: errorInfo.message }, errorInfo.statusCode);
      }
    },
  )
  .delete(
    '/:skillId',
    zValidator('param', z.object({ skillId: z.uuid() })),
    async (c) => {
      try {
        const { skillId } = c.req.valid('param');
        const connector = c.get('user_data_storage_connector');

        await connector.deleteSkill(c, skillId);

        return c.body(null, 204);
      } catch (error) {
        console.error('Error deleting skill:', error);
        const errorInfo = parseDatabaseError(error);
        return c.json({ error: errorInfo.message }, errorInfo.statusCode);
      }
    },
  )
  .get(
    '/:skillId/models',
    zValidator('param', z.object({ skillId: z.uuid() })),
    async (c) => {
      try {
        const { skillId } = c.req.valid('param');
        const connector = c.get('user_data_storage_connector');

        const models = await connector.getSkillModels(c, skillId);

        return c.json(models);
      } catch (error) {
        console.error('Error fetching models for skill:', error);
        const errorInfo = parseDatabaseError(error);
        return c.json({ error: errorInfo.message }, errorInfo.statusCode);
      }
    },
  )
  .post(
    '/:skillId/models',
    zValidator('param', z.object({ skillId: z.uuid() })),
    zValidator('json', z.object({ modelIds: z.array(z.uuid()) })),
    async (c) => {
      try {
        const { skillId } = c.req.valid('param');
        const { modelIds } = c.req.valid('json');
        const connector = c.get('user_data_storage_connector');

        // Get skill to get agent_id
        const skills = await connector.getSkills(c, { id: skillId });
        if (skills.length === 0) {
          return c.json({ error: 'Skill not found' }, 404);
        }
        const skill = skills[0];

        await connector.addModelsToSkill(c, skillId, modelIds);

        // Create events for each model added
        // Get model details after adding
        for (const modelId of modelIds) {
          const models = await connector.getModels(c, { id: modelId });
          if (models.length > 0) {
            const model = models[0];
            await connector.createSkillEvent(c, {
              agent_id: skill.agent_id,
              skill_id: skillId,
              cluster_id: null, // Skill-wide event
              event_type: SkillEventType.MODEL_ADDED,
              metadata: {
                model_id: model.id,
                model_name: model.model_name,
              },
            });
          }
        }

        await handleGenerateArms(c, connector, skillId);

        return c.json({ success: true }, 201);
      } catch (error) {
        console.error('Error adding models to skill:', error);
        const errorInfo = parseDatabaseError(error);
        return c.json({ error: errorInfo.message }, errorInfo.statusCode);
      }
    },
  )
  .delete(
    '/:skillId/models',
    zValidator('param', z.object({ skillId: z.uuid() })),
    zValidator(
      'query',
      z.object({
        ids: z
          .string()
          .or(z.array(z.string()))
          .transform((val) => {
            // Handle both comma-separated string and array formats
            if (typeof val === 'string') {
              return val.split(',').map((id) => id.trim());
            }
            return val;
          })
          .pipe(z.array(z.uuid())),
      }),
    ),
    async (c) => {
      try {
        const { skillId } = c.req.valid('param');
        const { ids } = c.req.valid('query');
        const connector = c.get('user_data_storage_connector');

        // Get skill to get agent_id
        const skills = await connector.getSkills(c, { id: skillId });
        if (skills.length === 0) {
          return c.json({ error: 'Skill not found' }, 404);
        }
        const skill = skills[0];

        // Get model details before removing for event metadata
        const models = await connector.getSkillModels(c, skillId);
        const removedModels = models.filter((m) => ids.includes(m.id));

        await connector.removeModelsFromSkill(c, skillId, ids);

        // Create events for each model removed
        for (const model of removedModels) {
          await connector.createSkillEvent(c, {
            agent_id: skill.agent_id,
            skill_id: skillId,
            cluster_id: null, // Skill-wide event
            event_type: SkillEventType.MODEL_REMOVED,
            metadata: {
              model_id: model.id,
              model_name: model.model_name,
            },
          });
        }

        await handleGenerateArms(c, connector, skillId);

        return c.json({ success: true });
      } catch (error) {
        console.error('Error removing models from skill:', error);
        const errorInfo = parseDatabaseError(error);
        return c.json({ error: errorInfo.message }, errorInfo.statusCode);
      }
    },
  )
  .get(
    '/:skillId/clusters',
    zValidator('param', z.object({ skillId: z.uuid() })),
    async (c) => {
      try {
        const { skillId } = c.req.valid('param');
        const connector = c.get('user_data_storage_connector');

        const clusters = await connector.getSkillOptimizationClusters(c, {
          skill_id: skillId,
        });

        return c.json(clusters);
      } catch (error) {
        console.error('Error getting clusters for skill:', error);
        const errorInfo = parseDatabaseError(error);
        return c.json({ error: errorInfo.message }, errorInfo.statusCode);
      }
    },
  )
  .get(
    '/:skillId/arms',
    zValidator('param', z.object({ skillId: z.uuid() })),
    async (c) => {
      try {
        const { skillId } = c.req.valid('param');
        const connector = c.get('user_data_storage_connector');

        const arms = await connector.getSkillOptimizationArms(c, {
          skill_id: skillId,
        });

        return c.json(arms);
      } catch (error) {
        console.error('Error getting models for skill:', error);
        const errorInfo = parseDatabaseError(error);
        return c.json({ error: errorInfo.message }, errorInfo.statusCode);
      }
    },
  )
  .get(
    '/:skillId/arm-stats',
    zValidator('param', z.object({ skillId: z.uuid() })),
    async (c) => {
      try {
        const { skillId } = c.req.valid('param');
        const connector = c.get('user_data_storage_connector');

        const armStats = await connector.getSkillOptimizationArmStats(c, {
          skill_id: skillId,
        });

        return c.json(armStats);
      } catch (error) {
        console.error('Error getting arm stats for skill:', error);
        const errorInfo = parseDatabaseError(error);
        return c.json({ error: errorInfo.message }, errorInfo.statusCode);
      }
    },
  )
  .post(
    '/:skillId/generate-arms',
    zValidator('param', z.object({ skillId: z.uuid() })),
    async (c) => {
      try {
        const { skillId } = c.req.valid('param');
        const connector = c.get('user_data_storage_connector');

        return await handleGenerateArms(c, connector, skillId);
      } catch (error) {
        console.error('Error generating arms:', error);
        const errorInfo = parseDatabaseError(error);
        return c.json({ error: errorInfo.message }, errorInfo.statusCode);
      }
    },
  )
  .get(
    '/:skillId/evaluation-runs',
    zValidator('param', z.object({ skillId: z.uuid() })),
    zValidator(
      'query',
      z.object({
        log_id: z.uuid().optional(),
        created_after: z.string().datetime().optional(),
        created_before: z.string().datetime().optional(),
      }),
    ),
    async (c) => {
      try {
        const { skillId } = c.req.valid('param');
        const { log_id, created_after, created_before } = c.req.valid('query');
        const connector = c.get('user_data_storage_connector');

        const evaluationRuns =
          await connector.getSkillOptimizationEvaluationRuns(c, {
            skill_id: skillId,
            ...(log_id && { log_id }),
            ...(created_after && { created_after }),
            ...(created_before && { created_before }),
          });

        return c.json(evaluationRuns);
      } catch (error) {
        console.error('Error getting evaluation runs:', error);
        const errorInfo = parseDatabaseError(error);
        return c.json({ error: errorInfo.message }, errorInfo.statusCode);
      }
    },
  )
  .post(
    '/:skillId/evaluation-scores-by-time-bucket',
    zValidator('param', z.object({ skillId: z.uuid() })),
    zValidator(
      'json',
      z.object({
        cluster_id: z.uuid().optional(),
        interval_minutes: z.number().min(1).max(1440),
        start_time: z.string().datetime(),
        end_time: z.string().datetime(),
      }),
    ),
    async (c) => {
      try {
        const { skillId } = c.req.valid('param');
        const { cluster_id, interval_minutes, start_time, end_time } =
          c.req.valid('json');
        const connector = c.get('user_data_storage_connector');

        const scores = await connector.getEvaluationScoresByTimeBucket(c, {
          skill_id: skillId,
          ...(cluster_id && { cluster_id }),
          interval_minutes,
          start_time,
          end_time,
        });

        return c.json(scores);
      } catch (error) {
        console.error('Error getting evaluation scores by time bucket:', error);
        const errorInfo = parseDatabaseError(error);
        return c.json({ error: errorInfo.message }, errorInfo.statusCode);
      }
    },
  )
  .get(
    '/:skillId/evaluations',
    zValidator('param', z.object({ skillId: z.uuid() })),
    async (c) => {
      try {
        const { skillId } = c.req.valid('param');
        const connector = c.get('user_data_storage_connector');

        const evaluations = await connector.getSkillOptimizationEvaluations(c, {
          skill_id: skillId,
        });

        return c.json(evaluations);
      } catch (error) {
        console.error('Error getting evaluations:', error);
        const errorInfo = parseDatabaseError(error);
        return c.json({ error: errorInfo.message }, errorInfo.statusCode);
      }
    },
  )
  .post(
    '/:skillId/evaluations',
    zValidator('param', z.object({ skillId: z.uuid() })),
    zValidator(
      'json',
      z.object({ methods: z.array(z.enum(EvaluationMethodName)) }),
    ),
    async (c) => {
      try {
        const { skillId } = c.req.valid('param');
        const { methods } = c.req.valid('json');
        const userDataStorageConnector = c.get('user_data_storage_connector');
        const evaluationConnectorsMap = c.get('evaluation_connectors_map');

        const skills = await userDataStorageConnector.getSkills(c, {
          id: skillId,
        });

        if (skills.length === 0) {
          return c.json({ error: 'Skill not found' }, 404);
        }

        const skill = skills[0];

        // Fetch the agent information for context
        const agents = await userDataStorageConnector.getAgents(c, {
          id: skill.agent_id,
        });

        if (agents.length === 0) {
          return c.json({ error: 'Agent not found' }, 404);
        }

        const agent = agents[0];

        const createParamsPromises = methods.map(async (method) => {
          const evaluationConnector = evaluationConnectorsMap[method];
          if (!evaluationConnector) {
            throw new Error(
              `Evaluation connector not found for method ${method}`,
            );
          }

          const createParams = await generateEvaluationCreateParams(
            c,
            skill,
            evaluationConnector,
            method,
            agent.description,
            userDataStorageConnector,
            // No examples on initial creation
            undefined,
          );

          return createParams;
        });

        const createParamsList = await Promise.all(createParamsPromises);

        const createdEvaluations =
          await userDataStorageConnector.createSkillOptimizationEvaluations(
            c,
            createParamsList,
          );

        // Create event for each evaluation added
        for (const evaluation of createdEvaluations) {
          await userDataStorageConnector.createSkillEvent(c, {
            agent_id: skill.agent_id,
            skill_id: skillId,
            cluster_id: null, // Skill-wide event
            event_type: SkillEventType.EVALUATION_ADDED,
            metadata: {
              evaluation_method: evaluation.evaluation_method,
            },
          });
        }

        return c.json(createdEvaluations, 200);
      } catch (error) {
        console.error('Error generating evaluations:', error);
        const errorInfo = parseDatabaseError(error);
        return c.json({ error: errorInfo.message }, errorInfo.statusCode);
      }
    },
  )
  .patch(
    '/:skillId/evaluations/:evaluationId',
    zValidator(
      'param',
      z.object({ skillId: z.uuid(), evaluationId: z.uuid() }),
    ),
    zValidator('json', SkillOptimizationEvaluationUpdateParams),
    async (c) => {
      try {
        const { skillId, evaluationId } = c.req.valid('param');
        const updateParams = c.req.valid('json');
        const userDataStorageConnector = c.get('user_data_storage_connector');

        // Get evaluation to verify it exists and belongs to this skill
        const evaluations =
          await userDataStorageConnector.getSkillOptimizationEvaluations(c, {
            id: evaluationId,
            skill_id: skillId,
          });

        if (evaluations.length === 0) {
          return c.json({ error: 'Evaluation not found' }, 404);
        }

        const evaluation = evaluations[0];

        // Validate params against the evaluation method's schema if params are being updated
        if (updateParams.params) {
          const evaluationConnectorsMap = c.get('evaluation_connectors_map');
          const connector =
            evaluationConnectorsMap[evaluation.evaluation_method];

          if (connector) {
            const paramSchema = connector.getParameterSchema;
            const validationResult = paramSchema.safeParse(updateParams.params);

            if (!validationResult.success) {
              const errorMessage = validationResult.error.issues
                .map((e) => `${String(e.path.join('.'))}: ${e.message}`)
                .join(', ');
              return c.json(
                {
                  error: 'Invalid parameters',
                  details: errorMessage,
                },
                400,
              );
            }
          }
        }

        // Update evaluation
        const updatedEvaluation =
          await userDataStorageConnector.updateSkillOptimizationEvaluation(
            c,
            evaluationId,
            updateParams,
          );

        return c.json(updatedEvaluation);
      } catch (error) {
        console.error('Error updating evaluation:', error);
        const errorInfo = parseDatabaseError(error);
        return c.json({ error: errorInfo.message }, errorInfo.statusCode);
      }
    },
  )
  .delete(
    '/:skillId/evaluations/:evaluationId',
    zValidator(
      'param',
      z.object({ skillId: z.uuid(), evaluationId: z.uuid() }),
    ),
    async (c) => {
      try {
        const { skillId, evaluationId } = c.req.valid('param');
        const userDataStorageConnector = c.get('user_data_storage_connector');

        // Get evaluation details before deleting
        const evaluations =
          await userDataStorageConnector.getSkillOptimizationEvaluations(c, {
            id: evaluationId,
          });

        if (evaluations.length === 0) {
          return c.json({ error: 'Evaluation not found' }, 404);
        }

        const evaluation = evaluations[0];

        await userDataStorageConnector.deleteSkillOptimizationEvaluation(
          c,
          evaluationId,
        );

        // Create event for evaluation removed
        await userDataStorageConnector.createSkillEvent(c, {
          agent_id: evaluation.agent_id,
          skill_id: skillId,
          cluster_id: null, // Skill-wide event
          event_type: SkillEventType.EVALUATION_REMOVED,
          metadata: {
            evaluation_method: evaluation.evaluation_method,
          },
        });

        return c.json({ message: 'Evaluations deleted successfully' }, 200);
      } catch (error) {
        console.error('Error deleting evaluations:', error);
        const errorInfo = parseDatabaseError(error);
        return c.json({ error: errorInfo.message }, errorInfo.statusCode);
      }
    },
  )
  // Reset a specific cluster (regenerate arms with context, optionally clear observability count)
  .post(
    '/:skillId/clusters/:clusterId/reset',
    zValidator('query', ResetQuerySchema),
    async (c) => {
      try {
        const skillId = c.req.param('skillId');
        const clusterId = c.req.param('clusterId');
        const connector = c.get('user_data_storage_connector');
        const { clearObservabilityCount } = c.req.valid('query');

        // Verify skill exists
        const skills = await connector.getSkills(c, { id: skillId });
        if (skills.length === 0) {
          return c.json({ error: 'Skill not found' }, 404);
        }
        const skill = skills[0];

        // Verify cluster exists
        const clusters = await connector.getSkillOptimizationClusters(c, {
          id: clusterId,
        });
        if (clusters.length === 0) {
          return c.json({ error: 'Cluster not found' }, 404);
        }

        // Get all arms for this cluster before reset (for event metadata)
        const arms = await connector.getSkillOptimizationArms(c, {
          cluster_id: clusterId,
        });

        // Reset cluster stats (optionally clear observability_total_requests)
        await connector.updateSkillOptimizationCluster(c, clusterId, {
          total_steps: 0,
          ...(clearObservabilityCount && { observability_total_requests: 0 }),
        });

        // Update arms in-place with fresh params and reset stats
        // Note: System prompts will be regenerated during next context generation
        await handleGenerateArms(c, connector, skillId, clusterId);

        // Create event for cluster reset
        await connector.createSkillEvent(c, {
          agent_id: skill.agent_id,
          skill_id: skillId,
          cluster_id: clusterId, // Cluster-specific event
          event_type: SkillEventType.PARTITION_RESET,
          metadata: {
            arm_count: arms.length,
          },
        });

        // Emit SSE event for cluster reset
        emitSSEEvent('cluster:reset', {
          skillId,
          clusterId,
          armCount: arms.length,
        });

        return c.json({ message: 'Cluster reset successfully' }, 200);
      } catch (error) {
        console.error('Error resetting cluster:', error);
        const errorInfo = parseDatabaseError(error);
        return c.json({ error: errorInfo.message }, errorInfo.statusCode);
      }
    },
  )
  // Reset entire skill optimization (delete and recreate everything, optionally clear skill total_requests)
  .post('/:skillId/reset', zValidator('query', ResetQuerySchema), async (c) => {
    try {
      const skillId = c.req.param('skillId');
      const connector = c.get('user_data_storage_connector');
      const { clearObservabilityCount } = c.req.valid('query');

      // Verify skill exists
      const skills = await connector.getSkills(c, { id: skillId });
      if (skills.length === 0) {
        return c.json({ error: 'Skill not found' }, 404);
      }
      const skill = skills[0];

      // Get existing evaluations to regenerate them
      const existingEvaluations =
        await connector.getSkillOptimizationEvaluations(c, {
          skill_id: skillId,
        });

      // Get existing clusters to update them
      const existingClusters = await connector.getSkillOptimizationClusters(c, {
        skill_id: skillId,
      });

      // Get embedding model config for cluster centroids
      const embeddingConfig = await resolveEmbeddingModelConfig(
        c,
        connector,
        await agentById(c, connector, skill.agent_id),
      );

      // Only reset clusters if embedding model is configured
      if (embeddingConfig) {
        // Update clusters in-place with fresh centroids
        const initialCentroids = getInitialClusterCentroids(
          skill.configuration_count,
          embeddingConfig.dimensions,
        );

        // Match existing clusters to new centroids
        for (let i = 0; i < initialCentroids.length; i++) {
          const centroid = initialCentroids[i];
          if (i < existingClusters.length) {
            // Update existing cluster
            await connector.updateSkillOptimizationCluster(
              c,
              existingClusters[i].id,
              {
                centroid,
                total_steps: 0,
                observability_total_requests: clearObservabilityCount
                  ? 0
                  : existingClusters[i].observability_total_requests,
                embedding_model_id: embeddingConfig.modelId,
              },
            );
          } else {
            // Create new cluster if configuration_count increased
            const clusterParams: SkillOptimizationClusterCreateParams = {
              agent_id: skill.agent_id,
              skill_id: skillId,
              name: `${i + 1}`,
              total_steps: 0,
              observability_total_requests: 0,
              centroid,
              embedding_model_id: embeddingConfig.modelId,
            };
            await connector.createSkillOptimizationClusters(c, [clusterParams]);
          }
        }

        // Delete extra clusters if configuration_count decreased
        for (
          let i = initialCentroids.length;
          i < existingClusters.length;
          i++
        ) {
          await connector.deleteSkillOptimizationCluster(
            c,
            existingClusters[i].id,
          );
        }
      }

      // Regenerate evaluations with the same methods in-place
      if (existingEvaluations.length > 0) {
        // Get agent for evaluation generation
        const agents = await connector.getAgents(c, { id: skill.agent_id });
        if (agents.length === 0) {
          return c.json({ error: 'Agent not found' }, 404);
        }
        const agent = agents[0];

        // Generate evaluation create params for existing evaluation methods
        const evaluationConnectorsMap = c.get('evaluation_connectors_map');

        for (const existingEval of existingEvaluations) {
          const method = existingEval.evaluation_method;
          const evaluationConnector = evaluationConnectorsMap[method];
          if (!evaluationConnector) {
            throw new Error(
              `Evaluation connector not found for method ${method}`,
            );
          }

          const newParams = await generateEvaluationCreateParams(
            c,
            skill,
            evaluationConnector,
            method,
            agent.description,
            connector,
            undefined, // No examples on reset
          );

          // Update evaluation in-place
          await connector.updateSkillOptimizationEvaluation(
            c,
            existingEval.id,
            {
              params: newParams.params,
              weight: newParams.weight,
            },
          );
        }
      }

      // Update arms in-place for all clusters (preserving arm IDs)
      await handleGenerateArms(c, connector, skillId);

      // Reset skill metadata (and optionally total_requests)
      await connector.updateSkill(c, skillId, {
        last_clustering_at: null,
        last_clustering_log_start_time: null,
        evaluations_regenerated_at: null,
        evaluation_lock_acquired_at: null,
        ...(clearObservabilityCount && { total_requests: 0 }),
      });

      // Create event for skill reset
      await connector.createSkillEvent(c, {
        agent_id: skill.agent_id,
        skill_id: skillId,
        cluster_id: null, // Skill-wide event
        event_type: SkillEventType.PARTITION_RESET,
        metadata: {
          cluster_count: skill.configuration_count,
          evaluation_count: existingEvaluations.length,
        },
      });

      // Emit SSE event for skill reset
      emitSSEEvent('skill:reset', {
        skillId,
        clusterCount: skill.configuration_count,
        evaluationCount: existingEvaluations.length,
      });

      return c.json({ message: 'Skill reset successfully' }, 200);
    } catch (error) {
      console.error('Error resetting skill:', error);
      const errorInfo = parseDatabaseError(error);
      return c.json({ error: errorInfo.message }, errorInfo.statusCode);
    }
  });
