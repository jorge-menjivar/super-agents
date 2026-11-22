import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { libsqlMigrations } from '@api/connectors/libsql/schema';
import { createClient } from '@libsql/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const run = promisify(execFile);

/**
 * The in-place upgrade for a development database.
 *
 * This exists because an earlier version of the script deleted data: three
 * tables reference `logs(id)` ON DELETE CASCADE, and `PRAGMA foreign_keys =
 * OFF` is a no-op inside a transaction -- which `client.batch(..., 'write')`
 * opens -- so `DROP TABLE logs` took every evaluation run and every feedback
 * with it, silently, on a database with a quarter of a million rows in it.
 *
 * The rebuild is therefore tested against a database shaped like the one the
 * script is for: the old `logs` columns, and children hanging off it.
 */

const apiRoot = resolve(__dirname, '..');

/** The `logs` table as it was before the columns were relaxed. */
const OLD_LOGS = `CREATE TABLE logs (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  skill_id TEXT NOT NULL,
  cluster_id TEXT,
  method TEXT NOT NULL CHECK (method IN ('GET', 'POST', 'PUT', 'DELETE', 'PATCH')),
  endpoint TEXT NOT NULL,
  function_name TEXT NOT NULL,
  status INTEGER NOT NULL,
  start_time INTEGER NOT NULL,
  first_token_time INTEGER,
  end_time INTEGER NOT NULL,
  duration INTEGER NOT NULL,
  base_sa_config TEXT NOT NULL,
  ai_provider TEXT NOT NULL,
  model TEXT NOT NULL,
  ai_provider_request_log TEXT NOT NULL,
  hook_logs TEXT NOT NULL,
  metadata TEXT NOT NULL,
  embedding TEXT DEFAULT NULL,
  original_system_prompt TEXT,
  cache_status TEXT NOT NULL CHECK (
    cache_status IN ('HIT', 'SEMANTIC_HIT', 'MISS', 'SEMANTIC_MISS', 'REFRESH', 'DISABLED')
  ),
  trace_id TEXT,
  parent_span_id TEXT,
  span_id TEXT,
  span_name TEXT,
  app_id TEXT,
  external_user_id TEXT,
  external_user_human_name TEXT,
  user_metadata TEXT,
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
  FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE,
  FOREIGN KEY (cluster_id) REFERENCES skill_optimization_clusters(id) ON DELETE SET NULL
)`;

/** Only what the script reads or could destroy. */
const SETUP = [
  'CREATE TABLE agents (id TEXT PRIMARY KEY, name TEXT NOT NULL)',
  `CREATE TABLE skills (
     id TEXT PRIMARY KEY, agent_id TEXT NOT NULL,
     FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
   )`,
  'CREATE TABLE skill_optimization_clusters (id TEXT PRIMARY KEY)',
  OLD_LOGS,
  `CREATE TABLE skill_optimization_evaluation_runs (
     id TEXT PRIMARY KEY, log_id TEXT NOT NULL, results TEXT NOT NULL,
     FOREIGN KEY (log_id) REFERENCES logs(id) ON DELETE CASCADE
   )`,
  `CREATE TABLE feedbacks (
     id TEXT PRIMARY KEY, log_id TEXT NOT NULL, score REAL NOT NULL,
     FOREIGN KEY (log_id) REFERENCES logs(id) ON DELETE CASCADE
   )`,
  `CREATE TABLE improved_responses (
     id TEXT PRIMARY KEY, log_id TEXT NOT NULL,
     FOREIGN KEY (log_id) REFERENCES logs(id) ON DELETE CASCADE
   )`,
  // The recreated view joins this; the script restores the real one.
  `CREATE TABLE skill_optimization_evaluations (
     id TEXT PRIMARY KEY, weight REAL NOT NULL
   )`,
  `CREATE TABLE schema_migrations (
     version TEXT PRIMARY KEY, applied_at TEXT, fingerprint TEXT
   )`,
  `CREATE VIEW logs_with_eval_scores AS SELECT l.*, NULL AS avg_eval_score,
     (SELECT COUNT(*) FROM skill_optimization_evaluation_runs er WHERE er.log_id = l.id)
       AS eval_run_count
   FROM logs l`,
];

/** Rows the rebuild must not disturb. */
const SEED = [
  "INSERT INTO agents (id, name) VALUES ('a1', 'agent')",
  "INSERT INTO skills (id, agent_id) VALUES ('s1', 'a1')",
  "INSERT INTO skill_optimization_evaluations (id, weight) VALUES ('e1', 1.0)",
];

