import { executeHooks } from '@api/middlewares/hooks';
import type { HooksConnector } from '@api/types/connector';
import type { AppContext } from '@api/types/hono';
import type { SuperAgentsRequestData } from '@shared/types/api/request/body';
import { FunctionName } from '@shared/types/api/request/function-name';
import type { SuperAgentsResponseBody } from '@shared/types/api/response/body';
import { CacheMode, CacheStatus } from '@shared/types/middleware/cache';
import {
  type Hook,
  HookProvider,
  HookType,
} from '@shared/types/middleware/hooks';
import { describe, expect, it, vi } from 'vitest';

/**
 * The middleware between a hook's configuration and its provider. What
 * matters: the provider is handed what it is to judge, and a hook that
 * cannot run -- no such provider, or one that throws -- is recorded as
 * failed rather than treated as a verdict either way.
 */

const context = (hooks: Hook[], connectors: HooksConnector[]): AppContext => {
  const vars = new Map<string, unknown>([
    ['sa_config', { trace_id: 'trace-1', hooks }],
    [
      'hooks_connectors_map',
      Object.fromEntries(connectors.map((x) => [x.name, x])),
    ],
    [
      'getHookResponseFromCache',
      vi.fn().mockResolvedValue({ status: CacheStatus.MISS }),
    ],
  ]);
  return {
    get: (key: string) => vars.get(key),
    set: (key: string, value: unknown) => vars.set(key, value),
  } as unknown as AppContext;
};

const hook = (overrides: Partial<Hook> = {}): Hook => ({
  id: 'reviewer:guard',
  type: HookType.OUTPUT_HOOK,
  hook_provider: HookProvider.AGENT,
  config: { agent_name: 'guard' },
  await: true,
  cache_mode: CacheMode.DISABLED,
  fail_closed: false,
  expose_reason: false,
  ...overrides,
});

const requestData = {
  functionName: FunctionName.CHAT_COMPLETE,
  requestBody: { model: 'm', messages: [] },
} as unknown as SuperAgentsRequestData;
const responseBody = {
  id: 'r',
  choices: [],
} as unknown as SuperAgentsResponseBody;

const verdict = (deny: boolean) => ({
  deny_request: deny,
  request_body_override: undefined,
  response_body_override: undefined,
  skipped: false,
  reason: deny ? 'No.' : 'Fine.',
});

describe('executeHooks', () => {
  it('hands the provider the hook, the request, the response and the status', async () => {
    const connector: HooksConnector = {
      name: HookProvider.AGENT,
      executeHook: vi.fn().mockResolvedValue(verdict(true)),
    };
    const c = context([hook()], [connector]);

    const logs = await executeHooks(
      c,
      HookType.OUTPUT_HOOK,
      200,
      false,
      requestData,
      responseBody,
    );

    expect(connector.executeHook).toHaveBeenCalledWith(c, hook(), {
      requestData,
      responseBody,
      statusCode: 200,
    });
    expect(logs).toHaveLength(1);
    expect(logs[0].result.deny_request).toBe(true);
    expect(logs[0].result.reason).toBe('No.');
    expect(logs[0].trace_id).toBe('trace-1');
    // The log is also left on the context for the request log to pick up.
    expect(c.get('hook_logs')).toEqual(logs);
  });

  it('records a hook whose provider this server lacks as failed, not as a verdict', async () => {
    const c = context([hook({ hook_provider: HookProvider.HTTP })], []);

    const [log] = await executeHooks(
      c,
      HookType.OUTPUT_HOOK,
      200,
      false,
      requestData,
      responseBody,
    );

    expect(log.result.deny_request).toBe(false);
    expect(log.result.skipped).toBe(false);
    expect(log.result.error).toContain('No hook provider named "http"');
  });

  it('records a provider that throws as failed', async () => {
    const connector: HooksConnector = {
      name: HookProvider.AGENT,
      executeHook: vi.fn().mockRejectedValue(new Error('connection refused')),
    };
    const c = context([hook()], [connector]);

    const [log] = await executeHooks(
      c,
      HookType.OUTPUT_HOOK,
      200,
      false,
      requestData,
      responseBody,
    );

    expect(log.result.deny_request).toBe(false);
    expect(log.result.error).toBe('connection refused');
  });

  it('skips an output hook when the provider did not answer 200', async () => {
    const connector: HooksConnector = {
      name: HookProvider.AGENT,
      executeHook: vi.fn(),
    };
    const c = context([hook()], [connector]);

    const [log] = await executeHooks(
      c,
      HookType.OUTPUT_HOOK,
      500,
      false,
      requestData,
      responseBody,
    );

    expect(log.result.skipped).toBe(true);
    expect(connector.executeHook).not.toHaveBeenCalled();
  });

  it('runs only the hooks of the kind asked for', async () => {
    const connector: HooksConnector = {
      name: HookProvider.AGENT,
      executeHook: vi.fn().mockResolvedValue(verdict(false)),
    };
    const c = context(
      [hook(), hook({ id: 'in', type: HookType.INPUT_HOOK })],
      [connector],
    );

    const logs = await executeHooks(
      c,
      HookType.INPUT_HOOK,
      null,
      false,
      requestData,
    );

    expect(logs.map((log) => log.hook.id)).toEqual(['in']);
  });
});

