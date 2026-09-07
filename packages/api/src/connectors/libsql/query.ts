import type { Client, InValue, Row, Transaction } from '@libsql/client';
import type { z } from 'zod';
import { normaliseRow } from './rows';

/**
 * The query layer the connector methods sit on.
 *
 * PostgREST turns `{ agent_id: 'eq.x', limit: '10', order: 'name.asc' }` into
 * SQL on the server. These helpers do the same job in-process, which is why the
 * connector methods below read almost identically to their Supabase
 * counterparts: they build the same filter objects, and only the executor
 * differs.
 */

/** Columns stored as JSON text. Everything Postgres declared `JSONB`, plus the array columns. */
const JSON_COLUMNS: Record<string, string[]> = {
  agents: ['metadata'],
  skills: ['metadata', 'allowed_template_variables'],
  skill_optimization_clusters: ['centroid'],
  skill_routing: ['centroid', 'conversation_centroid'],
  tools: ['raw_data'],
  logs: [
    'base_sa_config',
    'ai_provider_request_log',
    'hook_logs',
    'metadata',
    'embedding',
    'user_metadata',
  ],
  improved_responses: ['original_response_body', 'improved_response_body'],
  ai_providers: ['custom_fields'],
  skill_optimization_arms: ['params'],
  skill_optimization_evaluations: ['params'],
  skill_optimization_evaluation_runs: ['results'],
  skill_events: ['metadata'],
  system_settings: ['options'],
};

// The view is `SELECT l.*` plus two computed columns, so it decodes like logs.
JSON_COLUMNS.logs_with_eval_scores = JSON_COLUMNS.logs;

/** Columns stored as INTEGER 0/1 that the schemas expect as booleans. */
const BOOL_COLUMNS: Record<string, string[]> = {
  agents: ['auto_create_skills', 'review_fail_closed', 'review_expose_reason'],
  skills: ['optimize', 'auto_created'],
};

/** Executes statements; a `Transaction` satisfies this as well as a `Client`. */
type Executor = Pick<Client, 'execute'> | Pick<Transaction, 'execute'>;

export interface Filters {
  [column: string]: InValue | undefined;
}

export interface SelectOptions {
  /** e.g. `'name asc'`, `'start_time desc'`. Applied verbatim, never user input. */
  orderBy?: string;
  limit?: number;
  offset?: number;
}

const whereClause = (filters: Filters): { sql: string; args: InValue[] } => {
  const entries = Object.entries(filters).filter(
    ([, value]) => value !== undefined,
  ) as [string, InValue][];

  if (entries.length === 0) {
    return { sql: '', args: [] };
  }

  return {
    sql: ` WHERE ${entries.map(([column]) => `${column} = ?`).join(' AND ')}`,
    args: entries.map(([, value]) => value),
  };
};

/** Decode a table's rows and validate them against the schema they belong to. */
export const parseRows = <T extends z.ZodType>(
  table: string,
  rows: Row[],
  schema: T,
): z.infer<T> => {
  const decoded = rows.map((row) =>
    normaliseRow(row, {
      json: JSON_COLUMNS[table],
      bool: BOOL_COLUMNS[table],
    }),
  );

  const parsed = schema.safeParse(decoded);
  if (!parsed.success) {
    throw new Error(
      `Failed to parse rows from libSQL table ${table}: ${parsed.error.message}`,
    );
  }
  return parsed.data;
};

export const selectFrom = async <T extends z.ZodType>(
  executor: Executor,
  table: string,
  filters: Filters,
  schema: T,
  options: SelectOptions = {},
): Promise<z.infer<T>> => {
  const where = whereClause(filters);
  const args: InValue[] = [...where.args];

  let sql = `SELECT * FROM ${table}${where.sql}`;
  if (options.orderBy) {
    sql += ` ORDER BY ${options.orderBy}`;
  }
  if (options.limit !== undefined) {
    sql += ' LIMIT ?';
    args.push(options.limit);
  }
  if (options.offset !== undefined) {
    // SQLite rejects OFFSET without LIMIT, so supply the no-op limit Postgres
    // implies. PostgREST allows offset alone.
    if (options.limit === undefined) {
      sql += ' LIMIT -1';
    }
    sql += ' OFFSET ?';
    args.push(options.offset);
  }

  const result = await executor.execute({ sql, args });
  return parseRows(table, result.rows, schema);
};

/**
 * Insert one row and return it as stored, so that defaults and trigger-written
 * columns come back the way PostgREST's `return=representation` provides them.
 */
export const insertInto = async <T extends z.ZodType>(
  executor: Executor,
  table: string,
  values: Record<string, InValue | undefined>,
  schema: T,
  /**
   * Overwrite the existing row when this column already holds the value,
   * rather than failing -- PostgREST's `resolution=merge-duplicates`.
   *
   * Only the columns being written are overwritten, which is what makes it
   * usable for completing a row opened earlier: the completion write names
   * every column it knows, and leaves the rest of the row alone.
   *
   * `RETURNING` is accurate here because no table used this way has an AFTER
   * UPDATE trigger; see `updateIn` for why that matters.
   */
  upsertOn?: string,
): Promise<z.infer<T>> => {
  const entries = Object.entries(values).filter(
    ([, value]) => value !== undefined,
  ) as [string, InValue][];

  const columns = entries.map(([column]) => column);

  const overwritten = columns.filter((column) => column !== upsertOn);
  const conflict =
    upsertOn && overwritten.length > 0
      ? ` ON CONFLICT(${upsertOn}) DO UPDATE SET ${overwritten
          .map((column) => `${column} = excluded.${column}`)
          .join(', ')}`
      : '';

  const result = await executor.execute({
    sql: `INSERT INTO ${table} (${columns.join(', ')})
          VALUES (${columns.map(() => '?').join(', ')})${conflict}
          RETURNING *`,
    args: entries.map(([, value]) => value),
  });

  return parseRows(table, result.rows, schema);
};

export const updateIn = async <T extends z.ZodType>(
  executor: Executor,
  table: string,
  filters: Filters,
  values: Record<string, InValue | undefined>,
  schema: T,
): Promise<z.infer<T>> => {
  const entries = Object.entries(values).filter(
    ([, value]) => value !== undefined,
  ) as [string, InValue][];

  if (entries.length === 0) {
    // Nothing to change; report the current state, as a no-op PATCH would.
    return selectFrom(executor, table, filters, schema);
  }

  const where = whereClause(filters);
  await executor.execute({
    sql: `UPDATE ${table} SET ${entries.map(([c]) => `${c} = ?`).join(', ')}${where.sql}`,
    args: [...entries.map(([, value]) => value), ...where.args],
  });

  /**
   * Read the row back rather than using `UPDATE ... RETURNING *`.
   *
   * SQLite computes RETURNING before AFTER triggers fire, so it would hand back
   * the `updated_at` from before the trigger rewrote it. Postgres uses a BEFORE
   * trigger, where RETURNING already sees the new value. Re-selecting is what
   * makes the two backends agree.
   *
   * Safe because every filter here is an equality on a column the update never
   * touches (`id`, or a bridge table's keys).
   */
  return selectFrom(executor, table, filters, schema);
};

export const deleteFrom = async (
  executor: Executor,
  table: string,
  filters: Filters,
): Promise<void> => {
  const where = whereClause(filters);
  await executor.execute({
    sql: `DELETE FROM ${table}${where.sql}`,
    args: where.args,
  });
};