describe('upgrade-dev-db', () => {
  let dir: string;
  let dbPath: string;

  const client = () => createClient({ url: `file:${dbPath}` });

  const count = async (table: string): Promise<number> => {
    const c = client();
    try {
      const result = await c.execute(`SELECT COUNT(*) AS n FROM ${table}`);
      return Number(result.rows[0].n);
    } finally {
      c.close();
    }
  };

  const upgrade = () =>
    run(
      'pnpm',
      ['exec', 'tsx', 'scripts/upgrade-dev-db.mjs', dbPath, '--no-backup'],
      {
        cwd: apiRoot,
      },
    );

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'sa-upgrade-'));
    dbPath = join(dir, 'dev.db');

    const c = client();
    await c.execute('PRAGMA foreign_keys = ON');
    for (const sql of SETUP) {
      await c.execute(sql);
    }

    for (const sql of SEED) {
      await c.execute(sql);
    }
    for (let i = 0; i < 3; i++) {
      await c.execute({
        sql: `INSERT INTO logs (
                id, agent_id, skill_id, method, endpoint, function_name, status,
                start_time, end_time, duration, base_sa_config, ai_provider,
                model, ai_provider_request_log, hook_logs, metadata, cache_status
              ) VALUES (?, 'a1', 's1', 'POST', '/v1/chat/completions',
                        'chat_complete', 200, 1, 2, 1, '{}', 'openai', 'gpt-5',
                        '{}', '[]', '{}', 'MISS')`,
        args: [`log-${i}`],
      });
      await c.execute({
        sql: `INSERT INTO skill_optimization_evaluation_runs (id, log_id, results)
              VALUES (?, ?, '[]')`,
        args: [`run-${i}`, `log-${i}`],
      });
    }
    await c.execute(
      "INSERT INTO feedbacks (id, log_id, score) VALUES ('f1', 'log-0', 1.0)",
    );
    c.close();
  }, 30_000);

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('relaxes the columns a running request cannot fill, and adds `error`', async () => {
    await upgrade();

    const c = client();
    const info = await c.execute('PRAGMA table_info(logs)');
    c.close();

    const notNull = info.rows
      .filter((row) => Number(row.notnull) === 1)
      .map((row) => String(row.name));

    for (const column of [
      'status',
      'end_time',
      'duration',
      'ai_provider',
      'model',
      'ai_provider_request_log',
      'cache_status',
    ]) {
      expect(notNull).not.toContain(column);
    }
    // What a request has on arrival stays required.
    expect(notNull).toContain('agent_id');
    expect(notNull).toContain('start_time');
    expect(info.rows.some((row) => row.name === 'error')).toBe(true);
  }, 60_000);

  it('keeps every log row', async () => {
    await upgrade();
    expect(await count('logs')).toBe(3);
  }, 60_000);

  it('does not take the rows that cascade off logs with it', async () => {
    // The bug this file exists for: `DROP TABLE logs` inside a transaction
    // with foreign keys still on deletes every one of these.
    expect(await count('skill_optimization_evaluation_runs')).toBe(3);
    expect(await count('feedbacks')).toBe(1);

    await upgrade();

    expect(await count('skill_optimization_evaluation_runs')).toBe(3);
    expect(await count('feedbacks')).toBe(1);
  }, 60_000);

  it('leaves the view readable, so scores still resolve', async () => {
    await upgrade();

    const c = client();
    const result = await c.execute(
      'SELECT eval_run_count FROM logs_with_eval_scores WHERE id = ?'.replace(
        '?',
        "'log-0'",
      ),
    );
    c.close();

    expect(Number(result.rows[0].eval_run_count)).toBe(1);
  }, 60_000);

  it('is a no-op the second time', async () => {
    await upgrade();
    const { stdout } = await upgrade();

    expect(stdout).toContain('Already up to date');
    expect(await count('logs')).toBe(3);
    expect(await count('skill_optimization_evaluation_runs')).toBe(3);
  }, 120_000);
});

/**
 * The `decision` model type. SQLite cannot change a CHECK with ALTER, so
 * `models` is rebuilt -- and `models` has more hanging off it than `logs`:
 * rows that cascade (a skill's and an agent's models), references that are set
 * to NULL (an agent's role models), and triggers on other tables that read it.
 */
