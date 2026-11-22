import { cacheMiddleware } from '@api/middlewares/cache';
import type { CacheStorageConnector } from '@api/types/connector';
import type { AppEnv } from '@api/types/hono';
import { HttpMethod } from '@api/types/http';
import { FunctionName } from '@shared/types/api/request';
import { AIProvider } from '@shared/types/constants';
import type { AIProviderRequestLog, HookLog } from '@shared/types/data';
import { CacheMode, CacheStatus } from '@shared/types/middleware/cache';
import {
  HOOK_DENIED_STATUS,
  type Hook,
  HookProvider,
  type HookResult,
  HookType,
} from '@shared/types/middleware/hooks';
import { Hono } from 'hono';
import { createFactory } from 'hono/factory';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * What the cache keeps of a response once the handler has served it. A cache
 * hit runs no output hooks, so whatever is written here is replayed to every
 * identical request without a review -- which is only sound for an answer a
 * review actually judged.
 */
describe('cacheMiddleware', () => {
  const connector = {
    getCache: vi.fn(),
    setCache: vi.fn(),
  } as unknown as CacheStorageConnector;

  /** What the handler under the middleware leaves on the context. */
  let served: { status: number; hookLogs: HookLog[] };

  const app = new Hono<AppEnv>()
    .use(
      '*',
      cacheMiddleware(createFactory<AppEnv>(), () => connector),
    )
    .post('/', (c) => {
      const aiProviderLog: AIProviderRequestLog = {
        provider: AIProvider.OPENAI,
        function_name: FunctionName.CHAT_COMPLETE,
        method: HttpMethod.POST,
        request_url: 'http://localhost/v1/chat/completions',
        status: served.status,
        request_body: { model: 'm', messages: [] },
        response_body: { id: 'r', choices: [] },
        raw_request_body: '{}',
        raw_response_body: '{}',
        cache_status: CacheStatus.MISS,
        cache_mode: CacheMode.SIMPLE,
      };
      c.set('ai_provider_log', aiProviderLog);
      c.set('hook_logs', served.hookLogs);
      return new Response('{}', { status: served.status });
    });

  const hookLog = (
    result: Partial<HookResult>,
    hook: Partial<Hook> = {},
  ): HookLog => ({
    trace_id: 'trace-1',
    hook: {
      id: 'reviewer:guard',
      type: HookType.OUTPUT_HOOK,
      hook_provider: HookProvider.AGENT,
      config: { agent_name: 'guard' },
      await: true,
      cache_mode: CacheMode.DISABLED,
      fail_closed: false,
      expose_reason: false,
      ...hook,
    },
    result: {
      deny_request: false,
      skipped: false,
      ...result,
    },
    start_time: 0,
    end_time: 1,
    duration: 1,
    cache_status: CacheStatus.MISS,
  });

  const unjudged = { error: 'The reviewer did not answer with a verdict' };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('caches a response its reviewer allowed', async () => {
    served = { status: 200, hookLogs: [hookLog({ reason: 'Fine.' })] };

    await app.request('/', { method: 'POST' });

    expect(connector.setCache).toHaveBeenCalledOnce();
  });

  it('caches the replacement a reviewer wrote, as the client received it', async () => {
    served = {
      status: 200,
      hookLogs: [
        hookLog({
          reason: 'Redacted.',
          response_body_override: { id: 'r', choices: [] } as never,
        }),
      ],
    };

    await app.request('/', { method: 'POST' });

    expect(connector.setCache).toHaveBeenCalledOnce();
  });

  it('does not cache a response that got past a review failing open', async () => {
    served = { status: 200, hookLogs: [hookLog(unjudged)] };

    await app.request('/', { method: 'POST' });

    expect(connector.setCache).not.toHaveBeenCalled();
  });

  it('does not cache it when another hook did judge the response', async () => {
    served = {
      status: 200,
      hookLogs: [
        hookLog({ reason: 'Fine.' }, { id: 'reviewer:other' }),
        hookLog(unjudged),
      ],
    };

    await app.request('/', { method: 'POST' });

    expect(connector.setCache).not.toHaveBeenCalled();
  });

  it('does not cache a response a hook withheld', async () => {
    served = {
      status: HOOK_DENIED_STATUS,
      hookLogs: [hookLog({ ...unjudged, deny_request: true })],
    };

    await app.request('/', { method: 'POST' });

    expect(connector.setCache).not.toHaveBeenCalled();
  });

  it('caches past an input hook that could not judge, which runs again on a hit', async () => {
    served = {
      status: 200,
      hookLogs: [hookLog(unjudged, { type: HookType.INPUT_HOOK })],
    };

    await app.request('/', { method: 'POST' });

    expect(connector.setCache).toHaveBeenCalledOnce();
  });
});
