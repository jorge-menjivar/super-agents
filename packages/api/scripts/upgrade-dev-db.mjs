#!/usr/bin/env node

/**
 * Bring an existing libSQL database up to the current schema, in place.
 *
 * Migrations are edited rather than appended while the app has no deployments
 * (see AGENTS.md), and the libSQL runner refuses a database whose applied
 * migration no longer matches the code -- normally by telling you to delete
 * the file and start again. That is the right answer for a scratch database
 * and the wrong one for a development database with real history in it, which
 * is what this script is for.
 *
 * What changed: `logs` rows are now written when a request arrives rather
 * than when it finishes, so the columns that only exist once a provider has
 * answered had to stop being NOT NULL, and an `error` column was added for
 * requests that fail before reaching one.
 *
 * SQLite cannot relax NOT NULL with ALTER, so the table is rebuilt: a new
 * table, the rows copied across, then swapped. The same rebuild later
 * relaxed `skill_id`, once the row moved to before skill routing: until
 * routing has picked the skill there is none to write.
 *
 * Also two columns on `logs` for what a request is before a provider has
 * answered it: `request_body`, the body the caller sent, and
 * `served_system_prompt`, the prompt the pulled configuration rendered.
 * Both are additive, so an ALTER each suffices; the `logs_with_eval_scores`
 * view is `SELECT l.*`, which SQLite expands when the view is queried
 * rather than when it was created, so it picks them up untouched.
 *
 * Also the response review columns on `agents`: `reviewer_agent_id`, the
 * agent whose responses another agent reviews before the client sees them,
 * `review_fail_closed`, whether a response it could not judge is withheld,
 * and `review_expose_reason`, whether a client is told why one was.
 * Additive, so an ALTER each suffices -- SQLite allows a REFERENCES clause
 * on an added column when its default is NULL, which it is.
 *
 * The danger in that is `DROP TABLE logs`, because three tables reference
 * `logs(id)` ON DELETE CASCADE -- evaluation runs, feedbacks and improved
 * responses. Foreign keys have to be off for the drop, and `PRAGMA
 * foreign_keys` is a **no-op inside a transaction**, so it cannot be the
 * first statement of the batch: it has to be set on the connection first, and
 * the transaction opened by hand afterwards. Getting that wrong silently
 * deletes every evaluation score in the database, which is exactly what an
 * earlier version of this script did.
 *
 * The child rows are counted before and after as a guard, and the whole thing
 * rolls back if they do not match.
 *
 * Also the `decision` model type: a decision model answers questions with
 * probabilities (the System One API) and writes no text, so `models` grew a
 * third `model_type`. Two CHECKs on `models` name the types, and SQLite cannot
 * change a CHECK with ALTER, so `models` is rebuilt the same way `logs` is --
 * with one more thing to get right. Triggers on other tables (`agents`,
 * `system_settings`, the evaluations) read `models` in their bodies, and since
 * SQLite 3.26 renaming the new table into place re-parses every one of them
 * while `models` does not exist, and fails. `PRAGMA legacy_alter_table = ON`
 * skips that re-parse, which is safe here because the table ends up under the
 * very name those triggers already use.
 *
 *   pnpm db:upgrade [-- path-to-db]
 *
 * Defaults to `.local-data/dev.db`. Takes a backup first unless --no-backup.
 */

