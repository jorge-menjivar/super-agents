import { retryRequest } from '@api/handlers/retry-handler';
import { describe, expect, it } from 'vitest';

/**
 * A provider's error has to reach the caller as what the provider sent. The
 * handler rebuilds the failed response once `async-retry` gives up, and a
 * `Response` built from a string is `text/plain` unless told otherwise --
 * which sent OpenAI's JSON error down the gateway's text path, wrapped as
 * `{"html-message": ...}`, and left the OpenAI client reporting
 * "400 status code (no body)".
 */

const url = 'https://api.openai.com/v1/chat/completions';

const openAIRejects = (status: number) => async () =>
  new Response(
    JSON.stringify({
      error: {
        message:
          "Unsupported value: 'temperature' does not support 0 with this model. Only the default (1) value is supported.",
        type: 'invalid_request_error',
        param: 'temperature',
        code: 'unsupported_value',
      },
    }),
    { status, headers: { 'content-type': 'application/json' } },
  );

describe('retryRequest with a provider error', () => {
  it('keeps the content type of an error it does not retry', async () => {
    const { response } = await retryRequest(
      url,
      {},
      0,
      [429, 500],
      null,
      openAIRejects(400),
    );

    expect(response.status).toBe(400);
    expect(response.headers.get('content-type')).toBe('application/json');
    const body = (await response.json()) as { error: { param: string } };
    expect(body.error.param).toBe('temperature');
  });

  it('keeps it once a retried error runs out of attempts', async () => {
    const { response } = await retryRequest(
      url,
      {},
      0,
      [500],
      null,
      openAIRejects(500),
    );

    expect(response.status).toBe(500);
    expect(response.headers.get('content-type')).toBe('application/json');
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('unsupported_value');
  });
});

describe('retryRequest timing', () => {
  it('reports when the attempt that answered was sent, not when the first was', async () => {
    let attempts = 0;
    const flakyProvider = () => {
      attempts += 1;
      return Promise.resolve(
        attempts === 1
          ? new Response('{"error":"busy"}', { status: 500 })
          : new Response('{}', { status: 200 }),
      );
    };

    const { response, createdAt, sentAt } = await retryRequest(
      url,
      {},
      1,
      [500],
      null,
      flakyProvider,
    );

    expect(response.status).toBe(200);
    expect(attempts).toBe(2);
    // The retry waits a second before asking again. The failed attempt and
    // that wait are the provider's unavailability, not its speed, so a
    // measure of how fast it answered must not start at `createdAt`.
    expect(sentAt - createdAt.getTime()).toBeGreaterThanOrEqual(900);
  });
});
