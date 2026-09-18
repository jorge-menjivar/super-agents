import { expect, test } from '../fixtures/test';

/**
 * The contract between the two halves the server merges.
 *
 * Since the API and the dashboard collapsed into one process, a single Hono app
 * decides whether a URL is an API route, a static file, or a client-side route
 * that has to fall back to `index.html`. None of that ordering runs under
 * `pnpm dev` -- Vite serves the dashboard there and proxies `/v1` away -- so
 * these are the checks that would otherwise only fail in a published image.
 */
test.describe('request routing', () => {
  test('serves the dashboard at the root', async ({ request }) => {
    const response = await request.get('/');

    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('text/html');
    // Matched loosely: Vite adds classes to the mount point, and the assertion
    // is that the SPA shell was served, not how it is styled.
    expect(await response.text()).toContain('id="root"');
  });

  test('falls back to index.html for client-side routes', async ({
    request,
  }) => {
    // Nothing on disk matches this path; the SPA fallback has to answer it or
    // deep links and refreshes break for every dashboard route.
    const response = await request.get('/agents');

    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('text/html');
  });

  test('answers an unknown /v1 path with JSON, not the dashboard', async ({
    request,
  }) => {
    /**
     * The sharp edge in the merge. `commonVariablesMiddleware` deliberately
     * skips `/v1/super-agents/*`, so without the explicit guard in `server.ts`
     * this subtree would fall through to the SPA and answer a mistyped endpoint
     * with `index.html` and a 200 -- baffling for an API client.
     */
    const response = await request.get('/v1/super-agents/no-such-endpoint');

    expect(response.status()).toBe(404);
    expect(response.headers()['content-type']).toContain('application/json');
    expect(await response.json()).toEqual({ error: 'Not Found' });
  });

  test('serves hashed assets as immutable', async ({ request }) => {
    const html = await (await request.get('/')).text();
    const asset = html.match(/\/assets\/[A-Za-z0-9._-]+\.js/)?.[0];
    expect(asset, 'index.html should reference a hashed asset').toBeTruthy();

    const response = await request.get(asset as string);
    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control']).toBe(
      'public, max-age=31536000, immutable',
    );
  });

  test('answers the health check', async ({ request }) => {
    const response = await request.get('/health');

    expect(response.status()).toBe(200);
    expect(await response.text()).toBe('OK');
  });

  test('sets the security headers the web container used to add', async ({
    request,
  }) => {
    // These moved from nginx into the Hono process when the containers merged;
    // nothing else would notice if they were dropped.
    const headers = (await request.get('/')).headers();

    expect(headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-xss-protection']).toBe('1; mode=block');
  });
});
