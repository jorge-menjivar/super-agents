import { expect, test } from '@playwright/test';
import {
  AGENTS_PATH,
  createAgent,
  deleteAgent,
  SAMPLE_DESCRIPTION,
  uniqueAgentName,
} from '../fixtures/agents';

/**
 * The agent lifecycle against a real libSQL database.
 *
 * The connector unit tests already cover the SQL. What only shows up here is
 * the whole path holding together at once: the bundled server resolving the
 * native `libsql` addon, the migrations running on the first request, and the
 * Zod schemas round-tripping through actual HTTP rather than a test client.
 */
test.describe('agents API', () => {
  test('creates, reads, updates and deletes an agent', async ({ request }) => {
    const name = uniqueAgentName('lifecycle');

    const created = await createAgent(request, name);
    expect(created.id).toBeTruthy();
    expect(created.name).toBe(name);
    expect(created.description).toBe(SAMPLE_DESCRIPTION);

    try {
      const listed = await request.get(AGENTS_PATH);
      expect(listed.status()).toBe(200);
      const agents = (await listed.json()) as { id: string }[];
      expect(agents.map((a) => a.id)).toContain(created.id);

      const patched = await request.patch(`${AGENTS_PATH}/${created.id}`, {
        data: { description: `${SAMPLE_DESCRIPTION} Now edited.` },
      });
      expect(patched.status()).toBe(200);
      const updated = (await patched.json()) as {
        description: string;
        updated_at: string;
      };
      expect(updated.description).toBe(`${SAMPLE_DESCRIPTION} Now edited.`);

      // The libSQL connector re-selects after an UPDATE precisely so this is
      // the post-trigger value; SQLite's RETURNING would have given the old one.
      expect(new Date(updated.updated_at).getTime()).toBeGreaterThanOrEqual(
        new Date(created.updated_at).getTime(),
      );

      const removed = await request.delete(`${AGENTS_PATH}/${created.id}`);
      expect(removed.status()).toBe(204);

      const afterDelete = await request.get(AGENTS_PATH);
      const remaining = (await afterDelete.json()) as { id: string }[];
      expect(remaining.map((a) => a.id)).not.toContain(created.id);
    } finally {
      await deleteAgent(request, created.id);
    }
  });

  test('names another agent as reviewer, refuses itself, and forgets a deleted one', async ({
    request,
  }) => {
    const guard = await createAgent(request, uniqueAgentName('guard'));
    const reviewed = await createAgent(
      request,
      uniqueAgentName('reviewed'),
      undefined,
      { reviewer_agent_id: guard.id, review_expose_reason: true },
    );

    try {
      expect(reviewed.reviewer_agent_id).toBe(guard.id);
      expect(reviewed.review_expose_reason).toBe(true);

      const self = await request.patch(`${AGENTS_PATH}/${reviewed.id}`, {
        data: { reviewer_agent_id: reviewed.id },
      });
      expect(self.status()).toBe(400);

      const missing = await request.patch(`${AGENTS_PATH}/${reviewed.id}`, {
        data: { reviewer_agent_id: '00000000-0000-4000-8000-000000000000' },
      });
      expect(missing.status()).toBe(400);

      // ON DELETE SET NULL on both backends: the reviews stop, the agent stays.
      await deleteAgent(request, guard.id);
      const after = await request.get(`${AGENTS_PATH}?id=${reviewed.id}`);
      const [row] = (await after.json()) as {
        reviewer_agent_id: string | null;
      }[];
      expect(row.reviewer_agent_id).toBeNull();
    } finally {
      await deleteAgent(request, reviewed.id);
      await deleteAgent(request, guard.id);
    }
  });

  test('rejects a description below the minimum length', async ({
    request,
  }) => {
    const response = await request.post(AGENTS_PATH, {
      data: { name: uniqueAgentName('short'), description: 'too short' },
    });

    expect(response.status()).toBe(400);
    const body = (await response.json()) as { error?: { message?: string } };
    expect(body.error?.message).toContain('description');
  });

  test('rejects a name outside the permitted character class', async ({
    request,
  }) => {
    const response = await request.post(AGENTS_PATH, {
      data: { name: 'Has Spaces And Caps', description: SAMPLE_DESCRIPTION },
    });

    expect(response.status()).toBe(400);
  });

  test('rejects a duplicate name', async ({ request }) => {
    const name = uniqueAgentName('dupe');
    const created = await createAgent(request, name);

    try {
      const second = await request.post(AGENTS_PATH, {
        data: { name, description: SAMPLE_DESCRIPTION },
      });

      // The uniqueness constraint lives in the schema, so this asserts the
      // database error surfaces as a client error rather than a 500.
      expect(second.status()).toBeGreaterThanOrEqual(400);
      expect(second.status()).toBeLessThan(500);
    } finally {
      await deleteAgent(request, created.id);
    }
  });

  test('rejects a malformed id', async ({ request }) => {
    const response = await request.delete(`${AGENTS_PATH}/not-a-uuid`);

    expect(response.status()).toBe(400);
  });

  test('persists across requests', async ({ request }) => {
    // A write that survives into a separate connection is the thing that would
    // break if the connector ever held state in memory instead of the file.
    const name = uniqueAgentName('persist');
    const created = await createAgent(request, name);

    try {
      const response = await request.get(AGENTS_PATH, {
        params: { name },
      });
      expect(response.status()).toBe(200);
      const agents = (await response.json()) as { name: string }[];
      expect(agents.some((a) => a.name === name)).toBe(true);
    } finally {
      await deleteAgent(request, created.id);
    }
  });
});
