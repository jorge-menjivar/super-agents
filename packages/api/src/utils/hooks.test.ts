import type { AppContext } from '@api/types/hono';
import {
  hookDenialBody,
  inputHookHandler,
  outputHookHandler,
} from '@api/utils/hooks';
import type {
  SuperAgentsRequestBody,
  SuperAgentsRequestData,
} from '@shared/types/api/request/body';
import { FunctionName } from '@shared/types/api/request/function-name';
import type { SuperAgentsResponseBody } from '@shared/types/api/response/body';
import type { HookLog } from '@shared/types/data';
import { CacheMode, CacheStatus } from '@shared/types/middleware/cache';
import {
  type Hook,
  type HookDenialResponseBody,
  HookProvider,
  type HookResult,
  HookType,
} from '@shared/types/middleware/hooks';
import { describe, expect, it, vi } from 'vitest';

const requestData = {
  functionName: FunctionName.CHAT_COMPLETE,
  requestBody: { model: 'm', messages: [] },
} as unknown as SuperAgentsRequestData;

const body = (content: string) =>
  ({
    id: 'chatcmpl-1',
    object: 'chat.completion',
    created: 1,
    model: 'm',
    choices: [
      {
        index: 0,
        finish_reason: 'stop',
        message: { role: 'assistant', content },
      },
    ],
  }) as unknown as SuperAgentsResponseBody;

const log = (
  result: Partial<HookResult>,
  hook: Partial<Hook> = {},
): HookLog => ({
  trace_id: 't',
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
    request_body_override: undefined,
    response_body_override: undefined,
    skipped: false,
    ...result,
  },
  start_time: 1,
  end_time: 2,
  duration: 1,
  cache_status: CacheStatus.DISABLED,
});

const context = (logs: HookLog[]): AppContext => {
  const vars = new Map<string, unknown>([
    ['executeHooks', vi.fn().mockResolvedValue(logs)],
    ['hook_logs', logs],
  ]);
  return {
    get: (key: string) => vars.get(key),
    set: (key: string, value: unknown) => vars.set(key, value),
  } as unknown as AppContext;
};

