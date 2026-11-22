import {
  autoClusterSkill,
  clusterableEmbeddings,
  getClusters,
} from '@api/middlewares/optimizer/clusters';
import { createMockContext } from '@api/test-utils/mock-context';
import type {
  LogsStorageConnector,
  UserDataStorageConnector,
} from '@api/types/connector';
import { resolveEmbeddingModelConfig } from '@api/utils/evaluation-model-resolver';
import { FunctionName } from '@shared/types/api/request';
import type { Log, Skill } from '@shared/types/data';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@api/utils/evaluation-model-resolver', () => ({
  agentById: vi.fn().mockResolvedValue(null),
  resolveEmbeddingModelConfig: vi.fn(),
}));
vi.mock('@api/utils/sse-event-manager', () => ({ emitSSEEvent: vi.fn() }));

const OLD_MODEL = '00000000-0000-4000-8000-00000000000a';
const NEW_MODEL = '00000000-0000-4000-8000-00000000000b';

const skill = { id: 'skill-1', configuration_count: 2 } as Skill;

/** Logs newest first, as the optimizer reads them. */
const logs = (embeddings: number[][]) =>
  embeddings.map((embedding, index) => ({
    id: `log-${index}`,
    embedding,
    metadata: {},
  })) as unknown as Log[];

/** A log whose embedding the gateway recorded as `modelId`'s. */
const embeddedBy = (modelId: string, embedding: number[], index: number): Log =>
  ({
    id: `${modelId}-${index}`,
    start_time: 10_000 - index,
    embedding,
    metadata: { embedding_model_id: modelId },
  }) as unknown as Log;

/** A log written before the gateway recorded which model embedded it. */
const unrecorded = (embedding: number[], index: number): Log =>
  ({
    id: `unrecorded-${index}`,
    start_time: 5_000 - index,
    embedding,
    metadata: {},
  }) as unknown as Log;

/** `count` distinct embeddings of `length`, around two well-apart points. */
const vectors = (count: number, length: number): number[][] =>
  Array.from({ length: count }, (_, i) =>
    Array.from({ length }, (_, d) => (d === i % 2 ? 1 + i / 1000 : i / 1000)),
  );

