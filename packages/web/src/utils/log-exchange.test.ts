import { FunctionName } from '@shared/types/api/request';
import { AIProvider } from '@shared/types/constants';
import type { Log } from '@shared/types/data/log';
import { HttpMethod } from '@shared/types/http';
import { CacheMode, CacheStatus } from '@shared/types/middleware/cache';
import { exchangeOf } from '@web/utils/log-exchange';
import { describe, expect, it, vi } from 'vitest';

const ORIGIN = 'http://localhost:3000';

const clientBody = {
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'Translate this.' }],
};

/** A row as it stands between arriving and being answered. */
const running = (extra: Partial<Log> = {}): Log =>
  ({
    id: 'log-1',
    method: HttpMethod.POST,
    endpoint: '/v1/chat/completions',
    function_name: FunctionName.CHAT_COMPLETE,
    request_body: clientBody,
    ai_provider_request_log: null,
    ...extra,
  }) as Log;

/** The provider exchange a finished row carries. */
const answered = {
  provider: AIProvider.OPENAI,
  function_name: FunctionName.CHAT_COMPLETE,
  method: HttpMethod.POST,
  request_url: 'https://api.openai.com/v1/chat/completions',
  status: 200,
  request_body: {
    model: 'gpt-5.6',
    messages: [{ role: 'system', content: 'You translate text.' }],
  },
  response_body: { choices: [{ message: { content: 'Traduis ceci.' } }] },
  raw_request_body: '{}',
  raw_response_body: '{}',
  cache_mode: CacheMode.DISABLED,
  cache_status: CacheStatus.MISS,
} as Log['ai_provider_request_log'];

describe('exchangeOf', () => {
  it('shows the request the client made while it is still running', () => {
    const data = exchangeOf(running(), ORIGIN);

    expect(data?.functionName).toBe(FunctionName.CHAT_COMPLETE);
    expect(data?.requestBody).toMatchObject(clientBody);
    expect(data?.responseBody).toBeUndefined();
  });

  it('shows it for a request that failed before a provider answered', () => {
    const data = exchangeOf(
      running({ status: 502, error: 'connect ECONNREFUSED' }),
      ORIGIN,
    );

    expect(data?.requestBody).toMatchObject(clientBody);
  });

  it('prefers what reached the provider once it has answered', () => {
    // The prompt an optimized skill substituted is in the sent body, not in
    // the client's, so a finished log reads from the provider exchange.
    const data = exchangeOf(
      running({ ai_provider_request_log: answered }),
      ORIGIN,
    );

    expect(data?.requestBody).toMatchObject(answered?.request_body ?? {});
    expect(data?.responseBody).toMatchObject(answered?.response_body ?? {});
  });

  it('is null for a row written before the request was recorded', () => {
    expect(exchangeOf(running({ request_body: null }), ORIGIN)).toBeNull();
  });

  it('is null, not a throw, for a route this build cannot parse', () => {
    const noise = vi.spyOn(console, 'error').mockImplementation(() => {
      // The parse failure is reported, and not worth printing here.
    });

    expect(exchangeOf(running({ endpoint: '/v1/nowhere' }), ORIGIN)).toBeNull();

    noise.mockRestore();
  });
});
