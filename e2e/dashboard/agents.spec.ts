import { expect, type Page, test } from '@playwright/test';
import {
  AGENTS_PATH,
  createAgent,
  deleteAgent,
  SAMPLE_DESCRIPTION,
  uniqueAgentName,
} from '../fixtures/agents';
import {
  CHAT_COMPLETIONS_PATH,
  chatBody,
  saConfig,
  stubReset,
  uniqueModelName,
} from '../fixtures/gateway';
import { createSkill } from '../fixtures/skills';

test.describe('agents dashboard', () => {
  test('redirects the root to the agents list when auth is disabled', async ({
    page,
  }) => {
    // `/` always routes to `/login`, which bounces straight back out when
    // ACCESS_PASSWORD is unset. Worth pinning: it is the first thing every
    // visitor hits, and it depends on an API call succeeding.
    await page.goto('/');

    await expect(page).toHaveURL(/\/agents$/);
    await expect(
      page.getByRole('heading', { name: 'Agents', exact: true }),
    ).toBeVisible();
  });

  test('creates an agent through the form', async ({ page, request }) => {
    const name = uniqueAgentName('ui');

    await page.goto('/agents/create');

    await page.getByLabel('Agent Name').fill(name);
    await page.getByLabel('Description').fill(SAMPLE_DESCRIPTION);
    await page.getByRole('button', { name: 'Create Agent' }).click();

    // The form navigates to the new agent's page on success, which only
    // happens once the API call has actually returned a created agent.
    await expect(page).toHaveURL(new RegExp(`/agents/${name}$`));

    try {
      const listed = await request.get(AGENTS_PATH, { params: { name } });
      const agents = (await listed.json()) as { name: string }[];
      expect(agents.some((a) => a.name === name)).toBe(true);
    } finally {
      const all = (await (
        await request.get(AGENTS_PATH, { params: { name } })
      ).json()) as { id: string }[];
      for (const agent of all) {
        await deleteAgent(request, agent.id);
      }
    }
  });

  test('shows a validation error instead of submitting a short description', async ({
    page,
  }) => {
    await page.goto('/agents/create');

    await page.getByLabel('Agent Name').fill(uniqueAgentName('invalid'));
    await page.getByLabel('Description').fill('too short');
    await page.getByRole('button', { name: 'Create Agent' }).click();

    await expect(
      page.getByText('Description must be at least 25 characters'),
    ).toBeVisible();
    // Client-side validation should have stopped the navigation.
    await expect(page).toHaveURL(/\/agents\/create$/);
  });

  test('lists an agent created through the API', async ({ page, request }) => {
    // Seeded over HTTP rather than through the UI so the assertion is about
    // rendering the list, not about the create form.
    const name = uniqueAgentName('listed');
    const agent = await createAgent(request, name);

    try {
      await page.goto('/agents');

      // Scoped to the card heading: the name also appears in the sidebar, and
      // a bare text match would resolve to both.
      await expect(page.getByRole('heading', { name })).toBeVisible();
    } finally {
      await deleteAgent(request, agent.id);
    }
  });

  test('navigates to the AI providers and settings pages', async ({ page }) => {
    await page.goto('/agents');

    await page.getByRole('link', { name: 'AI Providers & Models' }).click();
    await expect(page).toHaveURL(/\/ai-providers$/);

    await page.getByRole('link', { name: 'Settings' }).click();
    await expect(page).toHaveURL(/\/settings$/);
  });

  test('loads without console errors', async ({ page }) => {
    // A React render crash still returns HTTP 200, so status codes alone would
    // not catch one. The console is what distinguishes a blank page from a
    // working one.
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') {
        errors.push(message.text());
      }
    });
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto('/agents');
    await expect(
      page.getByRole('heading', { name: 'Agents', exact: true }),
    ).toBeVisible();

    expect(errors).toEqual([]);
  });
});

test.describe('agent-wide logs page', () => {
  // The page renders only in the built bundle: it is a lazy route, so this
  // is what proves routeTree generation picked it up and the SPA fallback
  // serves it.
  test('serves the logs of a whole agent at /agents/:name/logs', async ({
    page,
    request,
  }) => {
    const name = uniqueAgentName('agent-logs-page');
    const agent = await createAgent(request, name);

    try {
      await page.goto(`/agents/${name}/logs`);

      await expect(
        page.getByText(`Request logs across all skills for ${name}`),
      ).toBeVisible();
      // A fresh agent has no logs; the empty state proves the agent-wide
      // query ran (rather than waiting forever on a skill id).
      await expect(page.getByText('No logs found')).toBeVisible();
    } finally {
      await deleteAgent(request, agent.id);
    }
  });
});

