import { getAuthJwtSecret } from '@api/constants';
import type { AppContext } from '@api/types/hono';
import { getRuntimeKey } from 'hono/adapter';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('hono/adapter', async (importOriginal) => ({
  ...(await importOriginal<typeof import('hono/adapter')>()),
  getRuntimeKey: vi.fn(() => 'node'),
}));

const withEnv = (env: Record<string, string>) =>
  ({ env }) as unknown as AppContext;

/**
 * The secret signs dashboard sessions and the gateway's reviews. Without it
 * they are signed with a value anyone can read, which is fine on a developer's
 * machine and nowhere else.
 */
describe('getAuthJwtSecret', () => {
  afterEach(() => {
    vi.mocked(getRuntimeKey).mockReturnValue('node');
  });

  it('is the secret, wherever it is set', () => {
    expect(getAuthJwtSecret(withEnv({ AUTH_JWT_SECRET: 'shh' }))).toBe('shh');
  });

  it('falls back to the dummy in Node development', () => {
    expect(getAuthJwtSecret(withEnv({}))).toBeTruthy();
  });

  it('is required in production', () => {
    expect(() => getAuthJwtSecret(withEnv({ NODE_ENV: 'production' }))).toThrow(
      /AUTH_JWT_SECRET/,
    );
  });

  // Wrangler sets no NODE_ENV, so a Worker used to read as development and
  // sign with the dummy -- forgeable.
  it('is required on Workers, which set no NODE_ENV', () => {
    vi.mocked(getRuntimeKey).mockReturnValue('workerd');

    expect(() => getAuthJwtSecret(withEnv({}))).toThrow(/on Workers/);
  });
});
