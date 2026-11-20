import { repairClusterArms } from '@api/optimization/arm-repair';
import { handleGenerateArms } from '@api/optimization/skill-optimizations';
import type { UserDataStorageConnector } from '@api/types/connector';
import type { AppContext } from '@api/types/hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@api/optimization/skill-optimizations', () => ({
  handleGenerateArms: vi.fn(),
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
    vi.mocked(handleGenerateArms).mockResolvedValue(
      new Response(JSON.stringify({ updatedArms: ['arm-1'] }), {
        status: 200,
      }) as never,
    );
  });

  it("generates the cluster's arms, and only that cluster's", async () => {
    await repairClusterArms(c, connectorWith([]), skill, 'cluster-2');

    expect(handleGenerateArms).toHaveBeenCalledTimes(1);
    expect(handleGenerateArms).toHaveBeenCalledWith(
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

    expect(handleGenerateArms).toHaveBeenCalledTimes(1);
  });

  it('leaves a cluster alone that has its arms by the time it is asked', async () => {
    await repairClusterArms(c, connectorWith([{ id: 'arm-1' }]), skill, 'c');

    expect(handleGenerateArms).not.toHaveBeenCalled();
  });

  it('says why it could not, and can be asked again', async () => {
    vi.mocked(handleGenerateArms).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Cluster not found' }), {
        status: 404,
      }) as never,
    );
    const connector = connectorWith([]);

    await expect(
      repairClusterArms(c, connector, skill, 'cluster-2'),
    ).rejects.toThrow('Cluster not found');
    await repairClusterArms(c, connector, skill, 'cluster-2');

    expect(handleGenerateArms).toHaveBeenCalledTimes(2);
  });
});
