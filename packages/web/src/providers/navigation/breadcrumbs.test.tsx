import { render, screen, waitFor } from '@testing-library/react';
import { NavigationProvider, useNavigation } from '@web/providers/navigation';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  resetRouterMocks,
  setMockParams,
  setMockPathname,
} from '@/vitest.setup';

/**
 * The trail the provider builds from the URL.
 *
 * Driven through the real provider rather than a mocked state, because the
 * bug it exists to catch is a path the provider does not recognise: a route
 * added without a view of its own reads as some other page, and the trail
 * then says the reader is somewhere they are not.
 */
function Trail(): ReactElement {
  const { navigationState } = useNavigation();
  return (
    <>
      <div data-testid="view">{navigationState.currentView}</div>
      <div data-testid="trail">
        {navigationState.breadcrumbs
          .map((segment) => segment.label)
          .join(' > ')}
      </div>
    </>
  );
}

const trailAt = async (
  pathname: string,
  params: Record<string, string | undefined>,
): Promise<{ view: string; trail: string }> => {
  setMockPathname(pathname);
  setMockParams(params);
  render(
    <NavigationProvider>
      <Trail />
    </NavigationProvider>,
  );
  await waitFor(() => {
    expect(screen.getByTestId('trail')).toHaveTextContent('Agents');
  });
  return {
    view: screen.getByTestId('view').textContent ?? '',
    trail: screen.getByTestId('trail').textContent ?? '',
  };
};

describe('the breadcrumb trail', () => {
  beforeEach(() => {
    resetRouterMocks();
    localStorage.clear();
  });

  it('names the agent on its own page', async () => {
    const { view, trail } = await trailAt('/agents/coder', {
      agentName: 'coder',
    });
    expect(view).toBe('agent-view');
    expect(trail).toBe('Agents > coder');
  });

  it('names the skills page, which is not the agent page', async () => {
    const { view, trail } = await trailAt('/agents/coder/skills', {
      agentName: 'coder',
    });
    expect(view).toBe('skills-list');
    expect(trail).toBe('Agents > coder > Skills');
  });

  it('puts a skill under the page it is reached from', async () => {
    const { view, trail } = await trailAt('/agents/coder/skills/triage', {
      agentName: 'coder',
      skillName: 'triage',
    });
    expect(view).toBe('skill-dashboard');
    expect(trail).toBe('Agents > coder > Skills > triage');
  });

  it('keeps the skill in the trail on a page below it', async () => {
    const { trail } = await trailAt('/agents/coder/skills/triage/evaluations', {
      agentName: 'coder',
      skillName: 'triage',
    });
    expect(trail).toBe('Agents > coder > Skills > triage > Evaluations');
  });

  it('says where a skill is being created', async () => {
    const { view, trail } = await trailAt('/agents/coder/skills/create', {
      agentName: 'coder',
    });
    expect(view).toBe('create-skill');
    expect(trail).toBe('Agents > coder > Skills');
  });

  it('leaves the logs page where it was, directly under the agent', async () => {
    const { view, trail } = await trailAt('/agents/coder/logs', {
      agentName: 'coder',
    });
    expect(view).toBe('agent-logs');
    expect(trail).toBe('Agents > coder > Logs');
  });
});
