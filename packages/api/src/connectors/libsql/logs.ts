import type { LogsStorageConnector } from '@api/types/connector';
import type { AppContext } from '@api/types/hono';
import {
  Log,
  type LogCreateParams,
  type LogFailParams,
  type LogStartParams,
  type LogsQueryParams,
} from '@shared/types/data/log';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { getLibsqlClient } from './client';
import { insertInto, parseRows } from './query';
import { asColumns, toJsonColumn } from './rows';

/**
 * Reads go through `logs_with_eval_scores`, which carries the computed
 * `avg_eval_score` and `eval_run_count`, exactly as the Supabase connector
 * does. Writes go to the `logs` table itself.
 */
export const libsqlLogsStorageConnector: LogsStorageConnector = {
  getLogs: async (
    c: AppContext,
    queryParams: LogsQueryParams,
  ): Promise<Log[]> => {
    const conditions: string[] = [];
    const args: (string | number)[] = [];

    const eq = (column: string, value: string | number | undefined) => {
      if (value !== undefined) {
        conditions.push(`${column} = ?`);
        args.push(value);
      }
    };

    eq('agent_id', queryParams.agent_id);
    eq('skill_id', queryParams.skill_id);
    eq('cluster_id', queryParams.cluster_id);
    // The arm is not a column. The row keeps `cluster_id`, which names the
    // partition but not which of its configurations was pulled, so the
    // gateway records that on the log as `metadata.served_configuration`.
    if (queryParams.arm_id !== undefined) {
      conditions.push(
        "json_extract(metadata, '$.served_configuration.id') = ?",
      );
      args.push(queryParams.arm_id);
    }
    eq('app_id', queryParams.app_id);
    eq('trace_id', queryParams.trace_id);
    eq('id', queryParams.id);
    eq('method', queryParams.method);
    eq('endpoint', queryParams.endpoint);
    eq('function_name', queryParams.function_name);
    eq('status', queryParams.status);
    eq('cache_status', queryParams.cache_status);

    if (queryParams.embedding_not_null) {
      conditions.push('embedding IS NOT NULL');
    }
    if (queryParams.unjudged) {
      conditions.push('eval_run_count = 0');
    }
    if (queryParams.after !== undefined) {
      conditions.push('start_time >= ?');
      args.push(queryParams.after);
    }
    if (queryParams.before !== undefined) {
      conditions.push('start_time <= ?');
      args.push(queryParams.before);
    }

    let sql = 'SELECT * FROM logs_with_eval_scores';
    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(' AND ')}`;
    }
    const direction = queryParams.order === 'asc' ? 'ASC' : 'DESC';
    sql += ` ORDER BY start_time ${direction}`;

    if (queryParams.limit !== undefined) {
      sql += ' LIMIT ?';
      args.push(queryParams.limit);
    }
    if (queryParams.offset !== undefined) {
      if (queryParams.limit === undefined) {
        sql += ' LIMIT -1';
      }
      sql += ' OFFSET ?';
      args.push(queryParams.offset);
    }

    const result = await getLibsqlClient(c).execute({ sql, args });
    return parseRows('logs_with_eval_scores', result.rows, z.array(Log));
  },

  startLog: async (
    c: AppContext,
    startParams: LogStartParams,
  ): Promise<void> => {
    const { base_sa_config, request_body, metadata, ...rest } =
      startParams as LogStartParams & Record<string, unknown>;

    await insertInto(
      getLibsqlClient(c),
      'logs',
      {
        ...asColumns(rest),
        base_sa_config: toJsonColumn(base_sa_config),
        request_body:
          request_body === undefined ? undefined : toJsonColumn(request_body),
        // NOT NULL, and nothing to put in `hook_logs` until the hooks have
        // run. `metadata` carries whatever the gateway has decided so far.
        hook_logs: toJsonColumn([]),
        metadata: toJsonColumn(metadata ?? {}),
      },
      z.array(Log),
      // A retried request could reuse an id; completing the row beats failing.
      'id',
    );
  },

  createLog: async (
    c: AppContext,
    createParams: LogCreateParams,
  ): Promise<Log> => {
    const {
      base_sa_config,
      ai_provider_request_log,
      hook_logs,
      metadata,
      embedding,
      user_metadata,
      id,
      ...rest
    } = createParams as LogCreateParams & Record<string, unknown>;

    const rows = await insertInto(
      getLibsqlClient(c),
      'logs',
      {
        ...asColumns(rest),
        // Completes the row opened when the request arrived, when there is
        // one. `startLog` does not await, so the insert may still be in
        // flight; the upsert makes the order between them not matter.
        id: (id as string | undefined) ?? uuidv4(),
        base_sa_config: toJsonColumn(base_sa_config),
        ai_provider_request_log: toJsonColumn(ai_provider_request_log),
        hook_logs: toJsonColumn(hook_logs ?? []),
        metadata: toJsonColumn(metadata ?? {}),
        embedding:
          embedding === undefined ? undefined : toJsonColumn(embedding),
        user_metadata:
          user_metadata === undefined ? undefined : toJsonColumn(user_metadata),
      },
      z.array(Log),
      'id',
    );

    return rows[0];
  },

  failLog: async (c: AppContext, failParams: LogFailParams): Promise<void> => {
    // An update, not an upsert: a request that failed before its row was
    // opened has nothing to close, and inventing a row here would record a
    // failure with none of the request it belongs to.
    //
    // `end_time IS NULL` is what makes this safe to call as a backstop on a
    // path that may already have completed the row: a request that was logged
    // successfully is left exactly as it is.
    await getLibsqlClient(c).execute({
      sql: `UPDATE logs
            SET status = ?, end_time = ?, duration = ?, error = ?
            WHERE id = ? AND end_time IS NULL`,
      args: [
        failParams.status,
        failParams.end_time,
        failParams.duration,
        failParams.error,
        failParams.id,
      ],
    });
  },

  deleteLog: async (c: AppContext, id: string): Promise<void> => {
    await getLibsqlClient(c).execute({
      sql: 'DELETE FROM logs WHERE id = ?',
      args: [id],
    });
  },
};
