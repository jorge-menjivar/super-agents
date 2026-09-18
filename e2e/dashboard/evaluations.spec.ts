import type { Page } from '@playwright/test';
import { createAgent, deleteAgent, uniqueAgentName } from '../fixtures/agents';
import { createSkill, SKILLS_PATH } from '../fixtures/skills';
import { expect, test } from '../fixtures/test';

/**
 * Editing an evaluation's optional parameters, in a real browser.
 *
 * The reasoning effort is a Radix select, which cannot be opened under jsdom:
 * it needs pointer events a fake DOM does not deliver. So the unit tests
 * check the mapping behind the control, and this checks the control -- that
 * choosing a value stores it, and that choosing "Not set" removes it rather
 * than storing something. Absence is what sends an evaluation back to
 * following the judge's system settings, so the difference matters.
 */

const evaluationsOf = (skillId: string) =>
  `${SKILLS_PATH}/${skillId}/evaluations`;

/**
 * Saves, and waits for the form to leave.
 *
 * Saving navigates back on its own, and a `goto` issued while that is still
 * in flight is aborted by the browser -- which only shows up under load,
 * when the whole suite runs at once.
 */
const save = async (page: Page): Promise<void> => {
  await page
    .getByRole('button', { name: /save changes/i })
    .first()
    .click();
  await expect(page).not.toHaveURL(/\/edit$/);
};

test('sets and unsets an evaluation parameter through the form', async ({
  page,
  request,
}) => {
  const agent = await createAgent(request, uniqueAgentName('evalform'));

  try {
    const skill = await createSkill(request, agent.id, 'scored_skill');
    // turn_relevancy declares no AI parameters, so it is created without
    // asking a model anything.
    const created = await request.post(evaluationsOf(skill.id), {
      data: { methods: ['turn_relevancy'] },
    });
    expect(created.status()).toBe(200);
    const [evaluation] = (await request
      .get(evaluationsOf(skill.id))
      .then((r) => r.json())) as {
      id: string;
      params: Record<string, unknown>;
    }[];

    // It starts with neither override: that is what "follow the settings"
    // looks like in the database.
    expect(evaluation.params).not.toHaveProperty('reasoning_effort');

    await page.goto(
      `/agents/${agent.name}/skills/scored_skill/evaluations/${evaluation.id}/edit`,
    );

    const effort = page.getByLabel('reasoning effort');
    await expect(effort).toHaveText('Not set');

    await effort.click();
    await page.getByRole('option', { name: 'none', exact: true }).click();
    await save(page);

    await expect
      .poll(async () => {
        const [stored] = (await request
          .get(evaluationsOf(skill.id))
          .then((r) => r.json())) as { params: Record<string, unknown> }[];
        return stored.params.reasoning_effort;
      })
      .toBe('none');

    // And back: the unset item has to remove the key, not store a string
    // saying "not set".
    await page.goto(
      `/agents/${agent.name}/skills/scored_skill/evaluations/${evaluation.id}/edit`,
    );
    await expect(page.getByLabel('reasoning effort')).toHaveText('none');

    await page.getByLabel('reasoning effort').click();
    await page.getByRole('option', { name: 'Not set' }).click();
    await save(page);

    await expect
      .poll(async () => {
        const [stored] = (await request
          .get(evaluationsOf(skill.id))
          .then((r) => r.json())) as { params: Record<string, unknown> }[];
        return 'reasoning_effort' in stored.params;
      })
      .toBe(false);
  } finally {
    await deleteAgent(request, agent.id);
  }
});

test('shows a parameter the evaluation has never had', async ({
  page,
  request,
}) => {
  const agent = await createAgent(request, uniqueAgentName('evalshow'));

  try {
    const skill = await createSkill(request, agent.id, 'shown_skill');
    await request.post(evaluationsOf(skill.id), {
      data: { methods: ['turn_relevancy'] },
    });
    const [evaluation] = (await request
      .get(evaluationsOf(skill.id))
      .then((r) => r.json())) as { id: string }[];

    await page.goto(
      `/agents/${agent.name}/skills/shown_skill/evaluations/${evaluation.id}/edit`,
    );

    // Nothing stored it, and the form still offers it, with the description
    // that says what its absence means.
    await expect(page.getByLabel('max tokens')).toHaveValue('');
    await expect(page.getByLabel('max tokens')).toHaveAttribute(
      'placeholder',
      'Not set',
    );
    await expect(
      page.getByText(/Unset, the judge model's system setting applies/).first(),
    ).toBeVisible();
  } finally {
    await deleteAgent(request, agent.id);
  }
});
