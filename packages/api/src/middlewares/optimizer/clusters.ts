import type {
  LogsStorageConnector,
  UserDataStorageConnector,
} from '@api/types/connector';
import type { AppContext } from '@api/types/hono';
import {
  agentById,
  resolveEmbeddingModelConfig,
} from '@api/utils/evaluation-model-resolver';
import { calculateDistance, kMeansClustering } from '@api/utils/math';
import { emitSSEEvent } from '@api/utils/sse-event-manager';
import { error, info, success } from '@shared/console-logging';
import type { FunctionName } from '@shared/types/api/request';
import type { Log, Skill } from '@shared/types/data';
import { SkillEventType } from '@shared/types/data/skill-event';
import type { SkillOptimizationClusterCreateParams } from '@shared/types/data/skill-optimization-cluster';
import type { ClusterResult } from '@shared/utils/math';
import { isOptimizedFunction } from '@shared/utils/optimized-functions';

/**
 * The logs' embeddings, of the newest one's length. A skill whose embedding
 * model changed has logs from both: they cannot be clustered together, and
 * refusing them all -- as this used to -- left the skill never reclustered,
 * matched against centroids of the old model for good. The newest model's
 * logs are the ones the skill will be matched by.
 */
function extractEmbeddings(logs: Log[]): number[][] {
  // Logs are ordered newest first.
  const embeddings = logs
    .map((log) => log.embedding)
    .filter((embedding): embedding is number[] => !!embedding?.length);

  if (embeddings.length === 0) {
    throw new Error(`[OPTIMIZER] No logs with embeddings found`);
  }

  const newest = embeddings[0].length;
  return embeddings.filter((embedding) => embedding.length === newest);
}

export function getClusters(skill: Skill, logs: Log[]): ClusterResult | null {
  const numberOfClusters = skill.configuration_count;

  try {
    const embeddings = extractEmbeddings(logs);
    const embeddingsLogMap = new Map<number[], Log>();
    embeddings.forEach((embedding, index) => {
      embeddingsLogMap.set(embedding, logs[index]);
    });
    const result = kMeansClustering(embeddings, numberOfClusters);
    return result;
  } catch (e) {
    error(`[OPTIMIZER] Error clustering logs for skill ${skill.id}:`, e);
    return null;
  }
}

