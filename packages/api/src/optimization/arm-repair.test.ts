import { repairClusterArms } from '@api/optimization/arm-repair';
import {
  generateArms,
  withArmGenerationLock,
} from '@api/optimization/skill-optimizations';
import type { UserDataStorageConnector } from '@api/types/connector';
import type { AppContext } from '@api/types/hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The real lock, so a repair waits on a generation as it would; the
// generation itself is mocked.
vi.mock('@api/optimization/skill-optimizations', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@api/optimization/skill-optimizations')
  >()),
  handleGenerateArms: vi.fn(),
  generateArms: vi.fn(),
}));

const c = {} as AppContext;
const skill = { id: 'skill-1', name: 'review-agent-action-approval' };

const connectorWith = (armsAtFirst: unknown[]) =>
  ({
    getSkillOptimizationArms: vi.fn().mockResolvedValue(armsAtFirst),
  }) as unknown as UserDataStorageConnector;

describe('repairClusterArms', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(generateArms).mockResolvedValue(
      new Response(JSON.stringify({ updatedArms: ['arm-1'] }), {
        status: 200,
      }) as never,
    );
  });

  it("generates the cluster's arms, and only that cluster's", async () => {
    await repairClusterArms(c, connectorWith([]), skill, 'cluster-2');

    expect(generateArms).toHaveBeenCalledTimes(1);
    expect(generateArms).toHaveBeenCalledWith(
      c,
      expect.anything(),
      'skill-1',
      'cluster-2',
    );
  });

  // Nothing keeps a cluster's arms unique: two repairs at once would give it
  // every arm twice.
  it('repairs a cluster once for requests that find it empty together', async () => {
    const connector = connectorWith([]);

    await Promise.all([
      repairClusterArms(c, connector, skill, 'cluster-2'),
      repairClusterArms(c, connector, skill, 'cluster-2'),
      repairClusterArms(c, connector, skill, 'cluster-2'),
    ]);

    expect(generateArms).toHaveBeenCalledTimes(1);
  });

  it('leaves a cluster alone that has its arms by the time it is asked', async () => {
    await repairClusterArms(c, connectorWith([{ id: 'arm-1' }]), skill, 'c');

    expect(generateArms).not.toHaveBeenCalled();
  });

  // Nothing keeps a cluster's arms unique: a repair racing the first full
  // generation -- the one that runs when a model is attached -- gave a
  // cluster every arm twice. It waits for that generation, and finds the
  // cluster served.
  it('waits for a generation already running for the skill', async () => {
    let generated = false;
    const connector = {
      getSkillOptimizationArms: vi.fn(async () =>
        generated ? [{ id: 'arm-1' }] : [],
      ),
    } as unknown as UserDataStorageConnector;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const running = withArmGenerationLock(skill.id, async () => {
      await gate;
      generated = true;
    });

    const repair = repairClusterArms(c, connector, skill, 'cluster-2');
    release();
    await Promise.all([running, repair]);

    expect(generateArms).not.toHaveBeenCalled();
  });

  it('says why it could not, and can be asked again', async () => {
    vi.mocked(generateArms).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Cluster not found' }), {
        status: 404,
      }) as never,
    );
    const connector = connectorWith([]);

    await expect(
      repairClusterArms(c, connector, skill, 'cluster-2'),
    ).rejects.toThrow('Cluster not found');
    await repairClusterArms(c, connector, skill, 'cluster-2');

    expect(generateArms).toHaveBeenCalledTimes(2);
  });
});
