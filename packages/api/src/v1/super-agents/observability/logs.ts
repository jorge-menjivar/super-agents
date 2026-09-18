import type { AppEnv } from '@api/types/hono';
import { zValidator } from '@hono/zod-validator';
import {
  type Log,
  type LogSummary,
  LogsQueryParams,
} from '@shared/types/data/log';
import { Hono } from 'hono';

const app = new Hono<AppEnv>()
  .get(
    '/',
    zValidator('query', LogsQueryParams, (result, c) => {
      if (!result.success) {
        console.error('Query validation failed:', result.error.issues);
        return c.json(
          { error: 'Invalid query parameters', details: result.error.issues },
          400,
        );
      }
    }),
    async (c) => {
      try {
        const params = c.req.valid('query');
        let logs: Log[] = [];
        try {
          logs = await c.get('logs_storage_connector').getLogs(c, params);
        } catch (error) {
          console.error('Error from storage connector:', error);
          // Return empty array on storage errors, not an object
          logs = [];
        }
        return c.json(logs);
      } catch (error) {
        console.error('Error retrieving logs:', error);
        return c.json({ error: 'Failed to retrieve logs' }, 500);
      }
    },
  )
  /**
   * The same rows, read as a list rather than as conversations.
   *
   * Every table of requests asks here: a log row is mostly the bodies, no
   * table draws them, and reading a page of rows whole costs hundreds of
   * times what reading their scalars does. The conversation is what the log
   * detail fetches, one row at a time.
   */
  .get(
    '/summaries',
    zValidator('query', LogsQueryParams, (result, c) => {
      if (!result.success) {
        console.error('Query validation failed:', result.error.issues);
        return c.json(
          { error: 'Invalid query parameters', details: result.error.issues },
          400,
        );
      }
    }),
    async (c) => {
      try {
        const params = c.req.valid('query');
        let logs: LogSummary[] = [];
        try {
          logs = await c
            .get('logs_storage_connector')
            .getLogSummaries(c, params);
        } catch (error) {
          console.error('Error from storage connector:', error);
          logs = [];
        }
        return c.json(logs);
      } catch (error) {
        console.error('Error retrieving log summaries:', error);
        return c.json({ error: 'Failed to retrieve log summaries' }, 500);
      }
    },
  );

export default app;
