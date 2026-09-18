import { describe, expect, it } from 'vitest';
import { routeTree } from '../../routeTree.gen';
import { collectRouteIds } from './route-test-utils';

/**
 * All expected route IDs in the application.
 * Source of truth: FileRoutesById in routeTree.gen.ts
 *
 * If a route file is deleted or renamed, the corresponding ID will disappear
 * from the generated tree and this test will fail — catching regressions early.
 */
const EXPECTED_ROUTE_IDS = [
  '__root__',
  '/',
  '/login',
  '/_main',
  '/_main/settings',
  '/_main/agents/',
  '/_main/agents/create',
  '/_main/agents/$agentName',
  '/_main/agents/$agentName/',
  '/_main/agents/$agentName/edit',
  '/_main/agents/$agentName/logs',
  '/_main/agents/$agentName/logs/',
  '/_main/agents/$agentName/logs/$logId',
  '/_main/agents/$agentName/skills/',
  '/_main/agents/$agentName/skills/create',
  '/_main/agents/$agentName/skills/$skillName',
  '/_main/agents/$agentName/skills/$skillName/',
  '/_main/agents/$agentName/skills/$skillName/edit',
  '/_main/agents/$agentName/skills/$skillName/setup',
  '/_main/agents/$agentName/skills/$skillName/logs',
  '/_main/agents/$agentName/skills/$skillName/logs/',
  '/_main/agents/$agentName/skills/$skillName/logs/$logId',
  '/_main/agents/$agentName/skills/$skillName/events',
  '/_main/agents/$agentName/skills/$skillName/evaluations',
  '/_main/agents/$agentName/skills/$skillName/evaluations/',
  '/_main/agents/$agentName/skills/$skillName/evaluations/$evaluationId/edit',
  '/_main/agents/$agentName/skills/$skillName/clusters/',
  '/_main/agents/$agentName/skills/$skillName/clusters/$clusterId',
  '/_main/agents/$agentName/skills/$skillName/clusters/$clusterId/configurations',
  '/_main/agents/$agentName/skills/$skillName/clusters/$clusterId/configurations/',
  '/_main/agents/$agentName/skills/$skillName/clusters/$clusterId/configurations/$armId',
  '/_main/ai-providers/',
  '/_main/ai-providers/create',
  '/_main/ai-providers/$id/edit',
  '/_main/ai-providers/$id/add-models',
];

describe('Route Registry', () => {
  const collectedIds = collectRouteIds(routeTree);

  it.each(EXPECTED_ROUTE_IDS)(
    'route tree contains expected route: %s',
    (routeId) => {
      expect(collectedIds.has(routeId)).toBe(true);
    },
  );

  it('route tree does not contain unexpected routes', () => {
    const expectedSet = new Set(EXPECTED_ROUTE_IDS);
    const unexpected = [...collectedIds].filter((id) => !expectedSet.has(id));
    expect(unexpected).toEqual([]);
  });
});
