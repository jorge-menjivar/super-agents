import { expect, test } from '../fixtures/test';

/**
 * The settings document both storage backends have to agree about.
 *
 * Everything that needs no column of its own -- the timeout beside each
 * model, the judge's token budget, each text role's reasoning effort,
 * developer mode -- lives in one `options` column: JSONB in Postgres, TEXT
 * parsed on read in SQLite. That makes this the newest hand-written
 * conversion in `connectors/libsql/rows.ts`, and the one with the most
 * behaviour riding on it, because a PATCH is *merged* over what is stored
 * rather than replacing it. A backend that dropped a key, replaced the
 * document, or mapped JSON `null` onto a missing value would satisfy its own
 * tests and diverge only here.
 *
 * The settings row is a singleton the whole deployment shares, so every test
 * restores what it found. Only `options` is touched: the model ids belong to
 * whatever else is running.
 */

const SETTINGS_PATH = '/v1/super-agents/system-settings';

interface Options {
  system_prompt_reflection: { timeout_ms: number; reasoning_effort: unknown };
  evaluation_generation: { timeout_ms: number; reasoning_effort: unknown };
  embedding: { timeout_ms: number };
  judge: {
    timeout_ms: number;
    max_tokens: number;
    reasoning_effort: unknown;
  };
  skill_arbiter: { timeout_ms: number; reasoning_effort: unknown };
  intent_compaction: { timeout_ms: number; reasoning_effort: unknown };
  developer_mode: boolean;
}

const getOptions = async (request: {
  get: (path: string) => Promise<{ status: () => number; json: () => unknown }>;
}): Promise<Options> => {
  const response = await request.get(SETTINGS_PATH);
  expect(response.status()).toBe(200);
  return ((await response.json()) as { options: Options }).options;
};

// One at a time: these share the singleton row.
test.describe.configure({ mode: 'serial' });

test.describe('system settings options contract', () => {
  test('answers the whole document, with every default filled in', async ({
    request,
  }) => {
    // A row stored before a field existed reads as that field's default, and
    // the API is what has to say so -- on either backend.
    const options = await getOptions(request);

    expect(options.judge).toMatchObject({
      timeout_ms: expect.any(Number),
      max_tokens: expect.any(Number),
    });
    expect(options.judge).toHaveProperty('reasoning_effort');
    for (const role of [
      'system_prompt_reflection',
      'evaluation_generation',
      'embedding',
      'judge',
      'skill_arbiter',
      'intent_compaction',
    ] as const) {
      expect(options[role].timeout_ms).toBeGreaterThan(0);
    }
    expect(typeof options.developer_mode).toBe('boolean');
    // The embedding role has no effort to answer with: one forward pass.
    expect(options.embedding).not.toHaveProperty('reasoning_effort');
  });

  test('merges a patch over the stored document rather than replacing it', async ({
    request,
  }) => {
    const before = await getOptions(request);

    try {
      const first = await request.patch(SETTINGS_PATH, {
        data: { options: { judge: { timeout_ms: 90_000 } } },
      });
      expect(first.status()).toBe(200);

      // A second patch naming only the budget must not lose the timeout the
      // first one set, nor any role it never mentioned.
      const second = await request.patch(SETTINGS_PATH, {
        data: { options: { judge: { max_tokens: 16_000 } } },
      });
      expect(second.status()).toBe(200);
      const merged = ((await second.json()) as { options: Options }).options;

      expect(merged.judge.timeout_ms).toBe(90_000);
      expect(merged.judge.max_tokens).toBe(16_000);
      expect(merged.skill_arbiter).toEqual(before.skill_arbiter);
      expect(merged.embedding).toEqual(before.embedding);
      expect(merged.developer_mode).toBe(before.developer_mode);

      // Re-read: a connector could answer with the object it just built
      // rather than the one the database now holds.
      expect(await getOptions(request)).toEqual(merged);
    } finally {
      await request.patch(SETTINGS_PATH, {
        data: {
          options: {
            judge: {
              timeout_ms: before.judge.timeout_ms,
              max_tokens: before.judge.max_tokens,
            },
          },
        },
      });
    }
  });

  test('preserves a null reasoning effort instead of dropping the key', async ({
    request,
  }) => {
    /**
     * Null is a value here -- back to the model's own default -- not an
     * absence. Postgres stores JSON null inside the JSONB document; SQLite
     * stores the same text and parses it back. A backend that dropped the key
     * would still satisfy the schema, because the field has a default, and
     * the setting would silently fail to clear.
     */
    const before = await getOptions(request);

    try {
      const set = await request.patch(SETTINGS_PATH, {
        data: { options: { judge: { reasoning_effort: 'low' } } },
      });
      expect(set.status()).toBe(200);
      expect(
        ((await set.json()) as { options: Options }).options.judge
          .reasoning_effort,
      ).toBe('low');

      const cleared = await request.patch(SETTINGS_PATH, {
        data: { options: { judge: { reasoning_effort: null } } },
      });
      expect(cleared.status()).toBe(200);
      const options = ((await cleared.json()) as { options: Options }).options;

      expect(options.judge).toHaveProperty('reasoning_effort');
      expect(options.judge.reasoning_effort).toBeNull();
      // Clearing one field leaves the rest of the role alone.
      expect(options.judge.max_tokens).toBe(before.judge.max_tokens);

      expect((await getOptions(request)).judge.reasoning_effort).toBeNull();
    } finally {
      await request.patch(SETTINGS_PATH, {
        data: {
          options: {
            judge: { reasoning_effort: before.judge.reasoning_effort },
          },
        },
      });
    }
  });

  test('keeps each role’s reasoning effort independent', async ({
    request,
  }) => {
    const before = await getOptions(request);

    try {
      const response = await request.patch(SETTINGS_PATH, {
        data: {
          options: {
            skill_arbiter: { reasoning_effort: 'none' },
            system_prompt_reflection: { reasoning_effort: 'high' },
          },
        },
      });
      expect(response.status()).toBe(200);
      const options = ((await response.json()) as { options: Options }).options;

      expect(options.skill_arbiter.reasoning_effort).toBe('none');
      expect(options.system_prompt_reflection.reasoning_effort).toBe('high');
      // The roles are separate settings, not one shared value.
      expect(options.judge.reasoning_effort).toEqual(
        before.judge.reasoning_effort,
      );
      expect(options.intent_compaction.reasoning_effort).toEqual(
        before.intent_compaction.reasoning_effort,
      );
    } finally {
      await request.patch(SETTINGS_PATH, {
        data: {
          options: {
            skill_arbiter: {
              reasoning_effort: before.skill_arbiter.reasoning_effort,
            },
            system_prompt_reflection: {
              reasoning_effort:
                before.system_prompt_reflection.reasoning_effort,
            },
          },
        },
      });
    }
  });

  test('refuses a value it could not honour, leaving the row untouched', async ({
    request,
  }) => {
    const before = await getOptions(request);

    for (const options of [
      { judge: { reasoning_effort: 'ultra' } },
      // Embedding has no effort to set.
      { embedding: { reasoning_effort: 'low' } },
      { judge: { timeout_ms: 0 } },
      { judge: { max_tokens: 1 } },
      // The old flat column names, which are options now.
      { unknown_role: { timeout_ms: 1_000 } },
    ]) {
      const response = await request.patch(SETTINGS_PATH, {
        data: { options },
      });
      expect(response.status(), JSON.stringify(options)).toBe(400);
    }

    expect(await getOptions(request)).toEqual(before);
  });
});
