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
 * The embedding model a log's embedding was made with, as the gateway
 * records it in the log's metadata. A log written before it did names none.
 */
function embeddedWith(log: Log): string | undefined {
  const modelId = log.metadata?.embedding_model_id;
  return typeof modelId === 'string' ? modelId : undefined;
}

/**
 * The logs' embeddings that can be clustered together, newest first: those
 * of one model, the one the skill's requests are embedded with now.
 *
 * A skill whose embedding model changed has logs from both, and vectors of
 * two models cannot be clustered together -- not even when they are of one
 * length, which says only that both are lists of that many numbers. Refusing
 * them all, as this once did, left the skill never reclustered and matched
 * against the old model's centroids for good. A log that names its model is
 * kept when that is the current one. A log that names none was written
 * before the gateway recorded it, and is kept by the one thing it says about
 * its model, the length of its embedding: the length the current model's
 * logs have, or, until there are any, the newest log's. When the current
 * model is not known, the newest log that names one stands in for it.
 */
export function clusterableEmbeddings(
  logs: Log[],
  modelId?: string,
): number[][] {
  // Logs are ordered newest first.
  const embedded = logs.filter(
    (log): log is Log & { embedding: number[] } => !!log.embedding?.length,
  );
  if (embedded.length === 0) {
    return [];
  }

  const model = modelId ?? embedded.map(embeddedWith).find(Boolean);
  const reference =
    embedded.find((log) => model && embeddedWith(log) === model) ?? embedded[0];
  const length = reference.embedding.length;

  return embedded
    .filter((log) => {
      const recorded = embeddedWith(log);
      return (
        log.embedding.length === length &&
        (recorded === undefined || recorded === model)
      );
    })
    .map((log) => log.embedding);
}

export function getClusters(
  skill: Skill,
  embeddings: number[][],
): ClusterResult | null {
  try {
    return kMeansClustering(embeddings, skill.configuration_count);
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

  // Only the logs that will be clustered count toward the interval, and
  // there must be at least one for every cluster: k-means over fewer points
  // than clusters returns a centroid per point. Counting every log, a skill
  // just moved to another embedding model -- thirty logs of the old model,
  // one of the new -- was reclustered into a single partition that then took
  // every request, and the cursor moved past the logs it had left out. Until
  // there are enough, nothing is reclustered and the cursor stays where it
  // is.
  const needed = Math.max(interval, skill.configuration_count);

  // The model the skill's requests are embedded with now. Only its logs are
  // clustered, and the new centroids are recorded as its, so a request is
  // only ever compared with centroids of its own model. Not looked up for a
  // skill that has too few logs to recluster either way.
  const embeddingConfig =
    logs.length >= needed
      ? await resolveEmbeddingModelConfig(
          c,
          userDataStorageConnector,
          await agentById(c, userDataStorageConnector, skill.agent_id),
        )
      : null;
  const embeddings = clusterableEmbeddings(logs, embeddingConfig?.modelId);

  if (logs.length >= needed && embeddings.length < needed) {
    info(
      `[OPTIMIZER] Not reclustering skill ${skill.id} (${skill.name}) yet: ${embeddings.length} of its ${logs.length} new logs were embedded with its current embedding model, and it needs ${needed}.`,
    );
  }

  if (embeddings.length >= needed) {
    info(
      `[OPTIMIZER] Starting reclustering for skill ${skill.id} (${skill.name}) with ${embeddings.length} logs...`,
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

      const clusterResult = getClusters(skill, embeddings);

      if (!clusterResult) {
        error(`[OPTIMIZER] Failed to cluster logs for skill ${skill.id}`);
        return;
      }

      const newCentroids = clusterResult.centroids;

      // The model the new centroids were computed with: the one the skill's
      // requests are embedded with now, when their length says so.
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
          log_count: embeddings.length,
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
