import type { APIRequestContext } from '@playwright/test';
import { createAgent, deleteAgent, uniqueAgentName } from '../fixtures/agents';
import { createSkill, SKILLS_PATH } from '../fixtures/skills';
import { expect, test } from '../fixtures/test';

const SUMMARIES_PATH = `${SKILLS_PATH}/summaries`;

/** The prompt a skill the gateway created starts as a pass-through with. */
const SEED_PROMPT =
  'You are a meticulous release engineer. Answer only with the command to run.';

const summaries = async (
  request: APIRequestContext,
  agentId: string,
): Promise<Record<string, unknown>[]> => {
  const response = await request.get(`${SUMMARIES_PATH}?agent_id=${agentId}`);
  expect(response.status()).toBe(200);
  return (await response.json()) as Record<string, unknown>[];
};

/**
 * A skill read as a list row.
 *
 * `seed_system_prompt` is the caller's whole system prompt, tens of kilobytes
 * per skill and almost all of what listing an agent's skills transfers, and
 * nothing in the dashboard draws it. Each backend leaves it out its own way --
 * the columns named in SQLite, a PostgREST `select` in Postgres -- and the two
 * have to leave out the same one and keep the same rest. The whole skill is
 * still there on the route beside it, which is what the gateway reads.
 */
test.describe('a skill read as a list row', () => {
  test('keeps every column but the prompt it was seeded from', async ({
    request,
  }) => {
    const agent = await createAgent(request, uniqueAgentName('summaries'));

    try {
      const seeded = await createSkill(request, agent.id, 'seeded_skill', {
        seed_system_prompt: SEED_PROMPT,
      });
      await createSkill(request, agent.id, 'bare_skill');

      const rows = await summaries(request, agent.id);
      expect(rows).toHaveLength(2);

      const summary = rows.find((row) => row.id === seeded.id);
      if (!summary) throw new Error('the seeded skill was not listed');

      // The one column left out, for the skill that has one.
      expect(summary).not.toHaveProperty('seed_system_prompt');

      // And everything a list draws, unchanged.
      expect(summary.name).toBe('seeded_skill');
      expect(summary.agent_id).toBe(agent.id);
      expect(summary.optimize).toBe(false);
      expect(summary.auto_created).toBe(false);
      expect(summary.total_requests).toBe(0);
      expect(summary.metadata).toEqual({});
      expect(summary.allowed_template_variables).toEqual([]);
      expect(summary.last_clustering_at).toBeNull();
      expect(typeof summary.created_at).toBe('string');

      // Every column of the skill but that one, so a summary and the skill
      // itself differ in exactly the prompt.
      const whole = await request
        .get(`${SKILLS_PATH}?id=${seeded.id}`)
        .then((r) => r.json() as Promise<Record<string, unknown>[]>);
      expect(whole[0].seed_system_prompt).toBe(SEED_PROMPT);
      expect(Object.keys(summary).sort()).toEqual(
        Object.keys(whole[0])
          .filter((key) => key !== 'seed_system_prompt')
          .sort(),
      );
    } finally {
      await deleteAgent(request, agent.id);
    }
  });

  test('takes the same filters and paging as the skills themselves', async ({
    request,
  }) => {
    const agent = await createAgent(request, uniqueAgentName('summaries-page'));

    try {
      await createSkill(request, agent.id, 'first_skill');
      await createSkill(request, agent.id, 'second_skill');

      const named = await request.get(
        `${SUMMARIES_PATH}?agent_id=${agent.id}&name=second_skill`,
      );
      expect(named.status()).toBe(200);
      const rows = (await named.json()) as { name: string }[];
      expect(rows.map((row) => row.name)).toEqual(['second_skill']);

      const limited = await request.get(
        `${SUMMARIES_PATH}?agent_id=${agent.id}&limit=1`,
      );
      expect(((await limited.json()) as unknown[]).length).toBe(1);
    } finally {
      await deleteAgent(request, agent.id);
    }
  });
});
