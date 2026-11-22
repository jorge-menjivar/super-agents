import type { AppContext } from '@api/types/hono';
import type { HttpMethod } from '@api/types/http';
import { withClientTracing } from '@api/utils/super-agents/client-tracing';
import { SuperAgentsConfigPreProcessed } from '@shared/types/api/request/headers';
import {
  InvalidRequestBodyError,
  isKnownRoute,
  produceSuperAgentsRequestData,
  UnknownRouteError,
} from '@shared/utils/sa-request-data';
import { parseAgentSkillPath } from '@shared/utils/url';
import type { Next } from 'hono';
import { createMiddleware } from 'hono/factory';

import z from 'zod';

/**
 * Middleware to set common variables in the context
 */
export const commonVariablesMiddleware = createMiddleware(
  async (c: AppContext, next: Next) => {
    // Only set variables for  API requests
    if (c.req.url.includes('/v1/')) {
      // Don't set variables for Super Agents API requests
      if (!c.req.url.includes('/v1/super-agents')) {
        // The agent, and optionally the skill, can be named in the path
        // (`/v1/agents/:agent_name/skills/:skill_name/chat/completions` or
        // `/v1/agents/:agent_name/chat/completions`) instead of in the
        // `sa-config` header. When they are, the header is optional.
        const { pathname } = new URL(c.req.url);
        const agentSkillScope = parseAgentSkillPath(pathname);
        const method = c.req.method as HttpMethod;

        // Answer an unroutable path before asking for credentials or config, so
        // a mistyped URL reads as a mistyped URL.
        if (!isKnownRoute(method, c.req.url)) {
          return c.json(
            {
              error: `No API route matches ${method} ${pathname}`,
              // The scoped forms are easy to mistype, so point at them whenever
              // the path looks like an attempt at one. A path that already
              // names a skill got the shape right and only the endpoint wrong.
              ...(pathname.startsWith('/v1/agents/') &&
              !agentSkillScope?.skill_name
                ? {
                    hint: 'Expected /v1/agents/{agent_name}/{endpoint} or /v1/agents/{agent_name}/skills/{skill_name}/{endpoint}',
                  }
                : {}),
            },
            404,
          );
        }

        const configString = c.req.header('sa-config');
        if (!configString && !agentSkillScope) {
          return c.json({ error: 'Missing Super Agents config' }, 422);
        }
        const rawConfig = configString ? JSON.parse(configString) : {};

        // The path always wins over the header so that a client pointed at a
        // skill's base URL cannot accidentally target another skill. A path
        // that names only the agent leaves a skill from the header in place.
        const scopedConfig = agentSkillScope
          ? {
              ...rawConfig,
              agent_name: agentSkillScope.agent_name,
              ...(agentSkillScope.skill_name
                ? { skill_name: agentSkillScope.skill_name }
                : {}),
            }
          : rawConfig;
        // Tracing a client sends as plain headers rather than in the config
        const config = withClientTracing(scopedConfig, c.req.raw.headers);

        const saConfigPreProcessed = SuperAgentsConfigPreProcessed.safeParse(
          config,
          {
            error: (error) => `Invalid Super Agents config as ${error.message}`,
          },
        );
        if (saConfigPreProcessed.error) {
          const prettyError = z.prettifyError(saConfigPreProcessed.error);

          return c.json(
            {
              error: `--Invalid Super Agents config--\n ${prettyError}`,
              details: saConfigPreProcessed.error.message,
            },
            422,
          );
        }
        c.set('sa_config_pre_processed', saConfigPreProcessed.data);

        const body = await c.req.json();

        try {
          const saRequestData = produceSuperAgentsRequestData(
            method,
            c.req.url,
            c.req.header(),
            body,
          );
          c.set('sa_request_data', saRequestData);
        } catch (err) {
          // `isKnownRoute` ignores the body, so a route can still be ruled out
          // here by the request's stream mode or by its schema.
          if (err instanceof InvalidRequestBodyError) {
            return c.json({ error: err.message }, 422);
          }
          // The method and path were matched above, so a route ruled out
          // here was ruled out by its stream mode alone: `stream: true` to an
          // endpoint with nothing to stream, such as System One, which
          // answers in one pass. That is a 400 rather than a 404, because the
          // URL is right and it is the body that asks the route for something
          // it does not do; and rather than a 422, because the body was never
          // checked against a schema, there being no route to take one from.
          if (err instanceof UnknownRouteError) {
            const streaming = body?.stream === true;
            return c.json(
              {
                error: streaming
                  ? `${method} ${pathname} does not stream: send the request without "stream": true`
                  : `${method} ${pathname} only streams: send the request with "stream": true`,
              },
              400,
            );
          }
          throw err;
        }
      }
    }
    await next();
  },
);