export async function autoClusterSkill(
  c: AppContext,
  functionName: FunctionName,
  userDataStorageConnector: UserDataStorageConnector,
  logsStorageConnector: LogsStorageConnector,
  skill: Skill,
) {
  // Only requests a skill's system prompt shapes are optimized on
  if (!isOptimizedFunction(functionName)) {
    return;
  }

  const interval = skill.clustering_interval;

  const logs = await logsStorageConnector.getLogs(c, {
    skill_id: skill.id,
    after: skill.last_clustering_log_start_time ?? undefined,
    // Since the embedding is not null, we can assume that the logs are valid
    // and are for one of the allowed function names
    embedding_not_null: true,
  });

  // Automatically cluster logs if there are enough logs
  if (logs.length >= interval) {
    info(
      `[OPTIMIZER] Starting reclustering for skill ${skill.id} (${skill.name}) with ${logs.length} logs...`,
    );
    const startTime = Date.now();

    try {
      // Try to atomically acquire the reclustering lock
      // This prevents race conditions where multiple requests try to recluster simultaneously
      const lockThresholdMs = 60000; // 60 seconds
      const lockedSkill =
        await userDataStorageConnector.tryAcquireReclusteringLock(
          c,
          skill.id,
          lockThresholdMs,
        );

      if (!lockedSkill) {
        // Lock was not acquired - another request is already reclustering or did so recently
        const currentTime = Date.now();
        const lastClusteringTime = skill.last_clustering_at
          ? new Date(skill.last_clustering_at).getTime()
          : 0;
        info(
          `[OPTIMIZER] Reclustering already in progress for skill ${skill.id} (last clustered ${Math.floor((currentTime - lastClusteringTime) / 1000)}s ago). Skipping.`,
        );
        return;
      }

      // Lock acquired successfully - update in-memory skill object
      skill.last_clustering_at = lockedSkill.last_clustering_at;

      const clusterStates =
        await userDataStorageConnector.getSkillOptimizationClusters(c, {
          skill_id: skill.id,
        });

      const clusterResult = getClusters(skill, logs);

      if (!clusterResult) {
        error(`[OPTIMIZER] Failed to cluster logs for skill ${skill.id}`);
        return;
      }

      const newCentroids = clusterResult.centroids;

      // The model the new centroids were computed with: the one the skill's
      // requests are embedded with now, when their length says so. Recorded
      // on the clusters, so a request is only ever compared with centroids
      // of its own model.
      const embeddingConfig = await resolveEmbeddingModelConfig(
        c,
        userDataStorageConnector,
        await agentById(c, userDataStorageConnector, skill.agent_id),
      );
      const computedWith =
        embeddingConfig &&
        embeddingConfig.dimensions === newCentroids[0]?.length
          ? { embedding_model_id: embeddingConfig.modelId }
          : {};

      // Match old cluster centers to new cluster centers based on proximity
      // Each old cluster gets matched to the closest new cluster
      const used = new Set<number>();
      const matches: Array<{ clusterStateId: string; newCenter: number[] }> =
        [];

      // Create new clusters
      if (clusterStates.length === 0) {
        const clusterParams: SkillOptimizationClusterCreateParams[] =
          newCentroids.map((centroid, index) => ({
            agent_id: skill.agent_id,
            skill_id: skill.id,
            name: `${index + 1}`,
            total_steps: 0,
            observability_total_requests: 0,
            centroid,
            ...computedWith,
          }));
        await userDataStorageConnector.createSkillOptimizationClusters(
          c,
          clusterParams,
        );
        // Emit SSE event for cluster updates
        emitSSEEvent('skill-optimization:cluster-updated', {
          skillId: skill.id,
        });
      }
      // Update existing clusters
      else {
        for (const clusterState of clusterStates) {
          let minDistance = Infinity;
          let bestMatchIndex = -1;

          // Find the closest unused new cluster center
          for (let i = 0; i < newCentroids.length; i++) {
            if (used.has(i)) continue;

            // A centroid of another model cannot be compared with the new
            // ones: it takes whichever is left.
            const distance =
              clusterState.centroid.length === newCentroids[i].length
                ? calculateDistance(clusterState.centroid, newCentroids[i])
                : 0;

            if (distance < minDistance) {
              minDistance = distance;
              bestMatchIndex = i;
            }
          }

          if (bestMatchIndex !== -1) {
            used.add(bestMatchIndex);
            matches.push({
              clusterStateId: clusterState.id,
              newCenter: newCentroids[bestMatchIndex],
            });
          }
        }

        // Update all matched cluster states
        await Promise.all(
          matches.map((match) =>
            userDataStorageConnector.updateSkillOptimizationCluster(
              c,
              match.clusterStateId,
              {
                centroid: match.newCenter,
                ...computedWith,
              },
            ),
          ),
        );
        // Emit SSE event for cluster updates
        emitSSEEvent('skill-optimization:cluster-updated', {
          skillId: skill.id,
        });
      }

      // Logs are ordered by start_time desc, so logs[0] is the most recent
      const mostRecentLog = logs[0];

      // Update clustering state (last_clustering_at was already set as a lock)
      await userDataStorageConnector.updateSkill(c, skill.id, {
        last_clustering_log_start_time: mostRecentLog.start_time,
      });

      // Create reclustering event
      await userDataStorageConnector.createSkillEvent(c, {
        agent_id: skill.agent_id,
        skill_id: skill.id,
        cluster_id: null, // Skill-wide event
        event_type: SkillEventType.CLUSTERS_UPDATED,
        metadata: {
          cluster_count:
            clusterStates.length > 0
              ? clusterStates.length
              : skill.configuration_count,
          log_count: logs.length,
        },
      });

      // Update the in-memory skill object (last_clustering_at already set when lock was acquired)
      skill.last_clustering_log_start_time = mostRecentLog.start_time;

      const duration = Date.now() - startTime;
      success(
        `[OPTIMIZER] Reclustering completed for skill ${skill.id} (${skill.name}) in ${duration}ms. Updated ${clusterStates.length > 0 ? clusterStates.length : skill.configuration_count} clusters.`,
      );
    } catch (e) {
      const duration = Date.now() - startTime;
      error(
        `[OPTIMIZER] Error during reclustering for skill ${skill.id} after ${duration}ms:`,
        e,
      );
    }
  }
}