describe('clusterableEmbeddings', () => {
  // A skill whose embedding model changed has logs from both models. They
  // cannot be clustered together, and refusing them all left the skill
  // matched against the old model's centroids for good.
  it("keeps the newest model's logs when the skill has two models' logs", () => {
    const embeddings = clusterableEmbeddings(
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

    expect(embeddings).toHaveLength(4);
    for (const embedding of embeddings) {
      expect(embedding).toHaveLength(3);
    }
  });

  // Two models' vectors can be of one length, and nothing in the numbers
  // says which made them. The log records it.
  it("leaves out another model's logs of the same length", () => {
    const embeddings = clusterableEmbeddings(
      [
        embeddedBy(NEW_MODEL, [1, 0], 0),
        embeddedBy(OLD_MODEL, [0.5, 0.5], 1),
        embeddedBy(NEW_MODEL, [0, 1], 2),
      ],
      NEW_MODEL,
    );

    expect(embeddings).toEqual([
      [1, 0],
      [0, 1],
    ]);
  });

  it("keeps a log that names no model by the length of the current model's", () => {
    const embeddings = clusterableEmbeddings(
      [
        embeddedBy(NEW_MODEL, [1, 0], 0),
        unrecorded([0.5, 0.5], 1),
        unrecorded([1, 0, 0], 2),
      ],
      NEW_MODEL,
    );

    expect(embeddings).toEqual([
      [1, 0],
      [0.5, 0.5],
    ]);
  });

  it('is empty when no log has an embedding', () => {
    expect(clusterableEmbeddings(logs([[]]))).toEqual([]);
  });
});

describe('getClusters', () => {
  it('clusters the embeddings into the skill’s number of clusters', () => {
    const result = getClusters(skill, [
      [1, 0, 0],
      [0.9, 0.1, 0],
      [0, 1, 0],
      [0, 0.9, 0.1],
    ]);

    expect(result?.centroids).toHaveLength(2);
  });

  it('is null when there is nothing to cluster', () => {
    expect(getClusters(skill, [])).toBeNull();
  });
});

describe('autoClusterSkill', () => {
  const clusteringSkill = {
    id: 'skill-1',
    agent_id: 'agent-1',
    name: 'support',
    configuration_count: 3,
    clustering_interval: 20,
    last_clustering_log_start_time: 1,
    last_clustering_at: null,
  } as unknown as Skill;

  const setup = (stored: Log[]) => {
    const userData = {
      tryAcquireReclusteringLock: vi
        .fn()
        .mockResolvedValue({ last_clustering_at: 'now' }),
      getSkillOptimizationClusters: vi.fn().mockResolvedValue([]),
      createSkillOptimizationClusters: vi.fn().mockResolvedValue([]),
      updateSkillOptimizationCluster: vi.fn().mockResolvedValue(undefined),
      updateSkill: vi.fn().mockResolvedValue(undefined),
      createSkillEvent: vi.fn().mockResolvedValue(undefined),
    } as unknown as UserDataStorageConnector;
    const logsStore = {
      getLogs: vi.fn().mockResolvedValue(stored),
    } as unknown as LogsStorageConnector;
    return { userData, logsStore };
  };

  const recluster = (
    userData: UserDataStorageConnector,
    logsStore: LogsStorageConnector,
  ) =>
    autoClusterSkill(
      createMockContext(),
      FunctionName.CHAT_COMPLETE,
      userData,
      logsStore,
      { ...clusteringSkill },
    );

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveEmbeddingModelConfig).mockResolvedValue({
      modelId: NEW_MODEL,
      dimensions: 3,
    } as Awaited<ReturnType<typeof resolveEmbeddingModelConfig>>);
  });

  // Thirty logs of the old model and one of the new: counted as thirty-one,
  // they reclustered the skill into a single partition -- k-means over one
  // point gives one centroid -- that took every request, and moved the
  // cursor past the thirty it had left out.
  it('waits for enough logs of the current model before reclustering', async () => {
    const { userData, logsStore } = setup([
      unrecorded([1, 0, 0], 0),
      ...vectors(30, 2).map((v, i) => unrecorded(v, i + 1)),
    ]);

    await recluster(userData, logsStore);

    expect(userData.tryAcquireReclusteringLock).not.toHaveBeenCalled();
    expect(userData.createSkillOptimizationClusters).not.toHaveBeenCalled();
    expect(userData.updateSkill).not.toHaveBeenCalled();
  });

  it("does not count another model's logs of the same length", async () => {
    const { userData, logsStore } = setup([
      ...vectors(5, 3).map((v, i) => embeddedBy(NEW_MODEL, v, i)),
      ...vectors(30, 3).map((v, i) => embeddedBy(OLD_MODEL, v, i + 5)),
    ]);

    await recluster(userData, logsStore);

    expect(userData.tryAcquireReclusteringLock).not.toHaveBeenCalled();
    expect(userData.updateSkill).not.toHaveBeenCalled();
  });

  it("reclusters the current model's logs into every cluster once there are enough", async () => {
    const stored = [
      ...vectors(20, 3).map((v, i) => embeddedBy(NEW_MODEL, v, i)),
      ...vectors(10, 3).map((v, i) => embeddedBy(OLD_MODEL, v, i + 20)),
    ];
    const { userData, logsStore } = setup(stored);

    await recluster(userData, logsStore);

    const [, created] = vi.mocked(userData.createSkillOptimizationClusters).mock
      .calls[0] as [unknown, { centroid: number[] }[]];
    expect(created).toHaveLength(3);
    expect(created[0]).toMatchObject({ embedding_model_id: NEW_MODEL });
    expect(userData.updateSkill).toHaveBeenCalledWith(
      expect.anything(),
      'skill-1',
      { last_clustering_log_start_time: stored[0].start_time },
    );
  });
});
