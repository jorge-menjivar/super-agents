import { heldStreamFunction, releaseHeldStream } from '@api/utils/held-stream';
import { FunctionName } from '@shared/types/api/request/function-name';
import { AIProvider } from '@shared/types/constants';
import { CacheMode } from '@shared/types/middleware/cache';
import {
  type Hook,
  HookProvider,
  HookType,
} from '@shared/types/middleware/hooks';
import { describe, expect, it } from 'vitest';

const hook = (overrides: Partial<Hook> = {}): Hook => ({
  id: 'h',
  type: HookType.OUTPUT_HOOK,
  hook_provider: HookProvider.AGENT,
  config: { agent_name: 'guard' },
  await: true,
  cache_mode: CacheMode.DISABLED,
  fail_closed: false,
  expose_reason: false,
  ...overrides,
});

describe('heldStreamFunction', () => {
  it('holds a stream a blocking output hook has to see whole', () => {
    expect(
      heldStreamFunction(
        { hooks: [hook()] },
        FunctionName.STREAM_CHAT_COMPLETE,
      ),
    ).toBe(FunctionName.CHAT_COMPLETE);
    expect(
      heldStreamFunction({ hooks: [hook()] }, FunctionName.STREAM_COMPLETE),
    ).toBe(FunctionName.COMPLETE);
  });

  it('lets a stream through when no output hook waits on it', () => {
    expect(
      heldStreamFunction({ hooks: [] }, FunctionName.STREAM_CHAT_COMPLETE),
    ).toBeNull();
    expect(
      heldStreamFunction(
        { hooks: [hook({ await: false })] },
        FunctionName.STREAM_CHAT_COMPLETE,
      ),
    ).toBeNull();
    expect(
      heldStreamFunction(
        { hooks: [hook({ type: HookType.INPUT_HOOK })] },
        FunctionName.STREAM_CHAT_COMPLETE,
      ),
    ).toBeNull();
  });

  it('holds nothing that hooks do not review', () => {
    expect(
      heldStreamFunction(
        { hooks: [hook()] },
        FunctionName.CREATE_MODEL_RESPONSE,
      ),
    ).toBeNull();
  });
});

describe('releaseHeldStream', () => {
  const completion = {
    id: 'chatcmpl-1',
    object: 'chat.completion',
    created: 1,
    model: 'm',
    choices: [
      {
        index: 0,
        finish_reason: 'stop',
        message: { role: 'assistant', content: 'the whole answer' },
      },
    ],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  };

  it('streams the held response to the client as events', async () => {
    const response = new Response(JSON.stringify(completion), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

    const released = await releaseHeldStream(
      response,
      AIProvider.OPENAI,
      FunctionName.CHAT_COMPLETE,
    );

    expect(released.status).toBe(200);
    expect(released.headers.get('content-type')).toBe('text/event-stream');
    const text = await released.text();
    expect(text).toContain('data: ');
    expect(text).toContain('the whole answer');
    expect(text).toContain('[DONE]');
  });

  it('passes a denial through as the JSON error it is', async () => {
    const response = new Response(JSON.stringify({ error: 'denied' }), {
      status: 446,
      headers: { 'content-type': 'application/json' },
    });

    const released = await releaseHeldStream(
      response,
      AIProvider.OPENAI,
      FunctionName.CHAT_COMPLETE,
    );

    expect(released).toBe(response);
  });
});