describe('executeHooks failing closed', () => {
  const run = (hooks: Hook[], connectors: HooksConnector[]) =>
    executeHooks(
      context(hooks, connectors),
      HookType.OUTPUT_HOOK,
      200,
      false,
      requestData,
      responseBody,
    );

  it('denies when the provider is missing', async () => {
    const [log] = await run(
      [hook({ hook_provider: HookProvider.HTTP, fail_closed: true })],
      [],
    );
    expect(log.result.deny_request).toBe(true);
    expect(log.result.error).toContain('No hook provider named "http"');
  });

  it('denies when the provider throws', async () => {
    const [log] = await run(
      [hook({ fail_closed: true })],
      [
        {
          name: HookProvider.AGENT,
          executeHook: vi.fn().mockRejectedValue(new Error('timed out')),
        },
      ],
    );
    expect(log.result.deny_request).toBe(true);
    expect(log.result.error).toBe('timed out');
  });

  it('denies when the provider reports it could not judge', async () => {
    const [log] = await run(
      [hook({ fail_closed: true })],
      [
        {
          name: HookProvider.AGENT,
          executeHook: vi
            .fn()
            .mockResolvedValue({ ...verdict(false), error: 'no verdict' }),
        },
      ],
    );
    expect(log.result.deny_request).toBe(true);
    expect(log.result.error).toBe('no verdict');
  });

  it('leaves a verdict alone', async () => {
    const [log] = await run(
      [hook({ fail_closed: true })],
      [
        {
          name: HookProvider.AGENT,
          executeHook: vi.fn().mockResolvedValue(verdict(false)),
        },
      ],
    );
    expect(log.result.deny_request).toBe(false);
    expect(log.result.error).toBeUndefined();
  });
});

/**
 * A hook asked to judge a request it cannot read fails rather than skips:
 * skipping is what let a client get past its agent's reviewer by asking
 * through another API, `review_fail_closed` or not.
 */
describe('executeHooks on a request it cannot judge', () => {
  const connector = (): HooksConnector => ({
    name: HookProvider.AGENT,
    executeHook: vi.fn().mockResolvedValue(verdict(false)),
  });
  const asked = (functionName: FunctionName) =>
    ({
      functionName,
      requestBody: { model: 'm', input: 'hi' },
    }) as unknown as SuperAgentsRequestData;

  it.each([[FunctionName.CREATE_MODEL_RESPONSE], [FunctionName.SYSTEM_ONE]])(
    'records a %s request as unjudged, and lets it through when it fails open',
    async (functionName) => {
      const provider = connector();
      const c = context([hook()], [provider]);

      const [log] = await executeHooks(
        c,
        HookType.OUTPUT_HOOK,
        200,
        false,
        asked(functionName),
        responseBody,
      );

      expect(provider.executeHook).not.toHaveBeenCalled();
      expect(log.result).toMatchObject({ skipped: false, deny_request: false });
      expect(log.result.error).toMatch(/cannot read/);
    },
  );

  it('withholds it when the hook fails closed', async () => {
    const c = context([hook({ fail_closed: true })], [connector()]);

    const [log] = await executeHooks(
      c,
      HookType.OUTPUT_HOOK,
      200,
      false,
      asked(FunctionName.CREATE_MODEL_RESPONSE),
      responseBody,
    );

    expect(log.result.deny_request).toBe(true);
  });

  it('records a stream that went past a blocking hook as unjudged', async () => {
    const c = context([hook({ fail_closed: true })], [connector()]);

    const [log] = await executeHooks(
      c,
      HookType.OUTPUT_HOOK,
      200,
      true,
      asked(FunctionName.CREATE_MODEL_RESPONSE),
    );

    expect(log.result.deny_request).toBe(true);
    expect(log.result.error).toBeDefined();
  });

  // A stream's request is a chat body like any other: an input hook reads
  // it before anything streams, and a hook not waiting on the response has
  // nothing to hold.
  it('reads the request of a stream, and skips a hook not waiting on it', async () => {
    const provider = connector();
    const streamed = {
      functionName: FunctionName.STREAM_CHAT_COMPLETE,
      requestBody: { model: 'm', messages: [], stream: true },
    } as unknown as SuperAgentsRequestData;

    const [input] = await executeHooks(
      context(
        [hook({ type: HookType.INPUT_HOOK, fail_closed: true })],
        [provider],
      ),
      HookType.INPUT_HOOK,
      null,
      true,
      streamed,
    );
    const [unawaited] = await executeHooks(
      context([hook({ await: false, fail_closed: true })], [provider]),
      HookType.OUTPUT_HOOK,
      200,
      true,
      streamed,
    );

    expect(provider.executeHook).toHaveBeenCalledTimes(1);
    expect(input.result).toMatchObject({ deny_request: false });
    expect(input.result.error).toBeUndefined();
    expect(unawaited.result).toMatchObject({
      skipped: true,
      deny_request: false,
    });
  });

  it('still skips what there is nothing to judge in', async () => {
    const provider = connector();
    const c = context(
      [hook(), hook({ id: 'later', await: false })],
      [provider],
    );

    // A response that never reached the client, and a hook that never held
    // the stream it was not asked to wait for.
    const [failed] = await executeHooks(
      c,
      HookType.OUTPUT_HOOK,
      503,
      false,
      asked(FunctionName.CREATE_MODEL_RESPONSE),
      responseBody,
    );
    const [, unawaited] = await executeHooks(
      c,
      HookType.OUTPUT_HOOK,
      200,
      true,
      requestData,
    );
    const [embedded] = await executeHooks(
      context([hook()], [provider]),
      HookType.OUTPUT_HOOK,
      200,
      false,
      asked(FunctionName.EMBED),
      responseBody,
    );

    expect(failed.result.skipped).toBe(true);
    expect(unawaited.result.skipped).toBe(true);
    expect(embedded.result.skipped).toBe(true);
    expect(provider.executeHook).not.toHaveBeenCalled();
  });
});

