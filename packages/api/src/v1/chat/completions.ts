import { RouterError } from '@api/errors/router';
import { tryTargets } from '@api/handlers/handler-utils';
import type { AppEnv } from '@api/types/hono';
import { Hono } from 'hono';

export const completionsRouter = new Hono<AppEnv>()
  /**
   * Handles the '/chat/completions' API request by selecting the appropriate provider(s) and making the request to them.
   */
  .post(async (c): Promise<Response> => {
    try {
      const saConfig = c.get('sa_config');
      const saRequestData = c.get('sa_request_data');

      const tryTargetsResponse = await tryTargets(c, saConfig, saRequestData);

      return tryTargetsResponse;
    } catch (err) {
      let statusCode = 500;
      let errorMessage = 'Something went wrong';

      if (!(err instanceof RouterError)) {
        // The client hears only that something went wrong; this is the
        // only record of what.
        console.error('[CHAT_COMPLETIONS] Request failed:', err);
      }

      if (err instanceof RouterError) {
        statusCode = 400;
        errorMessage = err.message;
      }

      return new Response(
        JSON.stringify({
          status: 'failure',
          message: errorMessage,
        }),
        {
          status: statusCode,
          headers: {
            'content-type': 'application/json',
          },
        },
      );
    }
  });
