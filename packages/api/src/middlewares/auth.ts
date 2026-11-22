import {
  AUTH_JWT_ALG,
  getAccessPassword,
  getAuthJwtSecret,
  getBearerToken,
} from '@api/constants';
import type { AppEnv } from '@api/types/hono';
import { AUTH_COOKIE_NAME } from '@api/utils/auth-cookie';
import type { MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import type { Factory } from 'hono/factory';
import { jwt } from 'hono/jwt';

/**
 * Authenticated middleware for API requests.
 *
 * Blocks unauthenticated requests when either ACCESS_PASSWORD or BEARER_TOKEN is configured.
 *
 * Authentication is checked in this order:
 * 1. JWT cookie (access_token) — set by the login flow when ACCESS_PASSWORD is configured
 * 2. Bearer token header — for programmatic API access
 *
 * If neither ACCESS_PASSWORD nor BEARER_TOKEN is configured, all requests are allowed through.
 * Auth endpoints (/v1/super-agents/auth/*) are always exempt.
 */
export const authenticatedMiddleware = (
  factory: Factory<AppEnv>,
): MiddlewareHandler =>
  factory.createMiddleware(async (c, next) => {
    // Allow access to auth endpoints so that we can login or verify authorization
    if (c.req.path.startsWith('/v1/super-agents/auth/')) {
      await next();
      return;
    }

    const bearerToken = getBearerToken(c);
    const accessPassword = getAccessPassword(c);

    // If neither ACCESS_PASSWORD nor BEARER_TOKEN is configured, skip auth
    if (!accessPassword && !bearerToken) {
      await next();
      return;
    }

    // Check JWT cookie first (set by login flow)
    const accessTokenCookie = getCookie(c, AUTH_COOKIE_NAME);
    if (accessTokenCookie) {
      // Read only here, where a session is checked: on a Worker the secret
      // is required, and a deployment without auth needs none.
      await jwt({
        cookie: AUTH_COOKIE_NAME,
        secret: getAuthJwtSecret(c),
        alg: AUTH_JWT_ALG,
      })(c, next);
      return;
    }

    // Check Bearer token header (for programmatic access)
    const bearerHeaderString = c.req.header('authorization');
    if (bearerHeaderString) {
      const parts = bearerHeaderString.split(' ');
      if (
        parts.length === 2 &&
        parts[0].toLowerCase() === 'bearer' &&
        bearerToken &&
        parts[1] === bearerToken
      ) {
        await next();
        return;
      }
    }

    c.res = c.text('Unauthorized', 401);
  });