describe('upgrade-dev-db: decision models', () => {
  let dir: string;
  let dbPath: string;

  const client = () => createClient({ url: `file:${dbPath}` });

  const query = async (sql: string) => {
    const c = client();
    try {
      await c.execute('PRAGMA foreign_keys = ON');
      return await c.execute(sql);
    } finally {
      c.close();
    }
  };

  const upgrade = () =>
    run(
      'pnpm',
      ['exec', 'tsx', 'scripts/upgrade-dev-db.mjs', dbPath, '--no-backup'],
      { cwd: apiRoot },
    );

  /** `models` as it was before decision models, with what reads it. */
  const MODELS_SETUP = [
    'CREATE TABLE ai_providers (id TEXT PRIMARY KEY)',
    `CREATE TABLE models (
       id TEXT PRIMARY KEY,
       ai_provider_id TEXT NOT NULL,
       model_name TEXT NOT NULL,
       model_type TEXT NOT NULL DEFAULT 'text' CHECK (model_type IN ('text', 'embed')),
       embedding_dimensions INTEGER,
       created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
       updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
       FOREIGN KEY (ai_provider_id) REFERENCES ai_providers(id) ON DELETE CASCADE,
       UNIQUE (ai_provider_id, model_name),
       CONSTRAINT embedding_dimensions_only_for_embed CHECK (
         (model_type = 'embed' AND embedding_dimensions IS NOT NULL) OR
         (model_type = 'text' AND embedding_dimensions IS NULL)
       )
     )`,
    'CREATE INDEX idx_models_model_name ON models(model_name)',
    `CREATE TRIGGER models_updated_at AFTER UPDATE ON models FOR EACH ROW
     BEGIN
       UPDATE models SET updated_at = 'touched' WHERE rowid = NEW.rowid;
     END`,
    `CREATE TABLE agent_models (
       agent_id TEXT NOT NULL, model_id TEXT NOT NULL,
       PRIMARY KEY (agent_id, model_id),
       FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
       FOREIGN KEY (model_id) REFERENCES models(id) ON DELETE CASCADE
     )`,
    'ALTER TABLE agents ADD COLUMN judge_model_id TEXT REFERENCES models(id) ON DELETE SET NULL',
    // A trigger on another table that reads `models`: the reason renaming
    // the rebuilt table into place needs `legacy_alter_table`.
    `CREATE TRIGGER agents_judge_is_text BEFORE UPDATE OF judge_model_id ON agents
     FOR EACH ROW
     WHEN NEW.judge_model_id IS NOT NULL
       AND (SELECT model_type FROM models WHERE id = NEW.judge_model_id) IS NOT 'text'
     BEGIN
       SELECT RAISE(ABORT, 'judge must be a text model');
     END`,
    "INSERT INTO ai_providers (id) VALUES ('p1')",
    "INSERT INTO models (id, ai_provider_id, model_name) VALUES ('m1', 'p1', 'gpt-5')",
    `INSERT INTO models (id, ai_provider_id, model_name, model_type, embedding_dimensions)
     VALUES ('m2', 'p1', 'embed-3', 'embed', 768)`,
    "INSERT INTO agent_models (agent_id, model_id) VALUES ('a1', 'm1')",
    "UPDATE agents SET judge_model_id = 'm1' WHERE id = 'a1'",
  ];

  const insertDecisionModel = () =>
    query(
      `INSERT INTO models (id, ai_provider_id, model_name, model_type)
       VALUES ('m3', 'p1', 'jev-latest', 'decision')`,
    );

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'sa-upgrade-models-'));
    dbPath = join(dir, 'dev.db');

    const c = client();
    await c.execute('PRAGMA foreign_keys = ON');
    for (const sql of [...SETUP, ...SEED, ...MODELS_SETUP]) {
      await c.execute(sql);
    }
    c.close();
  }, 30_000);

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('lets a decision model in, which the old CHECK refused', async () => {
    await expect(insertDecisionModel()).rejects.toThrow();

    await upgrade();

    await insertDecisionModel();
    const result = await query("SELECT model_type FROM models WHERE id = 'm3'");
    expect(result.rows[0].model_type).toBe('decision');
  }, 60_000);

  it('keeps every model, and everything that references one', async () => {
    await upgrade();

    expect(
      (await query('SELECT id FROM models ORDER BY id')).rows,
    ).toHaveLength(2);
    // Cascaded, had foreign keys been on for the drop.
    expect((await query('SELECT * FROM agent_models')).rows).toHaveLength(1);
    // Set to NULL, had they been on.
    const agent = await query(
      "SELECT judge_model_id FROM agents WHERE id = 'a1'",
    );
    expect(agent.rows[0].judge_model_id).toBe('m1');
  }, 60_000);

  it('still keeps embedding dimensions to embed models alone', async () => {
    await upgrade();

    await expect(
      query(
        `INSERT INTO models (id, ai_provider_id, model_name, model_type, embedding_dimensions)
         VALUES ('m4', 'p1', 'jev-preview', 'decision', 768)`,
      ),
    ).rejects.toThrow();
    await expect(
      query(
        `INSERT INTO models (id, ai_provider_id, model_name, model_type)
         VALUES ('m5', 'p1', 'embed-4', 'embed')`,
      ),
    ).rejects.toThrow();
  }, 60_000);

  it("puts back the table's own triggers and indexes", async () => {
    await upgrade();

    const { rows } = await query(
      "SELECT name FROM sqlite_master WHERE tbl_name = 'models' AND sql IS NOT NULL ORDER BY name",
    );
    expect(rows.map((row) => row.name)).toEqual([
      'idx_models_model_name',
      'models',
      'models_updated_at',
    ]);

    await query("UPDATE models SET model_name = 'gpt-5.1' WHERE id = 'm1'");
    const touched = await query(
      "SELECT updated_at FROM models WHERE id = 'm1'",
    );
    expect(touched.rows[0].updated_at).toBe('touched');
  }, 60_000);

  it('leaves the triggers that read models working against the new table', async () => {
    await upgrade();
    await insertDecisionModel();

    await expect(
      query("UPDATE agents SET judge_model_id = 'm3' WHERE id = 'a1'"),
    ).rejects.toThrow('judge must be a text model');
  }, 60_000);

  it('still enforces the foreign keys to it', async () => {
    await upgrade();

    await expect(
      query(
        "INSERT INTO agent_models (agent_id, model_id) VALUES ('a1', 'nope')",
      ),
    ).rejects.toThrow();
  }, 60_000);

  it('is a no-op the second time', async () => {
    await upgrade();
    const { stdout } = await upgrade();

    expect(stdout).toContain('Already up to date');
    expect((await query('SELECT * FROM agent_models')).rows).toHaveLength(1);
  }, 120_000);
});

