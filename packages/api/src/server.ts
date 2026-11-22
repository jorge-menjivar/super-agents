import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono, type MiddlewareHandler } from 'hono';
import { compress } from 'hono/compress';
import api from './v1';

const port = Number(process.env.PORT) || 3000;

/**
 * Directory holding the built dashboard, relative to the working directory the
 * process was started from. `serveStatic` does not accept absolute paths.
 */
const dashboardRoot = process.env.DASHBOARD_ROOT || './public';

/**
 * The dashboard is served from this process unless it was turned off
 * explicitly, or the build simply isn't there. The API-only image ships
 * without `public/`, so the check keeps that image working untouched, and
 * `SERVE_DASHBOARD=false` covers gateway-only deployments of the full image.
 */
const serveDashboard =
  process.env.SERVE_DASHBOARD !== 'false' && existsSync(dashboardRoot);

/**
 * Headers the nginx web container used to add to every response. Kept as-is so
 * that collapsing the two containers doesn't change the security posture.
 */
const securityHeaders: MiddlewareHandler = async (c, next) => {
  await next();
  c.header('X-Frame-Options', 'SAMEORIGIN');
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-XSS-Protection', '1; mode=block');
};

const app = new Hono()
  .use('*', securityHeaders)
  .get('/health', (c) => c.text('OK'))
  /**
   * The API carries its own `/v1` base path, so mounting it at the root
   * registers every route under `/v1` and leaves the rest of the URL space to
   * the dashboard.
   */
  .route('/', api);

/**
 * Anything left under `/v1` has to 404 as JSON, because the SPA fallback below
 * would otherwise answer a mistyped endpoint with `index.html` and a 200 —
 * a confusing failure for an API client.
 *
 * `commonVariablesMiddleware` already does this for the gateway endpoints, but
 * it deliberately skips `/v1/super-agents/*`, so that subtree would fall
 * through to the dashboard without this.
 */
app.all('/v1/*', (c) => c.json({ error: 'Not Found' }, 404));

if (serveDashboard) {
  // Vite writes content-hashed filenames into `assets/`, so they can be cached
  // indefinitely. This mirrors the `expires 1y` block from nginx.conf.
  app.use(
    '/assets/*',
    compress(),
    serveStatic({
      root: dashboardRoot,
      onFound: (_path, c) => {
        c.header('Cache-Control', 'public, max-age=31536000, immutable');
      },
    }),
  );

  // Unhashed files that ship alongside the bundle (favicon, manifest, images).
  app.use('*', serveStatic({ root: dashboardRoot }));

  // SPA fallback: any remaining path is a client-side route.
  app.get('*', serveStatic({ path: `${dashboardRoot}/index.html` }));
}

/**
 * Create the directory holding an embedded libSQL database.
 *
 * SQLite will create the database file but not the directory above it, and
 * migrations run lazily on the first request, so a missing directory produces
 * a container that passes its health check and then fails every API call with
 * `ConnectionFailed(... 14)`. Compose mounts a volume at this path, but a bare
 * `docker run` without `-v` does not, and neither does running the built
 * server straight from a checkout.
 *
 * Node-only on purpose: this entrypoint is not reachable from `src/index.ts`,
 * so the `node:fs` import never enters the Workers bundle -- and a `file:`
 * database is impossible there regardless, since `@libsql/client` resolves to
 * its HTTP-only build on workerd.
 */
const libsqlUrl = process.env.LIBSQL_URL;
if (libsqlUrl?.startsWith('file:')) {
  const directory = dirname(libsqlUrl.slice('file:'.length));
  try {
    mkdirSync(directory, { recursive: true });
  } catch (error) {
    // Not fatal here: the first query reports the real problem with more
    // context than a startup crash would, and a read-only mount holding an
    // existing database is still perfectly usable.
    console.warn(`Could not create the libSQL directory ${directory}:`, error);
  }
}

/**
 * Under `pnpm dev` the port is chosen at runtime and nobody sends requests to
 * it directly, so naming it here would only invite someone to try. The dev
 * runner sets this and prints its own summary instead; every other deployment
 * wants the address it is actually reachable on.
 */
const quietBanner = process.env.SA_QUIET_BANNER === 'true';

if (!quietBanner) {
  console.log(`Starting server on port ${port}...`);
}

// A rejection nothing handled is a bug, but not one worth the whole server:
// Node's default is to end the process on one, and every request in flight
// goes with it. The stream pumps used to raise them whenever a client stopped
// reading. Logged, so the bug is still seen.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection; the server keeps running:', reason);
});

serve({
  /**
   * `@hono/node-server` passes `{ incoming, outgoing }` as the Hono env, so
   * `c.env` would otherwise be empty of configuration. Merge `process.env` in
   * so the `@api/constants` getters resolve on Node the same way bindings
   * resolve on Cloudflare Workers.
   */
  fetch: (request, env) => app.fetch(request, { ...process.env, ...env }),
  port,
});

if (quietBanner) {
  console.log('Internal API Server is running');
} else {
  console.log(`Server is running on http://0.0.0.0:${port}`);
  console.log(
    serveDashboard
      ? `Dashboard served from ${dashboardRoot}`
      : 'Dashboard not served (API only)',
  );
}
