import { commonVariablesMiddleware } from '@api/middlewares/variables';
import type { AppEnv } from '@api/types/hono';
import { FunctionName } from '@shared/types/api/request';
import type { SuperAgentsConfigPreProcessed } from '@shared/types/api/request/headers';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

interface EchoedRequest {
  config: SuperAgentsConfigPreProcessed;
  function_name: FunctionName;
  url: string;
}

const CHAT_COMPLETION_BODY = {
  model: 'gpt-4o-mini',
  messages: [{ role: 'user', content: 'Hello' }],
};

const app = new Hono<AppEnv>()
  .basePath('/v1')
  .use('*', commonVariablesMiddleware)
  .post('/agents/:agent_name/skills/:skill_name/chat/completions', (c) =>
    c.json({
      config: c.get('sa_config_pre_processed'),
      function_name: c.get('sa_request_data').functionName,
      url: c.get('sa_request_data').url,
    }),
  )
  .post('/agents/:agent_name/chat/completions', (c) =>
    c.json({
      config: c.get('sa_config_pre_processed'),
      function_name: c.get('sa_request_data').functionName,
      url: c.get('sa_request_data').url,
    }),
  )
  .post('/chat/completions', (c) =>
    c.json({
      config: c.get('sa_config_pre_processed'),
      function_name: c.get('sa_request_data').functionName,
      url: c.get('sa_request_data').url,
    }),
  );

const post = (path: string, headers: Record<string, string> = {}) =>
  app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(CHAT_COMPLETION_BODY),
  });

const readBody = (response: Response) =>
  response.json() as Promise<EchoedRequest>;