/**
 * Models, and everything the guard on a model's type reads, as little of it
 * as it reads: what holds a model in a place that takes only its type.
 */
const GUARDED_MODELS_SETUP = [
  'CREATE TABLE ai_providers (id TEXT PRIMARY KEY)',
  `CREATE TABLE models (
     id TEXT PRIMARY KEY,
     ai_provider_id TEXT NOT NULL,
     model_name TEXT NOT NULL,
     model_type TEXT NOT NULL DEFAULT 'text' CHECK (model_type IN ('text', 'embed', 'decision')),
     embedding_dimensions INTEGER,
     created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
     updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
     FOREIGN KEY (ai_provider_id) REFERENCES ai_providers(id) ON DELETE CASCADE,
     UNIQUE (ai_provider_id, model_name),
     CONSTRAINT embedding_dimensions_only_for_embed CHECK (
       (model_type = 'embed') = (embedding_dimensions IS NOT NULL)
     )
   )`,
  `CREATE TABLE agent_models (
     agent_id TEXT NOT NULL, model_id TEXT NOT NULL,
     PRIMARY KEY (agent_id, model_id),
     FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
     FOREIGN KEY (model_id) REFERENCES models(id) ON DELETE CASCADE
   )`,
  `CREATE TABLE skill_models (
     skill_id TEXT NOT NULL, model_id TEXT NOT NULL,
     PRIMARY KEY (skill_id, model_id),
     FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE,
     FOREIGN KEY (model_id) REFERENCES models(id) ON DELETE CASCADE
   )`,
  'ALTER TABLE agents ADD COLUMN system_prompt_reflection_model_id TEXT',
  'ALTER TABLE agents ADD COLUMN evaluation_generation_model_id TEXT',
  'ALTER TABLE agents ADD COLUMN judge_model_id TEXT',
  'ALTER TABLE agents ADD COLUMN skill_arbiter_model_id TEXT',
  'ALTER TABLE agents ADD COLUMN intent_compaction_model_id TEXT',
  'ALTER TABLE agents ADD COLUMN embedding_model_id TEXT',
  'ALTER TABLE skill_optimization_evaluations ADD COLUMN model_id TEXT',
  'ALTER TABLE skill_optimization_clusters ADD COLUMN embedding_model_id TEXT',
  `CREATE TABLE system_settings (
     id TEXT PRIMARY KEY,
     system_prompt_reflection_model_id TEXT, evaluation_generation_model_id TEXT,
     judge_model_id TEXT, skill_arbiter_model_id TEXT,
     intent_compaction_model_id TEXT, embedding_model_id TEXT
   )`,
  'CREATE TABLE skill_routing (skill_id TEXT, embedding_model_id TEXT)',
  "INSERT INTO ai_providers (id) VALUES ('p1')",
  "INSERT INTO models (id, ai_provider_id, model_name) VALUES ('gpt', 'p1', 'gpt-5')",
  `INSERT INTO models (id, ai_provider_id, model_name, model_type)
   VALUES ('jev', 'p1', 'jev-latest', 'decision')`,
];

