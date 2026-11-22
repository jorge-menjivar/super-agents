import { getClusters } from '@api/middlewares/optimizer/clusters';
import type { Log, Skill } from '@shared/types/data';
import { describe, expect, it } from 'vitest';

const skill = { id: 'skill-1', configuration_count: 2 } as Skill;

/** Logs newest first, as the optimizer reads them. */
const logs = (embeddings: number[][]) =>
  embeddings.map((embedding, index) => ({
    id: `log-${index}`,
    embedding,
  })) as unknown as Log[];

describe('getClusters', () => {
  // A skill whose embedding model changed has logs from both models. They
  // cannot be clustered together, and refusing them all left the skill
  // matched against the old model's centroids for good.
  it("clusters the newest model's logs when the skill has two models' logs", () => {
    const result = getClusters(
      skill,
      logs([
        [1, 0, 0],
        [0.9, 0.1, 0],
        [0, 1, 0],
        [0, 0.9, 0.1],
        // From the model before: of another length.
        [1, 0],
        [0, 1],
      ]),
    );

    expect(result).not.toBeNull();
    expect(result?.centroids).toHaveLength(2);
    for (const centroid of result?.centroids ?? []) {
      expect(centroid).toHaveLength(3);
    }
  });
});