describe('commonVariablesMiddleware', () => {
  describe('agent and skill in the path', () => {
    it('should not require the sa-config header', async () => {
      const response = await post(
        '/v1/agents/captain_code/skills/programming/chat/completions',
      );

      expect(response.status).toBe(200);
      const body = await readBody(response);
      expect(body.config.agent_name).toBe('captain_code');
      expect(body.config.skill_name).toBe('programming');
      expect(body.function_name).toBe(FunctionName.CHAT_COMPLETE);
    });

    it('should decode percent-encoded names', async () => {
      const response = await post(
        `/v1/agents/${encodeURIComponent('captain code')}/skills/${encodeURIComponent('programming basics')}/chat/completions`,
      );

      expect(response.status).toBe(200);
      const body = await readBody(response);
      expect(body.config.agent_name).toBe('captain code');
      expect(body.config.skill_name).toBe('programming basics');
    });

    it('should keep the rest of the sa-config header', async () => {
      const response = await post(
        '/v1/agents/captain_code/skills/programming/chat/completions',
        {
          'sa-config': JSON.stringify({
            agent_name: 'other_agent',
            skill_name: 'other_skill',
            app_id: 'my-app',
            system_prompt_variables: { datetime: '2026-01-01T00:00:00.000Z' },
          }),
        },
      );

      expect(response.status).toBe(200);
      const body = await readBody(response);
      // The path wins over the header.
      expect(body.config.agent_name).toBe('captain_code');
      expect(body.config.skill_name).toBe('programming');
      expect(body.config.app_id).toBe('my-app');
      expect(body.config.system_prompt_variables).toEqual({
        datetime: '2026-01-01T00:00:00.000Z',
      });
    });

    it('should trace a client that names its session in plain headers', async () => {
      // OpenCode sends no sa-config, only a session id and a product token.
      const response = await post('/v1/agents/captain_code/chat/completions', {
        'user-agent':
          'opencode/1.18.18 ai-sdk/provider-utils/4.0.23 runtime/bun/1.3.14',
        'x-session-id': 'ses_fa0504e30ffe',
      });

      expect(response.status).toBe(200);
      const body = await readBody(response);
      expect(body.config.trace_id).toBe('ses_fa0504e30ffe');
      expect(body.config.app_id).toBe('opencode/1.18.18');
    });

    it('should default to auto optimization when no target is given', async () => {
      const response = await post(
        '/v1/agents/captain_code/skills/programming/chat/completions',
      );

      const body = await readBody(response);
      expect(body.config.targets).toEqual([
        expect.objectContaining({ optimization: 'auto' }),
      ]);
    });

    it('should leave the skill to the gateway when the path names only the agent', async () => {
      const response = await post('/v1/agents/captain_code/chat/completions');

      expect(response.status).toBe(200);
      const body = await readBody(response);
      expect(body.config.agent_name).toBe('captain_code');
      expect(body.config.skill_name).toBeUndefined();
      expect(new URL(body.url).pathname).toBe('/v1/chat/completions');
    });

    it('should honour a skill named in the header on an agent-only path', async () => {
      const response = await post('/v1/agents/captain_code/chat/completions', {
        'sa-config': JSON.stringify({
          agent_name: 'other_agent',
          skill_name: 'programming',
        }),
      });

      expect(response.status).toBe(200);
      const body = await readBody(response);
      expect(body.config.agent_name).toBe('captain_code');
      expect(body.config.skill_name).toBe('programming');
    });

    it('should resolve the request data against the canonical route', async () => {
      const response = await post(
        '/v1/agents/captain_code/skills/programming/chat/completions',
      );

      const body = await readBody(response);
      expect(new URL(body.url).pathname).toBe('/v1/chat/completions');
    });
  });

  describe('unroutable paths', () => {
    it('should answer 404 instead of 500 for an unknown endpoint', async () => {
      const response = await post('/v1/nope', {
        'sa-config': JSON.stringify({
          agent_name: 'captain_code',
          skill_name: 'programming',
        }),
      });

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({
        error: 'No API route matches POST /v1/nope',
      });
    });

    it('should point at both scoped forms for an unknown agent endpoint', async () => {
      const response = await post('/v1/agents/captain_code/nope');

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({
        error: 'No API route matches POST /v1/agents/captain_code/nope',
        hint: 'Expected /v1/agents/{agent_name}/{endpoint} or /v1/agents/{agent_name}/skills/{skill_name}/{endpoint}',
      });
    });

    it('should answer 404 before asking for the sa-config header', async () => {
      // Without the route check this would report a missing config instead of a
      // mistyped URL.
      const response = await post('/v1/agents/captain_code/nope', {
        'sa-config': JSON.stringify({
          agent_name: 'captain_code',
          skill_name: 'programming',
        }),
      });

      expect(response.status).toBe(404);
    });

    it('should answer 404 for an unknown endpoint under a valid scope', async () => {
      const response = await post(
        '/v1/agents/captain_code/skills/programming/nope',
      );

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({
        error:
          'No API route matches POST /v1/agents/captain_code/skills/programming/nope',
      });
    });

    it('should answer 422 when the body does not fit the route schema', async () => {
      const response = await app.request(
        '/v1/agents/captain_code/skills/programming/chat/completions',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          // Missing the required `model` field.
          body: JSON.stringify({ messages: [{ role: 'user', content: 'Hi' }] }),
        },
      );

      expect(response.status).toBe(422);
      const body = (await response.json()) as { error: string };
      expect(body.error).toContain('Invalid request body');
    });

    // A decision model answers in one pass, so System One has no streaming
    // form; the path is right and only the body asks for what it lacks.
    it('should answer 400 when the body asks a route to stream that cannot', async () => {
      const response = await app.request('/v1/agents/captain_code/systemone', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          state: 'Hello',
          questions: { harmful: { type: 'noul', instructions: 'Harmful?' } },
          stream: true,
        }),
      });

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error:
          'POST /v1/agents/captain_code/systemone does not stream: send the request without "stream": true',
      });
    });
  });

  describe('agent and skill in the header', () => {
    it('should accept a header that names only the agent', async () => {
      const response = await post('/v1/chat/completions', {
        'sa-config': JSON.stringify({ agent_name: 'captain_code' }),
      });

      expect(response.status).toBe(200);
      const body = await readBody(response);
      expect(body.config.agent_name).toBe('captain_code');
      expect(body.config.skill_name).toBeUndefined();
    });

    it('should read the names from the sa-config header', async () => {
      const response = await post('/v1/chat/completions', {
        'sa-config': JSON.stringify({
          agent_name: 'captain_code',
          skill_name: 'programming',
        }),
      });

      expect(response.status).toBe(200);
      const body = await readBody(response);
      expect(body.config.agent_name).toBe('captain_code');
      expect(body.config.skill_name).toBe('programming');
    });

    it('should reject a request without the sa-config header', async () => {
      const response = await post('/v1/chat/completions');

      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({
        error: 'Missing Super Agents config',
      });
    });

    it('should reject a header that is missing the agent name', async () => {
      const response = await post('/v1/chat/completions', {
        'sa-config': JSON.stringify({ skill_name: 'programming' }),
      });

      expect(response.status).toBe(422);
    });
  });
});