import { copyFileSync, existsSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@libsql/client';

// Lives under the api package because `@libsql/client` is its dependency and
// Node resolves imports from the importing file, not the working directory --
// a copy at the repo root cannot see it. Paths are taken from this file's own
// location for the same reason: the working directory is not the repo root.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

const args = process.argv.slice(2);
const noBackup = args.includes('--no-backup');
const given = args.find((arg) => !arg.startsWith('--'));
const dbPath = given
  ? resolve(process.cwd(), given)
  : resolve(repoRoot, '.local-data/dev.db');

if (!existsSync(dbPath)) {
  console.error(`No database at ${dbPath}`);
  process.exit(1);
}

// One connection, not a pool. `@libsql/client` 0.18 hands each `execute` a
// connection from a pool of twenty, and this script depends on statements
// sharing one: `PRAGMA foreign_keys = OFF` is per connection, and a `BEGIN`
// issued on one connection is not a transaction any other can `COMMIT`.
const client = createClient({ url: `file:${dbPath}`, concurrency: 1 });

/** Columns the current code expects on `logs`, in the order it creates them. */
const NULLABLE_NOW = [
  'skill_id',
  'status',
  'end_time',
  'duration',
  'ai_provider',
  'model',
  'ai_provider_request_log',
  'cache_status',
];

/**
 * Columns added to `logs` since the initial schema, as `schema.ts` spells
 * them. Additive and nullable, so an ALTER apiece is the whole upgrade.
 */
const LOG_COLUMNS = [
  { name: 'request_body', definition: 'TEXT', after: [] },
  { name: 'served_system_prompt', definition: 'TEXT', after: [] },
];

const columnsOf = async (table) => {
  const result = await client.execute(`PRAGMA table_info(${table})`);
  return result.rows.map((row) => ({
    name: String(row.name),
    notNull: Number(row.notnull) === 1,
  }));
};

const main = async () => {
  const columns = await columnsOf('logs');
  if (columns.length === 0) {
    console.error('This database has no `logs` table; nothing to upgrade.');
    process.exit(1);
  }

  const hasError = columns.some((column) => column.name === 'error');
  const stillNotNull = columns.filter(
    (column) => NULLABLE_NOW.includes(column.name) && column.notNull,
  );
  const needsLogsRebuild = !hasError || stillNotNull.length > 0;

  const agentColumns = await columnsOf('agents');
  const missingReviewColumns = REVIEW_COLUMNS.filter(
    ({ name }) => !agentColumns.some((column) => column.name === name),
  );
  const missingLogColumns = LOG_COLUMNS.filter(
    ({ name }) => !columns.some((column) => column.name === name),
  );
  const needsModelsRebuild = await modelsLackDecisionType();

  if (
    !needsLogsRebuild &&
    missingReviewColumns.length === 0 &&
    missingLogColumns.length === 0 &&
    !needsModelsRebuild
  ) {
    console.log('Already up to date; nothing to do.');
    await refreshFingerprints();
    return;
  }

  if (!noBackup) {
    const backup = `${dbPath}.backup-${Date.now()}`;
    copyFileSync(dbPath, backup);
    const size = (statSync(backup).size / 1024 / 1024).toFixed(1);
    console.log(`Backed up ${size} MB to ${backup}`);
  }

  for (const column of missingReviewColumns) {
    await addColumn('agents', column);
  }
  if (needsLogsRebuild) {
    await rebuildLogs(columns);
  }
  if (needsModelsRebuild) {
    await rebuildModels();
  }

  // Re-read: a rebuild builds the current shape, so what is still missing
  // afterwards is only what the rebuild did not cover.
  const rebuilt = await columnsOf('logs');
  for (const column of LOG_COLUMNS) {
    if (!rebuilt.some(({ name }) => name === column.name)) {
      await addColumn('logs', column);
    }
  }

  await refreshFingerprints();
};

/** The columns the response review is configured in, as `schema.ts` spells them. */
const REVIEW_COLUMNS = [
  {
    name: 'reviewer_agent_id',
    definition: `TEXT REFERENCES agents(id) ON DELETE SET NULL
       CHECK (reviewer_agent_id IS NULL OR reviewer_agent_id <> id)`,
    after: [
      'CREATE INDEX IF NOT EXISTS idx_agents_reviewer_agent_id ON agents(reviewer_agent_id)',
    ],
  },
  {
    name: 'review_fail_closed',
    definition:
      'INTEGER NOT NULL DEFAULT 0 CHECK (review_fail_closed IN (0, 1))',
    after: [],
  },
  {
    name: 'review_expose_reason',
    definition:
      'INTEGER NOT NULL DEFAULT 0 CHECK (review_expose_reason IN (0, 1))',
    after: [],
  },
];

const addColumn = async (table, { name, definition, after }) => {
  console.log(`Adding \`${table}.${name}\`...`);
  await client.execute(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  for (const sql of after) {
    await client.execute(sql);
  }
  console.log(`Added \`${table}.${name}\`.`);
};

/** `columns` are the current `logs` columns, from `columnsOf`. */
const rebuildLogs = async (columns) => {
  const { rows } = await client.execute('SELECT COUNT(*) AS n FROM logs');
  console.log(`Rebuilding \`logs\` (${rows[0].n} rows)...`);

  // Everything that would be taken with `logs` if the drop cascaded.
  const dependents = [
    'skill_optimization_evaluation_runs',
    'feedbacks',
    'improved_responses',
  ];
  const before = {};
  for (const table of dependents) {
    const result = await client.execute(`SELECT COUNT(*) AS n FROM ${table}`);
    before[table] = Number(result.rows[0].n);
  }

  // The current shape, from `libsqlMigrations`. Kept here rather than
  // imported because this script has to run against the built tree too.
  const create = `CREATE TABLE logs_upgraded (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      skill_id TEXT,
      cluster_id TEXT,
      method TEXT NOT NULL CHECK (method IN ('GET', 'POST', 'PUT', 'DELETE', 'PATCH')),
      endpoint TEXT NOT NULL,
      function_name TEXT NOT NULL,
      start_time INTEGER NOT NULL,
      first_token_time INTEGER,
      base_sa_config TEXT NOT NULL,
      request_body TEXT,
      status INTEGER,
      end_time INTEGER,
      duration INTEGER,
      ai_provider TEXT,
      model TEXT,
      ai_provider_request_log TEXT,
      hook_logs TEXT NOT NULL,
      metadata TEXT NOT NULL,
      embedding TEXT DEFAULT NULL,
      original_system_prompt TEXT,
      served_system_prompt TEXT,
      cache_status TEXT CHECK (
        cache_status IS NULL OR
        cache_status IN ('HIT', 'SEMANTIC_HIT', 'MISS', 'SEMANTIC_MISS', 'REFRESH', 'DISABLED')
      ),
      error TEXT,
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

  // Every column the old table has, `error` included when a previous
  // rebuild added it: leaving one out would drop its values in the copy.
  const carried = columns.map((column) => column.name);
  const columnList = carried.join(', ');

  // Off *before* the transaction opens: inside one it does nothing, and the
  // drop below would then cascade through every table referencing logs(id).
  // It sticks because the pool has a single connection, which the transaction
  // below then borrows -- a pragma is a property of the connection, not of the
  // statement that set it.
  await client.execute('PRAGMA foreign_keys = OFF');

  const statements = [
    'DROP VIEW IF EXISTS logs_with_eval_scores',
    create,
    `INSERT INTO logs_upgraded (${columnList}) SELECT ${columnList} FROM logs`,
    'DROP TABLE logs',
    'ALTER TABLE logs_upgraded RENAME TO logs',
    'CREATE INDEX IF NOT EXISTS idx_logs_agent_id ON logs(agent_id)',
    'CREATE INDEX IF NOT EXISTS idx_logs_skill_id ON logs(skill_id)',
    'CREATE INDEX IF NOT EXISTS idx_logs_start_time ON logs(start_time)',
    'CREATE INDEX IF NOT EXISTS idx_logs_end_time ON logs(end_time)',
    'CREATE INDEX IF NOT EXISTS idx_logs_app_id ON logs(app_id)',
    'CREATE INDEX IF NOT EXISTS idx_logs_status ON logs(status)',
    'CREATE INDEX IF NOT EXISTS idx_logs_cache_status ON logs(cache_status)',
    `CREATE VIEW IF NOT EXISTS logs_with_eval_scores AS
        SELECT
          l.*,
          (
            SELECT SUM(CAST(json_extract(result.value, '$.score') AS REAL) * e.weight)
                   / NULLIF(SUM(e.weight), 0)
            FROM skill_optimization_evaluation_runs er,
                 json_each(er.results) AS result
            JOIN skill_optimization_evaluations e
              ON e.id = json_extract(result.value, '$.evaluation_id')
            WHERE er.log_id = l.id
              AND json_extract(result.value, '$.score') IS NOT NULL
          ) AS avg_eval_score,
          (
            SELECT COUNT(*)
            FROM skill_optimization_evaluation_runs er
            WHERE er.log_id = l.id
          ) AS eval_run_count
        FROM logs l`,
  ];

  // Driven through `transaction()` rather than a bare `BEGIN`: `execute`
  // returns its connection to the pool afterwards, and a connection handed
  // back mid-transaction is rolled back on the way, so a `BEGIN` sent that way
  // is undone before the next statement runs.
  const tx = await client.transaction('write');
  try {
    for (const sql of statements) {
      await tx.execute(sql);
    }

    // The guard: if the drop took anything with it, none of this is kept.
    for (const table of dependents) {
      const result = await tx.execute(`SELECT COUNT(*) AS n FROM ${table}`);
      const now = Number(result.rows[0].n);
      if (now !== before[table]) {
        throw new Error(
          `${table} went from ${before[table]} rows to ${now}: the drop cascaded. Rolling back.`,
        );
      }
    }

    const violations = await tx.execute('PRAGMA foreign_key_check');
    if (violations.rows.length > 0) {
      throw new Error(
        `${violations.rows.length} foreign key violations after the rebuild. Rolling back.`,
      );
    }

    await tx.commit();
  } catch (e) {
    await tx.rollback().catch(() => {});
    throw e;
  } finally {
    await client.execute('PRAGMA foreign_keys = ON');
  }

  console.log('Rebuilt `logs`.');
};

/**
 * Whether `models` still has the CHECKs that predate decision models. A
 * database without a `models` table has nothing to rebuild.
 */
const modelsLackDecisionType = async () => {
  const { rows } = await client.execute(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'models'",
  );
  return rows.length > 0 && !String(rows[0].sql).includes("'decision'");
};

/**
 * Every column, on any table, that references `models(id)`: what the drop
 * would cascade into, or set to NULL, if foreign keys were on.
 */
const referencesToModels = async () => {
  const { rows: tables } = await client.execute(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
  );
  const references = [];
  for (const { name } of tables) {
    const keys = await client.execute(`PRAGMA foreign_key_list(${name})`);
    for (const key of keys.rows) {
      if (String(key.table) === 'models') {
        references.push({ table: String(name), column: String(key.from) });
      }
    }
  }
  return references;
};

const rebuildModels = async () => {
  const { rows } = await client.execute('SELECT COUNT(*) AS n FROM models');
  console.log(
    `Rebuilding \`models\` (${rows[0].n} rows) for decision models...`,
  );

  // Counted as the non-NULL references, so a drop that cascaded *or* set the
  // references to NULL shows up as a difference.
  const references = await referencesToModels();
  const countReferences = async (executor) => {
    const counts = {};
    for (const { table, column } of references) {
      const result = await executor.execute(
        `SELECT COUNT(*) AS n FROM ${table} WHERE ${column} IS NOT NULL`,
      );
      counts[`${table}.${column}`] = Number(result.rows[0].n);
    }
    return counts;
  };
  const before = await countReferences(client);

  // The table's own triggers and indexes go with it; they are put back as
  // they were. Unique constraints' automatic indexes have no SQL and come
  // back with the table.
  const { rows: attached } = await client.execute(
    `SELECT sql FROM sqlite_master
     WHERE tbl_name = 'models' AND type IN ('index', 'trigger') AND sql IS NOT NULL`,
  );
  const restore = attached.map((row) => String(row.sql));

  const carried = (await columnsOf('models')).map((column) => column.name);
  const columnList = carried.join(', ');

  // The current shape, from `libsqlMigrations`. Kept here rather than
  // imported because this script has to run against the built tree too.
  const create = `CREATE TABLE models_upgraded (
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
    )`;

  // Both set before the transaction opens, on the one connection it borrows:
  // `foreign_keys` is a no-op inside a transaction, and the drop would
  // otherwise null every agent's model and delete every skill's.
  await client.execute('PRAGMA foreign_keys = OFF');
  await client.execute('PRAGMA legacy_alter_table = ON');

  const tx = await client.transaction('write');
  try {
    await tx.execute(create);
    await tx.execute(
      `INSERT INTO models_upgraded (${columnList}) SELECT ${columnList} FROM models`,
    );
    await tx.execute('DROP TABLE models');
    await tx.execute('ALTER TABLE models_upgraded RENAME TO models');
    for (const sql of restore) {
      await tx.execute(sql);
    }

    const after = await countReferences(tx);
    for (const [reference, count] of Object.entries(before)) {
      if (after[reference] !== count) {
        throw new Error(
          `${reference} went from ${count} references to ${after[reference]}: the drop reached it. Rolling back.`,
        );
      }
    }

    const violations = await tx.execute('PRAGMA foreign_key_check');
    if (violations.rows.length > 0) {
      throw new Error(
        `${violations.rows.length} foreign key violations after the rebuild. Rolling back.`,
      );
    }

    await tx.commit();
  } catch (e) {
    await tx.rollback().catch(() => {});
    throw e;
  } finally {
    await client.execute('PRAGMA legacy_alter_table = OFF');
    await client.execute('PRAGMA foreign_keys = ON');
  }

  console.log('Rebuilt `models`; it now takes decision models.');
};

/**
 * Re-record the fingerprint of every migration as the code now spells it, so
 * the next request does not refuse the database it has just been given.
 *
 * Safe only because the rebuilds above are the schema change: the fingerprint
 * says "this database matches the code", and after them it does.
 */
const refreshFingerprints = async () => {
  const { libsqlMigrations } = await import(
    '../src/connectors/libsql/schema.ts'
  ).catch(() => ({ libsqlMigrations: null }));

  if (!libsqlMigrations) {
    console.log(
      'Could not read the migrations to re-fingerprint them; run `pnpm db:upgrade`.',
    );
    return;
  }

  for (const migration of libsqlMigrations) {
    const bytes = new TextEncoder().encode(migration.statements.join('\n;\n'));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const fingerprint = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, '0'),
    ).join('');

    await client.execute({
      sql: `INSERT INTO schema_migrations (version, fingerprint) VALUES (?, ?)
            ON CONFLICT(version) DO UPDATE SET fingerprint = excluded.fingerprint`,
      args: [migration.version, fingerprint],
    });
  }

  console.log(
    'Fingerprints updated; the next request will accept this database.',
  );
};

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => client.close());
