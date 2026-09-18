import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AppContext } from '@api/types/hono';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ensureStorageReady,
  resetStorageReady,
  resolveCacheConnector,
  resolveLogsConnector,
  resolveUserDataConnector,
  usesLibsql,
} from '.';
import {
  libsqlCacheStorageConnector,
  libsqlLogsStorageConnector,
  libsqlUserDataStorageConnector,
  resetLibsqlClients,
} from './libsql';
import {
  supabaseCacheStorageConnector,
  supabaseLogsStorageConnector,
  supabaseUserDataStorageConnector,
} from './supabase';

const tempDirs: string[] = [];

const libsqlContext = (): AppContext => {
  const dir = mkdtempSync(join(tmpdir(), 'sa-select-'));
  tempDirs.push(dir);
  return {
    env: { LIBSQL_URL: `file:${join(dir, 'test.db')}` },
  } as unknown as AppContext;
};

const supabaseContext = (): AppContext =>
  ({
    env: { POSTGREST_URL: 'http://localhost:54321/rest/v1' },
  }) as unknown as AppContext;

beforeEach(() => {
  resetStorageReady();
  resetLibsqlClients();
});

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('storage backend selection', () => {
  it('keeps Supabase when LIBSQL_URL is unset', () => {
    const c = supabaseContext();

    expect(usesLibsql(c)).toBe(false);
    expect(resolveUserDataConnector(c)).toBe(supabaseUserDataStorageConnector);
    expect(resolveLogsConnector(c)).toBe(supabaseLogsStorageConnector);
    expect(resolveCacheConnector(c)).toBe(supabaseCacheStorageConnector);
  });

  it('selects libSQL when LIBSQL_URL is set', () => {
    const c = libsqlContext();

    expect(usesLibsql(c)).toBe(true);
    expect(resolveUserDataConnector(c)).toBe(libsqlUserDataStorageConnector);
    expect(resolveLogsConnector(c)).toBe(libsqlLogsStorageConnector);
    expect(resolveCacheConnector(c)).toBe(libsqlCacheStorageConnector);
  });

  it('selects per context rather than once per process', () => {
    // On Workers the environment only exists per request, so two contexts in
    // the same isolate must be able to resolve differently.
    expect(resolveUserDataConnector(libsqlContext())).toBe(
      libsqlUserDataStorageConnector,
    );
    expect(resolveUserDataConnector(supabaseContext())).toBe(
      supabaseUserDataStorageConnector,
    );
  });
});

describe('ensureStorageReady', () => {
  it('migrates a libSQL database on first use', async () => {
    const c = libsqlContext();

    await ensureStorageReady(c);

    const { getLibsqlClient } = await import('./libsql');
    const applied = await getLibsqlClient(c).execute(
      'SELECT version FROM schema_migrations ORDER BY version',
    );
    expect(applied.rows.map((r) => String(r.version))).toEqual([
      '0001_initial_schema',
      '0002_feedbacks_updated_at',
      '0003_default_system_settings',
      '0004_evaluation_run_lookup_indexes',
      '0005_log_summaries',
    ]);
  });

  it('runs the migration once even when called concurrently', async () => {
    const c = libsqlContext();

    // The cached promise is what stops a second request from starting its own
    // migration while the first is still running.
    await Promise.all([
      ensureStorageReady(c),
      ensureStorageReady(c),
      ensureStorageReady(c),
    ]);

    const { getLibsqlClient } = await import('./libsql');
    const applied = await getLibsqlClient(c).execute(
      'SELECT COUNT(*) AS n FROM schema_migrations',
    );
    const { libsqlMigrations } = await import('./libsql/schema');
    // Every migration, recorded exactly once -- one run, not three.
    expect(Number(applied.rows[0].n)).toBe(libsqlMigrations.length);
  });

  it('does nothing for a Supabase deployment', async () => {
    // Postgres is migrated by the `migrations` compose service, so there is
    // nothing to do here and no libSQL client should be built.
    await expect(
      ensureStorageReady(supabaseContext()),
    ).resolves.toBeUndefined();
  });

  it('retries after a failure rather than caching the rejection', async () => {
    const broken = {
      env: { LIBSQL_URL: 'file:/proc/definitely-not-writable/x.db' },
    } as unknown as AppContext;

    await expect(ensureStorageReady(broken)).rejects.toThrow();

    // A cached rejected promise would make every later request fail too.
    const working = libsqlContext();
    resetLibsqlClients();
    await expect(ensureStorageReady(working)).resolves.toBeUndefined();
  });
});
