import {
  AGENTS_PATH,
  createAgent,
  deleteAgent,
  SAMPLE_DESCRIPTION,
  uniqueAgentName,
} from '../fixtures/agents';
import { createSkill, getSkills, SKILLS_PATH } from '../fixtures/skills';
import { expect, test } from '../fixtures/test';

/**
 * The column-type contract both storage backends have to satisfy.
 *
 * Postgres and SQLite disagree about almost every type this schema uses:
 * `JSONB`, `TIMESTAMPTZ`, `BOOLEAN`, `TEXT[]` and `FLOAT[]` all collapse onto
 * TEXT/INTEGER/REAL in SQLite, and `connectors/libsql/rows.ts` converts them
 * back by hand. Every case below is one of those conversions, so running this
 * file against both connectors is what proves the translation is faithful
 * rather than merely self-consistent.
 *
 * These run through HTTP on purpose: the Zod schemas are part of the contract,
 * and a value that survives the database but fails to serialise is still a bug.
 */
test.describe('storage type contract', () => {
  test('round-trips a JSON object through the metadata column', async ({
    request,
  }) => {
    // JSONB in Postgres, a TEXT column parsed on read in SQLite.
    const metadata = {
      nested: { deeply: { value: 42 } },
      list: [1, 2, 3],
      flag: true,
      absent: null,
      unicode: 'café — 日本語 — 🎉',
      empty: {},
      emptyList: [],
    };

    const response = await request.post(AGENTS_PATH, {
      data: {
        name: uniqueAgentName('json'),
        description: SAMPLE_DESCRIPTION,
        metadata,
      },
    });
    expect(response.status()).toBe(201);
    const created = (await response.json()) as {
      id: string;
      metadata: unknown;
    };

    try {
      expect(created.metadata).toEqual(metadata);

      // Re-read, because a connector could hold the object it was given rather
      // than the one the database returned.
      const listed = await request.get(AGENTS_PATH, {
        params: { id: created.id },
      });
      const [reread] = (await listed.json()) as { metadata: unknown }[];
      expect(reread.metadata).toEqual(metadata);
    } finally {
      await deleteAgent(request, created.id);
    }
  });

  test('round-trips booleans, floats and string arrays', async ({
    request,
  }) => {
    const agent = await createAgent(request, uniqueAgentName('types'));

    try {
      const skill = await createSkill(request, agent.id, 'type_probe', {
        // BOOLEAN in Postgres, INTEGER 0/1 in SQLite -- a connector that
        // forgets to convert returns 1 here and fails the Zod schema.
        optimize: true,
        // FLOAT: must not be rounded to an integer on the way through.
        exploration_temperature: 2.5,
        // TEXT[] in Postgres, a JSON-encoded TEXT column in SQLite.
        allowed_template_variables: ['datetime', 'user_name', 'locale'],
      });

      expect(skill.optimize).toBe(true);
      expect(typeof skill.optimize).toBe('boolean');
      expect(skill.exploration_temperature).toBe(2.5);
      expect(skill.allowed_template_variables).toEqual([
        'datetime',
        'user_name',
        'locale',
      ]);

      const [reread] = await getSkills(request, { id: skill.id });
      expect(reread.optimize).toBe(true);
      expect(reread.exploration_temperature).toBe(2.5);
      // Order is part of the contract: it carries meaning to the caller.
      expect(reread.allowed_template_variables).toEqual([
        'datetime',
        'user_name',
        'locale',
      ]);
    } finally {
      await deleteAgent(request, agent.id);
    }
  });

  test('round-trips false and an empty array without losing them', async ({
    request,
  }) => {
    // The falsy cases are the ones a `value || default` slip would silently
    // replace, and they would still look correct in a happy-path test.
    const agent = await createAgent(request, uniqueAgentName('falsy'));

    try {
      const skill = await createSkill(request, agent.id, 'falsy_probe', {
        optimize: false,
        allowed_template_variables: [],
      });

      expect(skill.optimize).toBe(false);
      expect(skill.allowed_template_variables).toEqual([]);

      const [reread] = await getSkills(request, { id: skill.id });
      expect(reread.optimize).toBe(false);
      expect(reread.allowed_template_variables).toEqual([]);
    } finally {
      await deleteAgent(request, agent.id);
    }
  });

  test('preserves NULL as null rather than dropping the key', async ({
    request,
  }) => {
    /**
     * PostgREST serialises a NULL column as JSON `null` and the Zod schemas
     * use `.nullable()`, so the libSQL connector has to preserve null instead
     * of mapping it to `undefined`. Dropping the key would still satisfy an
     * optional field and would only surface as a missing value much later.
     */
    const agent = await createAgent(request, uniqueAgentName('nulls'));

    try {
      const skill = await createSkill(request, agent.id, 'null_probe');

      for (const column of [
        'last_clustering_at',
        'last_clustering_log_start_time',
        'evaluations_regenerated_at',
        'evaluation_lock_acquired_at',
      ] as const) {
        expect(skill, `${column} should be present`).toHaveProperty(column);
        expect(skill[column], `${column} should be null`).toBeNull();
      }

      const [reread] = await getSkills(request, { id: skill.id });
      expect(reread.last_clustering_at).toBeNull();
      expect(reread.evaluations_regenerated_at).toBeNull();
    } finally {
      await deleteAgent(request, agent.id);
    }
  });

  test('round-trips a timestamp set to a value and back to null', async ({
    request,
  }) => {
    const agent = await createAgent(request, uniqueAgentName('stamps'));

    try {
      const skill = await createSkill(request, agent.id, 'stamp_probe');
      const moment = '2026-01-02T03:04:05.000Z';

      const set = await request.patch(`${SKILLS_PATH}/${skill.id}`, {
        data: { last_clustering_at: moment },
      });
      expect(set.status()).toBe(200);
      const withStamp = (await set.json()) as { last_clustering_at: string };

      // TIMESTAMPTZ in Postgres, TEXT in SQLite. Compared as instants because
      // the two are entitled to differ in formatting and offset.
      expect(new Date(withStamp.last_clustering_at).toISOString()).toBe(moment);

      const cleared = await request.patch(`${SKILLS_PATH}/${skill.id}`, {
        data: { last_clustering_at: null },
      });
      expect(cleared.status()).toBe(200);
      expect(
        ((await cleared.json()) as { last_clustering_at: null })
          .last_clustering_at,
      ).toBeNull();
    } finally {
      await deleteAgent(request, agent.id);
    }
  });

  test('advances updated_at on write and reports the new value', async ({
    request,
  }) => {
    /**
     * Both schemas keep `updated_at` current with an AFTER UPDATE trigger.
     * SQLite computes RETURNING *before* triggers fire, so the libSQL
     * connector re-selects after an UPDATE; without that it would answer with
     * the pre-trigger timestamp and this assertion is what catches it.
     */
    const agent = await createAgent(request, uniqueAgentName('touch'));

    try {
      const skill = await createSkill(request, agent.id, 'touch_probe');
      const before = new Date(skill.updated_at).getTime();

      const patched = await request.patch(`${SKILLS_PATH}/${skill.id}`, {
        data: { description: `${skill.description} Edited by the suite.` },
      });
      expect(patched.status()).toBe(200);
      const after = (await patched.json()) as { updated_at: string };

      expect(new Date(after.updated_at).getTime()).toBeGreaterThanOrEqual(
        before,
      );

      // The response has to match what a later read sees.
      const [reread] = await getSkills(request, { id: skill.id });
      expect(reread.updated_at).toBe(after.updated_at);
    } finally {
      await deleteAgent(request, agent.id);
    }
  });

  test('cascades a delete from an agent to its skills', async ({ request }) => {
    /**
     * Postgres enforces ON DELETE CASCADE by default; SQLite ignores foreign
     * keys entirely unless `PRAGMA foreign_keys = ON` is set on the
     * connection. If that pragma is ever dropped, the rows survive here and
     * nothing else would notice until an orphan turned up in a query.
     */
    const agent = await createAgent(request, uniqueAgentName('cascade'));
    const skill = await createSkill(request, agent.id, 'cascade_probe');

    expect(await getSkills(request, { id: skill.id })).toHaveLength(1);

    const deleted = await request.delete(`${AGENTS_PATH}/${agent.id}`);
    expect(deleted.status()).toBe(204);

    expect(await getSkills(request, { id: skill.id })).toHaveLength(0);
  });
});