/**
 * What serves an agent. `agents.agent_type` is added, the triggers that keep
 * an agent's models of its type are created, and the guard on a model's own
 * type -- which cannot be altered -- is replaced with one that also counts
 * the models serving agents and skills.
 */
describe('upgrade-dev-db: agent types', () => {
  let dir: string;
  let dbPath: string;

  const client = () => createClient({ url: `file:${dbPath}` });

  const query = async (sql: string) => {
    const c = client();
    try {
      await c.execute('PRAGMA foreign_keys = ON');
      return await c.execute(sql);
    } finally {
      c.close();
    }
  };

  const upgrade = () =>
    run(
      'pnpm',
      ['exec', 'tsx', 'scripts/upgrade-dev-db.mjs', dbPath, '--no-backup'],
      { cwd: apiRoot },
    );

  /** Agents, skills and their models as they were before agent types. */
  const AGENT_TYPE_SETUP = [
    ...GUARDED_MODELS_SETUP,
    // The guard as it was, before it knew about serving models.
    `CREATE TRIGGER models_prevent_type_change_if_referenced
     BEFORE UPDATE OF model_type ON models
     FOR EACH ROW
     WHEN NEW.model_type IS NOT OLD.model_type
     BEGIN
       SELECT CASE WHEN EXISTS (
         SELECT 1 FROM agents WHERE skill_arbiter_model_id = NEW.id
       ) THEN RAISE(ABORT, 'cannot change model_type while the model is referenced') END;
     END`,
    "INSERT INTO skill_models (skill_id, model_id) VALUES ('s1', 'gpt')",
  ];

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'sa-upgrade-agent-type-'));
    dbPath = join(dir, 'dev.db');

    const c = client();
    await c.execute('PRAGMA foreign_keys = ON');
    for (const sql of [...SETUP, ...SEED, ...AGENT_TYPE_SETUP]) {
      await c.execute(sql);
    }
    c.close();
  }, 30_000);

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('makes every existing agent an LLM agent', async () => {
    await upgrade();

    const { rows } = await query('SELECT id, agent_type FROM agents');
    expect(rows.map((row) => [row.id, row.agent_type])).toEqual([
      ['a1', 'text'],
    ]);
  }, 60_000);

  it('refuses a model of another type for an agent or one of its skills', async () => {
    await upgrade();

    await expect(
      query(
        "INSERT INTO agent_models (agent_id, model_id) VALUES ('a1', 'jev')",
      ),
    ).rejects.toThrow("model of the agent's type");
    await expect(
      query(
        "INSERT INTO skill_models (skill_id, model_id) VALUES ('s1', 'jev')",
      ),
    ).rejects.toThrow("model of the skill's agent's type");
    await query(
      "INSERT INTO agent_models (agent_id, model_id) VALUES ('a1', 'gpt')",
    );
  }, 60_000);

  it('keeps the type of an agent whose skills have models', async () => {
    await upgrade();

    await expect(
      query("UPDATE agents SET agent_type = 'decision' WHERE id = 'a1'"),
    ).rejects.toThrow('cannot change agent_type');

    await query("DELETE FROM skill_models WHERE skill_id = 's1'");
    await query("UPDATE agents SET agent_type = 'decision' WHERE id = 'a1'");
  }, 60_000);

  it('keeps the type of a model that serves a skill', async () => {
    // Before, nothing stopped it.
    await query("UPDATE models SET model_type = 'decision' WHERE id = 'gpt'");
    await query("UPDATE models SET model_type = 'text' WHERE id = 'gpt'");

    await upgrade();

    await expect(
      query("UPDATE models SET model_type = 'decision' WHERE id = 'gpt'"),
    ).rejects.toThrow(
      'Cannot change model_type for a model that serves an agent or a skill',
    );
  }, 60_000);

  it('is a no-op the second time', async () => {
    await upgrade();
    const { stdout } = await upgrade();

    expect(stdout).toContain('Already up to date');
  }, 120_000);
});

