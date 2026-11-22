import {
  generateArms,
  withArmGenerationLock,
} from '@api/optimization/skill-optimizations';
import type { UserDataStorageConnector } from '@api/types/connector';
import type { AppContext } from '@api/types/hono';
import { warn } from '@shared/console-logging';

/**
 * Gives a cluster that has no arms the arms it should have.
 *
 * Arms are generated for every cluster of a skill that has models, so a
 * cluster without any, in a skill that has models, is a generation that was
 * cut short: by a crash, a database error, or a bug since fixed (arms written
 * with an empty prompt once failed to read back, which stopped generation
 * after the first). Nothing revisits arm generation on its own, so a cluster
 * left like that refused every request matched to it until someone
 * regenerated the skill's arms by hand. Repaired here, it starts the way any
 * cluster does -- from the skill's seed -- and the skill's other clusters,
 * with whatever they have learned, are left alone.
 *
 * Concurrent requests matched to the same empty cluster share one repair:
 * nothing keeps a cluster's arms unique, so two repairs at once would give
 * it every arm twice. That holds within a process; on Workers, two isolates
 * could still each repair it once.
 */

const repairs = new Map<string, Promise<void>>();

export function repairClusterArms(
  c: AppContext,
  connector: UserDataStorageConnector,
  skill: { id: string; name: string },
  clusterId: string,
): Promise<void> {
  const running = repairs.get(clusterId);
  if (running) {
    return running;
  }

  // Under the skill's arm-generation lock, so a full generation running --
  // the first after a model was attached -- finishes first, and the look
  // below sees what it wrote.
  const repair = withArmGenerationLock(skill.id, async () => {
    // Another process, or a generation that finished just before this one
    // was asked for, may have given the cluster its arms already.
    const arms = await connector.getSkillOptimizationArms(c, {
      cluster_id: clusterId,
    });
    if (arms.length > 0) {
      return;
    }
    warn(
      `[ARM_REPAIR] Cluster ${clusterId} of skill ${skill.name} has no arms; generating them`,
    );
    const response = await generateArms(c, connector, skill.id, clusterId);
    if (response.status !== 200) {
      throw new Error(
        `Could not generate arms for cluster ${clusterId} of skill ${skill.name}: ${response.status} ${await response.text()}`,
      );
    }
  }).finally(() => {
    repairs.delete(clusterId);
  });

  repairs.set(clusterId, repair);
  return repair;
}