const ok = () =>
  new Response('{}', {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

/** What the client receives once hooks have run: the response, plus the verdicts. */
interface HookedBody {
  choices?: { message: { content: string } }[];
  hook_results?: { output_hooks: HookLog[] };
  error?: HookDenialResponseBody['error'];
}

describe('outputHookHandler', () => {
  it('sends the client what a hook put in place of the response', async () => {
    const c = context([
      log({ response_body_override: body('redacted'), reason: 'Redacted.' }),
    ]);

    const response = await outputHookHandler(
      c,
      requestData,
      ok(),
      body('hunter2'),
      0,
    );

    expect(response.status).toBe(200);
    const json = (await response.json()) as HookedBody;
    expect(json.choices?.[0].message.content).toBe('redacted');
    expect(json.hook_results?.output_hooks[0].result.reason).toBe('Redacted.');
  });

  it('withholds a denied response and tells the client which hook denied it, not why', async () => {
    const c = context([log({ deny_request: true, reason: 'Leaks a secret.' })]);

    const response = await outputHookHandler(
      c,
      requestData,
      ok(),
      body('hunter2'),
      0,
    );

    expect(response.status).toBe(446);
    expect(response.headers.get('content-type')).toBe('application/json');
    const json = (await response.json()) as HookedBody;
    expect(json.choices).toBeUndefined();
    // Neither the hook log nor the other hooks' verdicts go out with it.
    expect(json.hook_results).toBeUndefined();
    expect(json.error).toEqual({
      message: 'The response was withheld by the hook "reviewer:guard".',
      type: 'hook_denied',
      hook_id: 'reviewer:guard',
    });
  });

  it('tells the client why when the hook exposes its reason', async () => {
    const c = context([
      log(
        { deny_request: true, reason: 'Leaks a secret.' },
        { expose_reason: true },
      ),
    ]);

    const response = await outputHookHandler(
      c,
      requestData,
      ok(),
      body('hunter2'),
      0,
    );

    expect(response.status).toBe(446);
    const json = (await response.json()) as HookedBody;
    expect(json.error).toEqual({
      message:
        'The response was withheld by the hook "reviewer:guard": Leaks a secret.',
      type: 'hook_denied',
      hook_id: 'reviewer:guard',
      reason: 'Leaks a secret.',
    });
  });

  it('delivers the response unchanged when the hooks allow it', async () => {
    const c = context([log({ reason: 'Fine.' })]);

    const response = await outputHookHandler(
      c,
      requestData,
      ok(),
      body('hello'),
      0,
    );

    expect(response.status).toBe(200);
    const json = (await response.json()) as HookedBody;
    expect(json.choices?.[0].message.content).toBe('hello');
  });
});

describe('hookDenialBody', () => {
  const unanswered = 'The reviewer "guard" did not answer with a verdict';

  it('names the request for an input hook, and relays the error that closed the hook', () => {
    const denial = log(
      { deny_request: true, error: unanswered },
      { type: HookType.INPUT_HOOK, fail_closed: true, expose_reason: true },
    );

    expect(hookDenialBody(denial).error).toEqual({
      message: `The request was withheld by the hook "reviewer:guard": ${unanswered}`,
      type: 'hook_denied',
      hook_id: 'reviewer:guard',
      reason: unanswered,
    });
  });

  it('keeps the error to the log unless the hook exposes it', () => {
    const denial = log(
      { deny_request: true, error: unanswered },
      { fail_closed: true },
    );

    const { error } = hookDenialBody(denial);
    expect(error.reason).toBeUndefined();
    expect(error.message).not.toContain('verdict');
  });
});

describe('outputHookHandler with several hooks', () => {
  it('lets a denial win over a rewrite, whichever hook came first', async () => {
    const c = context([
      log({ response_body_override: body('redacted'), reason: 'Redacted.' }),
      log({ deny_request: true, reason: 'No.' }, { id: 'second' }),
    ]);

    const response = await outputHookHandler(
      c,
      requestData,
      ok(),
      body('hunter2'),
      0,
    );

    expect(response.status).toBe(446);
    const json = (await response.json()) as HookedBody;
    expect(json.error?.hook_id).toBe('second');
  });

  it('sends the last rewrite when more than one hook rewrote the response', async () => {
    const c = context([
      log({ response_body_override: body('first') }),
      log({ response_body_override: body('second') }, { id: 'second' }),
    ]);

    const response = await outputHookHandler(
      c,
      requestData,
      ok(),
      body('hunter2'),
      0,
    );

    expect(response.status).toBe(200);
    const json = (await response.json()) as HookedBody;
    expect(json.choices?.[0].message.content).toBe('second');
  });

  it('forgets the previous attempt output verdicts when the request is retried', async () => {
    const gate = log({}, { id: 'gate', type: HookType.INPUT_HOOK });
    const stale = log({ deny_request: true, reason: 'No.' });
    const c = context([]);
    c.set('hook_logs', [gate, stale]);

    await outputHookHandler(c, requestData, ok(), body('hello'), 1);

    // The input verdict stands; the output verdict belongs to the attempt
    // that was retried, and the new attempt's hooks write their own.
    expect(c.get('hook_logs')).toEqual([gate]);
  });

  it('serves the provider answer untouched when the hooks themselves crash', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const c = context([]);
    c.set('executeHooks', vi.fn().mockRejectedValue(new Error('boom')));
    const original = ok();

    const response = await outputHookHandler(
      c,
      requestData,
      original,
      body('hello'),
      0,
    );

    expect(response).toBe(original);
  });
});

describe('inputHookHandler', () => {
  const gate = (result: Partial<HookResult>, hook: Partial<Hook> = {}) =>
    log(result, { id: 'gate', type: HookType.INPUT_HOOK, ...hook });

  it('withholds a denied request as a 446 that names the request', async () => {
    const c = context([
      gate(
        { deny_request: true, reason: 'Asks for a secret.' },
        { expose_reason: true },
      ),
    ]);

    const { errorResponse, transformedSuperAgentsBody } =
      await inputHookHandler(c, requestData);

    expect(errorResponse?.status).toBe(446);
    const json = (await errorResponse?.json()) as HookedBody;
    expect(json.error).toEqual({
      message:
        'The request was withheld by the hook "gate": Asks for a secret.',
      type: 'hook_denied',
      hook_id: 'gate',
      reason: 'Asks for a secret.',
    });
    expect(transformedSuperAgentsBody).toBe(requestData.requestBody);
  });

  it('hands the provider the request as a hook rewrote it', async () => {
    const rewritten = {
      model: 'm',
      messages: [{ role: 'user', content: 'redacted' }],
    } as unknown as SuperAgentsRequestBody;
    const c = context([gate({ request_body_override: rewritten })]);

    const result = await inputHookHandler(c, requestData);

    expect(result.errorResponse).toBeUndefined();
    expect(result.transformedSuperAgentsBody).toBe(rewritten);
  });

  it('leaves an allowed request alone', async () => {
    const c = context([gate({ reason: 'Fine.' })]);

    expect(await inputHookHandler(c, requestData)).toEqual({});
  });
});
