import type { APIRequestContext } from '@playwright/test';
import { createAgent, deleteAgent, uniqueAgentName } from '../fixtures/agents';
import {
  CHAT_COMPLETIONS_PATH,
  chatBody,
  saConfig,
  uniqueModelName,
} from '../fixtures/gateway';
import { createSkill } from '../fixtures/skills';
import { expect, test } from '../fixtures/test';

const AGENTS_PATH = '/v1/super-agents/agents';

interface RecentSkill {
  skill_id: string;
  name: string;
  last_used_at: number;
}

const recentSkills = async (
  request: APIRequestContext,
  agentId: string,
  limit?: number,
): Promise<RecentSkill[]> => {
  const response = await request.get(
    `${AGENTS_PATH}/${agentId}/recent-skills${
      limit === undefined ? '' : `?limit=${limit}`
    }`,
  );
  expect(response.status()).toBe(200);
  return (await response.json()) as RecentSkill[];
};

/** One request through the gateway, named at the skill that should serve it. */
const serve = async (
  request: APIRequestContext,
  agentName: string,
  skillName: string,
  model: string,
): Promise<void> => {
  const answered = await request.post(CHAT_COMPLETIONS_PATH, {
    headers: { 'sa-config': saConfig(agentName, skillName, { model }) },
    data: chatBody(`a request for ${skillName}`),
  });
  expect(answered.status()).toBe(200);
};

/**
 * The skills an agent used most recently.
 *
 * A skill row does not record this: it counts its requests and its
 * `updated_at` moves for clustering too, so the last time a skill answered is
 * only in its logs. The backends read it differently -- a correlated `MAX`
 * per skill in SQLite, an embedded newest-log-per-skill from PostgREST,
 * ordered here -- so the two have to agree on the order, on the skill that
 * has never served, and on the limit.
 */
test.describe('the skills an agent used most recently', () => {
  test('orders them by their last request and leaves out the unused', async ({
    request,
  }) => {
    const agent = await createAgent(request, uniqueAgentName('recent-skills'));
    const model = uniqueModelName('recent-skills');

    try {
      const first = await createSkill(request, agent.id, 'first_skill');
      const second = await createSkill(request, agent.id, 'second_skill');
      // Created and never called: it must not appear at all.
      const idle = await createSkill(request, agent.id, 'idle_skill');

      expect(await recentSkills(request, agent.id)).toEqual([]);

      await serve(request, agent.name, 'first_skill', model);
      await serve(request, agent.name, 'second_skill', model);

      // The log row is written as the request arrives but completed after the
      // answer, so the second skill takes a moment to overtake the first.
      await expect
        .poll(
          async () =>
            (await recentSkills(request, agent.id)).map((row) => row.name),
          { timeout: 15_000, message: 'the requests were never logged' },
        )
        .toEqual(['second_skill', 'first_skill']);

      let recent = await recentSkills(request, agent.id);
      expect(recent[0].skill_id).toBe(second.id);
      expect(recent[1].skill_id).toBe(first.id);
      // Newest first, and unix milliseconds on both backends.
      expect(recent[0].last_used_at).toBeGreaterThanOrEqual(
        recent[1].last_used_at,
      );
      expect(recent[0].last_used_at).toBeGreaterThan(Date.now() - 600_000);
      expect(recent.map((row) => row.skill_id)).not.toContain(idle.id);

      // Calling the first skill again moves it back to the top.
      await serve(request, agent.name, 'first_skill', model);
      await expect
        .poll(
          async () =>
            (await recentSkills(request, agent.id)).map((row) => row.name),
          { timeout: 15_000, message: 'the second request was never logged' },
        )
        .toEqual(['first_skill', 'second_skill']);

      // And the limit is the caller's, however many skills served.
      recent = await recentSkills(request, agent.id, 1);
      expect(recent.map((row) => row.name)).toEqual(['first_skill']);
    } finally {
      await deleteAgent(request, agent.id);
    }
  });

  test('answers with nothing for an agent that has no skills', async ({
    request,
  }) => {
    const agent = await createAgent(request, uniqueAgentName('recent-none'));
    try {
      expect(await recentSkills(request, agent.id)).toEqual([]);
    } finally {
      await deleteAgent(request, agent.id);
    }
  });
});
