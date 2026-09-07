#!/usr/bin/env node

/**
 * Bring an existing libSQL database up to the current `logs` schema, in place.
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
 * table, the rows copied across, then swapped.
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
  'status',
  'end_time',
  'duration',
  'ai_provider',
  'model',
  'ai_provider_request_log',
  'cache_status',
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

  if (!needsLogsRebuild && missingReviewColumns.length === 0) {
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
    await addReviewColumn(column);
  }
  if (needsLogsRebuild) {
    await rebuildLogs(columns);
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

const addReviewColumn = async ({ name, definition, after }) => {
  console.log(`Adding \`agents.${name}\`...`);
  await client.execute(`ALTER TABLE agents ADD COLUMN ${name} ${definition}`);
  for (const sql of after) {
    await client.execute(sql);
  }
  console.log(`Added \`agents.${name}\`.`);
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
      skill_id TEXT NOT NULL,
      cluster_id TEXT,
      method TEXT NOT NULL CHECK (method IN ('GET', 'POST', 'PUT', 'DELETE', 'PATCH')),
      endpoint TEXT NOT NULL,
      function_name TEXT NOT NULL,
      start_time INTEGER NOT NULL,
      first_token_time INTEGER,
      base_sa_config TEXT NOT NULL,
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

  const carried = columns
    .map((column) => column.name)
    .filter((name) => name !== 'error');
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
 * Re-record the fingerprint of every migration as the code now spells it, so
 * the next request does not refuse the database it has just been given.
 *
 * Safe only because the rebuild above is the schema change: the fingerprint
 * says "this database matches the code", and after the rebuild it does.
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
