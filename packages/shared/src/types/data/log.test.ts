import { FunctionName } from '@shared/types/api/request';
import { AIProvider } from '@shared/types/constants';
import { CompletedLog, isCompletedLog, Log } from '@shared/types/data/log';
import { HttpMethod } from '@shared/types/http';
import { CacheMode, CacheStatus } from '@shared/types/middleware/cache';
import { describe, expect, it } from 'vitest';

/**
 * A log row is written when its request arrives, not when it finishes, so the
 * type has to describe a request that has not answered yet. `isCompletedLog`
 * is how everything that reads a provider exchange -- the judge, the
 * optimizer's examples, the detail view -- says it needs a finished one.
 */

const base = {
  id: '00000000-0000-4000-8000-000000000001',
  agent_id: '00000000-0000-4000-8000-00000000000a',
  skill_id: '00000000-0000-4000-8000-00000000000b',
  cluster_id: null,
  method: HttpMethod.POST,
  endpoint: '/v1/chat/completions',
  function_name: FunctionName.CHAT_COMPLETE,
  start_time: 1000,
  first_token_time: null,
  base_sa_config: {},
  request_body: { model: 'gpt-5.6', messages: [] },
  hook_logs: [],
  metadata: {},
  embedding: null,
  original_system_prompt: null,
  served_system_prompt: null,
  error: null,
  trace_id: null,
  parent_span_id: null,
  span_id: null,
  span_name: null,
  app_id: null,
  external_user_id: null,
  external_user_human_name: null,
  user_metadata: null,
};

/** What a row looks like between arriving and answering. */
const running = {
  ...base,
  status: null,
  end_time: null,
  duration: null,
  ai_provider: null,
  model: null,
  ai_provider_request_log: null,
  cache_status: null,
};

const finished = {
  ...base,
  status: 200,
  end_time: 2500,
  duration: 1500,
  ai_provider: AIProvider.OPENAI,
  model: 'gpt-5.6',
  ai_provider_request_log: {
    provider: AIProvider.OPENAI,
    function_name: FunctionName.CHAT_COMPLETE,
    method: HttpMethod.POST,
    request_url: 'https://api.openai.com/v1/chat/completions',
    status: 200,
    request_body: {},
    response_body: {},
    raw_request_body: '{}',
    raw_response_body: '{}',
    cache_mode: CacheMode.DISABLED,
    cache_status: CacheStatus.MISS,
  },
  cache_status: CacheStatus.MISS,
};

describe('Log', () => {
  it('accepts a request that has not answered yet', () => {
    expect(Log.safeParse(running).success).toBe(true);
  });

  it('accepts a finished request', () => {
    expect(Log.safeParse(finished).success).toBe(true);
  });

  it('accepts a request that failed before a provider answered', () => {
    const failed = {
      ...running,
      status: 404,
      end_time: 1200,
      duration: 200,
      error: 'Agent with name nope not found',
    };

    expect(Log.safeParse(failed).success).toBe(true);
  });

  it('keeps the request a row that has not answered was opened with', () => {
    // The row is the only account of a request until the provider answers,
    // so what the caller sent has to survive it.
    const log = Log.parse(running);

    expect(log.request_body).toEqual({ model: 'gpt-5.6', messages: [] });
  });

  it('accepts a row written before the request was recorded', () => {
    // Every row predating those columns reads them as null.
    const old = { ...running, request_body: null, served_system_prompt: null };

    expect(Log.safeParse(old).success).toBe(true);
  });

  it('still requires what a request has on arrival', () => {
    const { start_time: _, ...withoutStart } = running;
    expect(Log.safeParse(withoutStart).success).toBe(false);
  });
});

describe('isCompletedLog', () => {
  it('is false while the request is running', () => {
    expect(isCompletedLog(Log.parse(running))).toBe(false);
  });

  it('is true once it has answered', () => {
    expect(isCompletedLog(Log.parse(finished))).toBe(true);
  });

  it('is false for a failure that never reached a provider', () => {
    // It has a status and a duration, but no provider exchange -- which is
    // exactly what the callers guarded by this go on to read.
    const failed = Log.parse({
      ...running,
      status: 502,
      end_time: 1200,
      duration: 200,
      error: 'connect ECONNREFUSED',
    });

    expect(isCompletedLog(failed)).toBe(false);
  });

  it('narrows to a shape the completed schema accepts', () => {
    const log = Log.parse(finished);
    if (!isCompletedLog(log)) throw new Error('expected a completed log');

    expect(CompletedLog.safeParse(log).success).toBe(true);
    // Reachable without a null check, which is the point of the narrowing.
    expect(log.ai_provider_request_log.status).toBe(200);
    expect(log.duration).toBe(1500);
  });
});