/**
 * The guard on a model's type, which once counted only one of an agent's own
 * models -- the arbiter -- and so let an agent's judge become a decision
 * model, which writes nothing to judge with. Postgres counted all six. A
 * trigger cannot be altered, so the guard is replaced whenever its text is
 * not the one a new database is created with.
 */
describe('upgrade-dev-db: the guard on a model type', () => {
  let dir: string;
  let dbPath: string;

  const client = () => createClient({ url: `file:${dbPath}` });

  const query = async (sql: string) => {
    const c = client();
    try {
      await c.execute('PRAGMA foreign_keys = ON');
      return await c.execute(sql);
    } finally {
      c.close();
    }
  };

  const upgrade = () =>
    run(
      'pnpm',
      ['exec', 'tsx', 'scripts/upgrade-dev-db.mjs', dbPath, '--no-backup'],
      { cwd: apiRoot },
    );

  const guardSql = async () => {
    const { rows } = await query(
      "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'models_prevent_type_change_if_referenced'",
    );
    return String(rows[0].sql);
  };

  /** The guard as it was before it counted all of an agent's own models. */
  const PREVIOUS_GUARD = `CREATE TRIGGER models_prevent_type_change_if_referenced
     BEFORE UPDATE OF model_type ON models
     FOR EACH ROW
     WHEN NEW.model_type IS NOT OLD.model_type
     BEGIN
       SELECT CASE WHEN EXISTS (
         SELECT 1 FROM agents WHERE skill_arbiter_model_id = NEW.id
       ) OR EXISTS (
         SELECT 1 FROM agent_models WHERE model_id = NEW.id
       ) OR EXISTS (
         SELECT 1 FROM skill_models WHERE model_id = NEW.id
       ) THEN RAISE(ABORT, 'cannot change model_type while the model is referenced') END;
     END`;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'sa-upgrade-model-guard-'));
    dbPath = join(dir, 'dev.db');

    const c = client();
    await c.execute('PRAGMA foreign_keys = ON');
    for (const sql of [
      ...SETUP,
      ...SEED,
      ...GUARDED_MODELS_SETUP,
      PREVIOUS_GUARD,
      "UPDATE agents SET judge_model_id = 'gpt' WHERE id = 'a1'",
    ]) {
      await c.execute(sql);
    }
    c.close();
  }, 30_000);

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('keeps the type of the model an agent judges with', async () => {
    // Before, nothing stopped it.
    await query("UPDATE models SET model_type = 'decision' WHERE id = 'gpt'");
    await query("UPDATE models SET model_type = 'text' WHERE id = 'gpt'");

    await upgrade();

    await expect(
      query("UPDATE models SET model_type = 'decision' WHERE id = 'gpt'"),
    ).rejects.toThrow(
      'Cannot change model_type for a model that an agent asks for itself',
    );
  }, 60_000);

  it('leaves the guard a new database is created with', async () => {
    await upgrade();

    const created = libsqlMigrations
      .flatMap((migration) => migration.statements)
      .find((sql) => sql.includes('models_prevent_type_change_if_referenced'));
    expect(await guardSql()).toBe(created?.replace('IF NOT EXISTS ', ''));
  }, 60_000);

  // Upgraded in every other way, the guard alone is reason enough to run.
  it('replaces the guard when it is all that is out of date', async () => {
    await upgrade();
    await query('DROP TRIGGER models_prevent_type_change_if_referenced');
    await query(PREVIOUS_GUARD);

    const { stdout } = await upgrade();

    expect(stdout).not.toContain('Already up to date');
    expect(stdout).toContain('Replaced the guard on a model type');
    expect(await guardSql()).not.toBe(PREVIOUS_GUARD);
  }, 120_000);

  it('is a no-op the second time', async () => {
    await upgrade();
    const { stdout } = await upgrade();

    expect(stdout).toContain('Already up to date');
  }, 120_000);
});
