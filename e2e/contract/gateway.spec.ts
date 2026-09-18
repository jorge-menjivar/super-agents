import type { APIRequestContext } from '@playwright/test';
import { createAgent, deleteAgent, uniqueAgentName } from '../fixtures/agents';
import {
  CHAT_COMPLETIONS_PATH,
  chatBody,
  parseSSE,
  saConfig,
  stubFail,
  stubFence,
  stubRequests,
  stubReset,
  uniqueModelName,
} from '../fixtures/gateway';
import { createSkill } from '../fixtures/skills';
import { expect, test } from '../fixtures/test';

/**
 * The gateway request path, against a stub provider.
 *
 * This is the product's hot path and the least covered part of it -- request
 * transformation, streaming, retries and caching are all but untouched by the
 * unit suites, because none of them can run without something to proxy to.
 * `scripts/start-stub-provider.mjs` is that something: it imitates an
 * OpenAI-compatible provider, and records what the gateway actually sent, which
 * is the only way to assert on a request the client never sees.
 *
 * These live in `contract/` rather than `api/` because the path writes through
 * storage -- logs on every request, and the cache on a cacheable one -- so both
 * connectors have to agree on it.
 */
test.describe('gateway', () => {
  /** An agent and skill exist purely because the gateway resolves them first. */
  const withSkill = async (request: APIRequestContext, prefix: string) => {
    const agent = await createAgent(request, uniqueAgentName(prefix));
    await createSkill(request, agent.id, 'gateway_skill');
    return agent;
  };

  test('proxies a chat completion and returns the provider response', async ({
    request,
  }) => {
    const agent = await withSkill(request, 'gw');
    const model = uniqueModelName('complete');

    try {
      const response = await request.post(CHAT_COMPLETIONS_PATH, {
        headers: {
          'sa-config': saConfig(agent.name, 'gateway_skill', { model }),
        },
        data: chatBody('hello gateway'),
      });

      expect(response.status()).toBe(200);
      const body = (await response.json()) as {
        model: string;
        choices: { message: { content: string } }[];
      };

      // The stub echoes the user message, so this asserts *this* request
      // produced *this* response rather than matching a constant any request
      // would have satisfied.
      expect(body.choices[0].message.content).toBe('echo: hello gateway');
      // The gateway replaces the client's model with the target's.
      expect(body.model).toBe(model);
    } finally {
      await stubReset(request, model);
      await deleteAgent(request, agent.id);
    }
  });

  test('forwards the resolved model rather than the one the client sent', async ({
    request,
  }) => {
    const agent = await withSkill(request, 'gwfwd');
    const model = uniqueModelName('forward');

    try {
      await request.post(CHAT_COMPLETIONS_PATH, {
        headers: {
          'sa-config': saConfig(agent.name, 'gateway_skill', { model }),
        },
        data: chatBody('what was forwarded?'),
      });

      // Asserted at the provider, because the request the gateway builds is
      // never visible in the response the client gets back.
      const [forwarded] = await stubRequests(request, model);
      expect(forwarded.model).toBe(model);
      expect(forwarded.messages).toEqual([
        { role: 'user', content: 'what was forwarded?' },
      ]);
    } finally {
      await stubReset(request, model);
      await deleteAgent(request, agent.id);
    }
  });

  test('unwraps structured output the provider wrapped in a markdown fence', async ({
    request,
  }) => {
    /**
     * Providers that do not enforce `response_format` see it as prompt text and
     * routinely answer with the JSON inside a ```json fence. A client that
     * asked for `json_schema` runs `JSON.parse` on the content -- the OpenAI
     * SDK's `.parse()` does exactly that -- so the gateway has to hand back
     * content that parses. The internal skills are such a client: evaluation
     * generation, judging and prompt seeding all break at once without this.
     */
    const agent = await withSkill(request, 'gwjson');
    const model = uniqueModelName('fenced');

    try {
      await stubFence(request, model);

      const response = await request.post(CHAT_COMPLETIONS_PATH, {
        headers: {
          'sa-config': saConfig(agent.name, 'gateway_skill', { model }),
        },
        data: {
          ...chatBody('give me the parameters'),
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'params',
              strict: true,
              schema: {
                type: 'object',
                properties: { task: { type: 'string' } },
                required: ['task'],
                additionalProperties: false,
              },
            },
          },
        },
      });

      expect(response.status()).toBe(200);
      const body = (await response.json()) as {
        choices: { message: { content: string } }[];
      };

      const { content } = body.choices[0].message;
      expect(content.startsWith('```')).toBe(false);
      expect(JSON.parse(content)).toEqual({ task: 'stub: task' });
    } finally {
      await stubReset(request, model);
      await deleteAgent(request, agent.id);
    }
  });

  test('streams a completion back as server-sent events', async ({
    request,
  }) => {
    const agent = await withSkill(request, 'gwstream');
    const model = uniqueModelName('stream');

    try {
      const response = await request.post(CHAT_COMPLETIONS_PATH, {
        headers: {
          'sa-config': saConfig(agent.name, 'gateway_skill', { model }),
        },
        data: chatBody('one two three', true),
      });

      expect(response.status()).toBe(200);
      expect(response.headers()['content-type']).toContain('text/event-stream');

      const chunks = parseSSE(await response.text());

      // Several chunks, not one that happens to hold the whole answer: the
      // point is that the stream was relayed incrementally.
      expect(chunks.length).toBeGreaterThan(2);

      const assembled = chunks
        .map(
          (chunk) =>
            (
              chunk as {
                choices?: { delta?: { content?: string } }[];
              }
            ).choices?.[0]?.delta?.content ?? '',
        )
        .join('');
      expect(assembled.trim()).toBe('echo: one two three');

      const last = chunks[chunks.length - 1] as {
        choices: { finish_reason: string | null }[];
      };
      expect(last.choices[0].finish_reason).toBe('stop');
    } finally {
      await stubReset(request, model);
      await deleteAgent(request, agent.id);
    }
  });

  test('serves a repeated request from the cache without calling the provider', async ({
    request,
  }) => {
    /**
     * The end-to-end half of the fix in #237. The Supabase connector used to
     * write `expires_at = now`, so every entry expired on write and this second
     * request would have reached the provider again. Counting calls at the
     * provider is the assertion, because no response header distinguishes a hit
     * from a miss -- and it is the behaviour that actually matters.
     */
    const agent = await withSkill(request, 'gwcache');
    const model = uniqueModelName('cache');
    const headers = {
      'sa-config': saConfig(agent.name, 'gateway_skill', {
        model,
        cache: { mode: 'simple' as const },
      }),
    };

    try {
      const first = await request.post(CHAT_COMPLETIONS_PATH, {
        headers,
        data: chatBody('cache this'),
      });
      expect(first.status()).toBe(200);

      const second = await request.post(CHAT_COMPLETIONS_PATH, {
        headers,
        data: chatBody('cache this'),
      });
      expect(second.status()).toBe(200);

      expect(await second.json()).toEqual(await first.json());
      expect(await stubRequests(request, model)).toHaveLength(1);
    } finally {
      await stubReset(request, model);
      await deleteAgent(request, agent.id);
    }
  });

  test('does not cache when caching is left disabled', async ({ request }) => {
    // The default. Worth pinning: a cache that engages when it was not asked
    // for would serve stale answers, and the previous bug meant nobody would
    // have noticed the difference.
    const agent = await withSkill(request, 'gwnocache');
    const model = uniqueModelName('nocache');
    const headers = {
      'sa-config': saConfig(agent.name, 'gateway_skill', { model }),
    };

    try {
      await request.post(CHAT_COMPLETIONS_PATH, {
        headers,
        data: chatBody('do not cache this'),
      });
      await request.post(CHAT_COMPLETIONS_PATH, {
        headers,
        data: chatBody('do not cache this'),
      });

      expect(await stubRequests(request, model)).toHaveLength(2);
    } finally {
      await stubReset(request, model);
      await deleteAgent(request, agent.id);
    }
  });

  test('retries a retryable provider failure and then succeeds', async ({
    request,
  }) => {
    const agent = await withSkill(request, 'gwretry');
    const model = uniqueModelName('retry');

    try {
      // 503 is in RETRY_STATUS_CODES; two failures then a success.
      await stubFail(request, model, 2, 503);

      const response = await request.post(CHAT_COMPLETIONS_PATH, {
        headers: {
          'sa-config': saConfig(agent.name, 'gateway_skill', {
            model,
            retry: { attempts: 3 },
          }),
        },
        data: chatBody('retry me'),
      });

      expect(response.status()).toBe(200);
      const body = (await response.json()) as {
        choices: { message: { content: string } }[];
      };
      expect(body.choices[0].message.content).toBe('echo: retry me');

      // Two failures plus the successful attempt.
      expect(await stubRequests(request, model)).toHaveLength(3);
    } finally {
      await stubReset(request, model);
      await deleteAgent(request, agent.id);
    }
  });

  test('gives up and surfaces the provider failure once attempts run out', async ({
    request,
  }) => {
    const agent = await withSkill(request, 'gwgiveup');
    const model = uniqueModelName('giveup');

    try {
      await stubFail(request, model, 5, 503);

      const response = await request.post(CHAT_COMPLETIONS_PATH, {
        headers: {
          'sa-config': saConfig(agent.name, 'gateway_skill', {
            model,
            retry: { attempts: 2 },
          }),
        },
        data: chatBody('always fails'),
      });

      // The provider's failure has to reach the client rather than being
      // retried forever or reported as a gateway error.
      expect(response.status()).toBe(503);
      expect(await stubRequests(request, model)).toHaveLength(3);
    } finally {
      await stubReset(request, model);
      await deleteAgent(request, agent.id);
    }
  });

  test('surfaces the provider failure on a streaming request', async ({
    request,
  }) => {
    // A failed streaming request used to crash the gateway instead of
    // answering: the stream chunk transform was handed the provider's JSON
    // error body and threw ("responseChunk.trim is not a function"), a 500
    // that buried the provider's message.
    const agent = await withSkill(request, 'gwstreamfail');
    const model = uniqueModelName('streamfail');

    try {
      await stubFail(request, model, 1, 404);

      const response = await request.post(CHAT_COMPLETIONS_PATH, {
        headers: {
          'sa-config': saConfig(agent.name, 'gateway_skill', { model }),
        },
        data: chatBody('stream me', true),
      });

      expect(response.status()).toBe(404);
      expect(await response.text()).toContain('stub: injected failure (404)');
    } finally {
      await stubReset(request, model);
      await deleteAgent(request, agent.id);
    }
  });

  test('rejects a request naming an agent that does not exist', async ({
    request,
  }) => {
    const model = uniqueModelName('noagent');

    const response = await request.post(CHAT_COMPLETIONS_PATH, {
      headers: {
        'sa-config': saConfig('agent_that_does_not_exist', 'nope', { model }),
      },
      data: chatBody('hello'),
    });

    expect(response.status()).toBe(404);
    // Nothing should have been proxied for a request that never resolved.
    expect(await stubRequests(request, model)).toHaveLength(0);
  });
});
