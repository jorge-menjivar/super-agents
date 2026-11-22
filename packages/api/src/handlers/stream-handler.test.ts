import { openAIChatCompleteJSONToStreamResponseTransform } from '@api/ai-providers/openai/chat-complete';
import {
  handleJSONToStreamResponse,
  handleStreamingMode,
} from '@api/handlers/stream-handler';
import type { SuperAgentsRequestData } from '@shared/types/api/request/body';
import { FunctionName } from '@shared/types/api/request/function-name';
import { AIProvider } from '@shared/types/constants';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * The pumps that copy a provider's stream to a client run in the background,
 * where nothing awaits them. An error they let out is an unhandled
 * rejection, and Node ends the process on one: a client that stopped reading
 * a stream partway took the whole server down. A pump handles its own end.
 */

const requestData = {
  functionName: FunctionName.STREAM_CHAT_COMPLETE,
  requestBody: { model: 'gpt-4o', messages: [], stream: true },
} as unknown as SuperAgentsRequestData;

/** A provider stream that sends a chunk, then keeps sending until stopped. */
const providerStream = () => {
  const encoder = new TextEncoder();
  let stopped = false;
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (stopped) {
        return;
      }
      sent += 1;
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({
            id: 'c',
            object: 'chat.completion.chunk',
            created: 1,
            model: 'gpt-4o',
            choices: [{ index: 0, delta: { content: `part ${sent} ` } }],
          })}\n\n`,
        ),
      );
      await new Promise((resolve) => setTimeout(resolve, 5));
    },
    cancel() {
      stopped = true;
    },
  });
  return { body, wasStopped: () => stopped };
};

/** Rejections nothing handled, collected for the test to look at. */
let unhandled: unknown[] = [];
const collect = (reason: unknown) => {
  unhandled.push(reason);
};

beforeEach(() => {
  unhandled = [];
  process.on('unhandledRejection', collect);
});

afterEach(() => {
  process.off('unhandledRejection', collect);
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

describe('handleStreamingMode', () => {
  it('survives a client that stops reading partway, and stops the provider', async () => {
    const provider = providerStream();
    const response = handleStreamingMode(
      new Response(provider.body, {
        headers: { 'content-type': 'text/event-stream' },
      }),
      AIProvider.OPENAI,
      undefined,
      'https://api.openai.com/v1/chat/completions',
      requestData,
      true,
    );

    const reader = response.body?.getReader();
    await reader?.read();
    await reader?.cancel('the client went away');
    await settle();

    expect(unhandled).toEqual([]);
    expect(provider.wasStopped()).toBe(true);
  });

  it('survives the stream being cancelled before it is read', async () => {
    const provider = providerStream();
    const response = handleStreamingMode(
      new Response(provider.body),
      AIProvider.OPENAI,
      undefined,
      'https://api.openai.com/v1/chat/completions',
      requestData,
      true,
    );

    // What withholding a stream a hook could not judge does.
    await response.body?.cancel();
    await settle();

    expect(unhandled).toEqual([]);
  });
});

describe('handleJSONToStreamResponse', () => {
  it('survives a client that stops reading a replayed held stream', async () => {
    const answer = {
      id: 'c',
      object: 'chat.completion',
      created: 1,
      model: 'gpt-4o',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'a held answer' },
          finish_reason: 'stop',
        },
      ],
    };
    const response = await handleJSONToStreamResponse(
      new Response(JSON.stringify(answer)),
      AIProvider.OPENAI,
      openAIChatCompleteJSONToStreamResponseTransform as never,
    );

    await response.body?.cancel();
    await settle();

    expect(unhandled).toEqual([]);
  });
});