describe('executeHooks logging', () => {
  it('keeps a log of every hook it ran on the context, under the request trace', async () => {
    const connector: HooksConnector = {
      name: HookProvider.AGENT,
      executeHook: vi.fn().mockResolvedValue(verdict(false)),
    };
    const c = context(
      [hook({ id: 'first' }), hook({ id: 'second' })],
      [connector],
    );

    const logs = await executeHooks(
      c,
      HookType.OUTPUT_HOOK,
      200,
      false,
      requestData,
      responseBody,
    );

    expect(logs.map((log) => log.hook.id)).toEqual(['first', 'second']);
    expect(c.get('hook_logs')).toHaveLength(2);
    for (const log of logs) {
      expect(log.trace_id).toBe('trace-1');
      expect(log.cache_status).toBe(CacheStatus.MISS);
      expect(log.duration).toBe(log.end_time - log.start_time);
      expect(log.result.reason).toBe('Fine.');
      // An allowed response is on the provider log; it is not written twice.
      expect(log.response_body).toBeUndefined();
    }
  });

  it('keeps the response a hook withheld on its log, since the client never sees it', async () => {
    const connector: HooksConnector = {
      name: HookProvider.AGENT,
      executeHook: vi.fn().mockResolvedValue(verdict(true)),
    };
    const c = context([hook()], [connector]);

    const [log] = await executeHooks(
      c,
      HookType.OUTPUT_HOOK,
      200,
      false,
      requestData,
      responseBody,
    );

    expect(log.response_body).toEqual(responseBody);
  });

  it('keeps the response a hook replaced, beside what it put in its place', async () => {
    const replacement = { id: 'r', choices: [{ text: 'redacted' }] };
    const connector: HooksConnector = {
      name: HookProvider.AGENT,
      executeHook: vi.fn().mockResolvedValue({
        ...verdict(false),
        response_body_override: replacement,
      }),
    };
    const c = context([hook()], [connector]);

    const [log] = await executeHooks(
      c,
      HookType.OUTPUT_HOOK,
      200,
      false,
      requestData,
      responseBody,
    );

    expect(log.response_body).toEqual(responseBody);
    expect(log.result.response_body_override).toEqual(replacement);
  });

  it('keeps a withheld response when the hook failed closed, too', async () => {
    const connector: HooksConnector = {
      name: HookProvider.AGENT,
      executeHook: vi.fn().mockRejectedValue(new Error('Reviewer unreachable')),
    };
    const c = context([hook({ fail_closed: true })], [connector]);

    const [log] = await executeHooks(
      c,
      HookType.OUTPUT_HOOK,
      200,
      false,
      requestData,
      responseBody,
    );

    expect(log.result.deny_request).toBe(true);
    expect(log.result.error).toBe('Reviewer unreachable');
    expect(log.response_body).toEqual(responseBody);
  });

  it('keeps nothing on an input hook log: the request is on the provider log', async () => {
    const connector: HooksConnector = {
      name: HookProvider.AGENT,
      executeHook: vi.fn().mockResolvedValue(verdict(true)),
    };
    const c = context([hook({ type: HookType.INPUT_HOOK })], [connector]);

    const [log] = await executeHooks(
      c,
      HookType.INPUT_HOOK,
      null,
      false,
      requestData,
    );

    expect(log.result.deny_request).toBe(true);
    expect(log.response_body).toBeUndefined();
  });
});