/**
 * Saves the edit form and waits for it to leave: saving navigates on its
 * own, and a `goto` issued while that is in flight is aborted.
 */
const save = async (page: Page): Promise<void> => {
  await page.getByRole('button', { name: /save changes/i }).click();
  await expect(page).not.toHaveURL(/\/edit$/);
};

test.describe('response review form', () => {
  // The reviewer is a Radix select, which jsdom cannot open, and the form
  // used to hand it an empty value on reset before its items had registered.
  // Both are only visible in a real browser.
  test('names a reviewer with its choices, shows them again, and clears them', async ({
    page,
    request,
  }) => {
    const guardName = uniqueAgentName('ui-guard');
    const guard = await createAgent(request, guardName);
    const name = uniqueAgentName('ui-reviewed');
    const agent = await createAgent(request, name);
    const stored = async () => {
      const rows = (await (
        await request.get(`${AGENTS_PATH}?id=${agent.id}`)
      ).json()) as {
        reviewer_agent_id: string | null;
        review_fail_closed: boolean;
        review_expose_reason: boolean;
      }[];
      return rows[0];
    };

    try {
      await page.goto(`/agents/${name}/edit`);
      await expect(page.getByLabel('Reviewer agent')).toHaveText('No review');
      // Nothing to fail closed on, or explain, without a reviewer.
      await expect(
        page.getByRole('switch', { name: 'Fail closed' }),
      ).toBeDisabled();
      await expect(
        page.getByRole('switch', { name: 'Explain denials' }),
      ).toBeDisabled();

      await page.getByLabel('Reviewer agent').click();
      await page.getByRole('option', { name: guardName }).click();
      await page.getByRole('switch', { name: 'Fail closed' }).click();
      await page.getByRole('switch', { name: 'Explain denials' }).click();
      await save(page);

      await expect.poll(stored).toEqual(
        expect.objectContaining({
          reviewer_agent_id: guard.id,
          review_fail_closed: true,
          review_expose_reason: true,
        }),
      );

      // Reopened, the form shows what was saved.
      await page.goto(`/agents/${name}/edit`);
      await expect(page.getByLabel('Reviewer agent')).toHaveText(guardName);
      await expect(
        page.getByRole('switch', { name: 'Fail closed' }),
      ).toBeChecked();
      await expect(
        page.getByRole('switch', { name: 'Explain denials' }),
      ).toBeChecked();

      await page.getByLabel('Reviewer agent').click();
      await page.getByRole('option', { name: 'No review' }).click();
      await expect(
        page.getByRole('switch', { name: 'Fail closed' }),
      ).toBeDisabled();
      await save(page);

      await expect
        .poll(async () => (await stored()).reviewer_agent_id)
        .toBeNull();
    } finally {
      await deleteAgent(request, agent.id);
      await deleteAgent(request, guard.id);
    }
  });
});

test.describe('log page', () => {
  test('survives back and forward, which restore it around a destroyed editor', async ({
    page,
    request,
  }) => {
    // Going back to the list and forward again restores the page from a
    // hidden tree, by which time the rich-text editor it held has been
    // destroyed. That used to crash the whole dashboard.
    const name = uniqueAgentName('log-page');
    const agent = await createAgent(request, name);
    const model = uniqueModelName('logpage');
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    try {
      await createSkill(request, agent.id, 'gateway_skill');
      const served = await request.post(CHAT_COMPLETIONS_PATH, {
        headers: { 'sa-config': saConfig(name, 'gateway_skill', { model }) },
        data: chatBody('keep the page alive'),
      });
      expect(served.status()).toBe(200);

      await page.goto(`/agents/${name}/logs`);
      await page.getByText('Chat Complete').first().click();
      await expect(page).toHaveURL(/\/logs\/[0-9a-f-]+$/);
      await expect(
        page.getByText('echo: keep the page alive').first(),
      ).toBeVisible();

      await page.goBack();
      await expect(page).toHaveURL(/\/logs$/);
      await page.goForward();

      await expect(
        page.getByText('echo: keep the page alive').first(),
      ).toBeVisible();
      await expect(page.getByText('Application Error')).toHaveCount(0);
      expect(errors).toEqual([]);
    } finally {
      await stubReset(request, model);
      await deleteAgent(request, agent.id);
    }
  });
});
