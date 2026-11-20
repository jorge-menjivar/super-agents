import { ollamaChatCompleteStreamChunkTransform } from '@api/ai-providers/ollama/chat-complete';
import { openAIChatCompleteJSONToStreamResponseTransform } from '@api/ai-providers/openai/chat-complete';
import { readStream } from '@api/handlers/stream-handler';
import { parseStreamChunksToResponseBody } from '@api/middlewares/logs';
import { AIProvider } from '@shared/types/constants';
import { describe, expect, it } from 'vitest';

/**
 * A stream is stitched four times on its way to a client and to a log: the
 * reader buffers bytes and splits them into events, the provider's transform
 * rewrites each event, the log rebuilds one message out of all of them, and a
 * held stream replays that message as events again. Each of those is a place a
 * character could go missing, and a character missing from the middle of a
 * word is the kind of bug that gets blamed on the model.
 *
 * So the pieces here are cut where cutting hurts: the space between two words
 * is the whole of one delta, or the last character of one and nothing of the
 * next, and the text carries characters no single byte can hold.
 */
const THINKING_PIECES = [
  'The user asked "who built it?"',
  ' I found',
  ' ',
  'git contributors.',
  ' Let me answer',
  ' concisely.',
  '\n\nSecond paragraph — em dash, “smart quotes”, café, 日本語, 🙂.',
  ' Trailing space then end. ',
];
const CONTENT_PIECES = ['Built', ' by', ' ', 'the', ' team.'];

const THINKING = THINKING_PIECES.join('');
const CONTENT = CONTENT_PIECES.join('');

/** An Ollama stream that says the above, one delta at a time. */
function ollamaStream(): string {
  const events: { delta: Record<string, string>; finish_reason?: string }[] =
    THINKING_PIECES.map((reasoning) => ({ delta: { reasoning } }));

  events[0].delta.role = 'assistant';

  for (const content of CONTENT_PIECES) events.push({ delta: { content } });
  events.push({ delta: {}, finish_reason: 'stop' });

  return `${events
    .map(({ delta, finish_reason = null }) =>
      JSON.stringify({
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        created: 1234567890,
        model: 'glm-5.3-flash',
        choices: [{ delta, index: 0, finish_reason }],
      }),
    )
    .map((event) => `data: ${event}\n\n`)
    .join('')}data: [DONE]\n\n`;
}

/** Everything the deltas of an SSE body say, in one string per field. */
function saidBy(sse: string): {
  reasoning: string;
  thinking: string;
  content: string;
} {
  let reasoning = '';
  let thinking = '';
  let content = '';

  for (const line of sse.split('\n')) {
    if (!line.startsWith('data: ') || line.includes('[DONE]')) continue;
    const delta = JSON.parse(line.slice(6).trim()).choices?.[0]?.delta ?? {};
    reasoning += delta.reasoning ?? '';
    content += delta.content ?? '';
    for (const block of delta.content_blocks ?? []) {
      thinking += block.delta?.thinking ?? '';
    }
  }

  return { reasoning, thinking, content };
}

/** A reader that hands the bytes over `sliceSize` at a time. */
function readerOver(bytes: Uint8Array, sliceSize: number) {
  let offset = 0;
  return {
    read: () => {
      if (offset >= bytes.length) {
        return Promise.resolve({ done: true, value: undefined });
      }
      const value = bytes.slice(offset, offset + sliceSize);
      offset += sliceSize;
      return Promise.resolve({ done: false, value });
    },
  } as unknown as ReadableStreamDefaultReader;
}

async function gatewayStream(sliceSize: number): Promise<string> {
  const bytes = new TextEncoder().encode(ollamaStream());
  let out = '';
  for await (const piece of readStream(
    readerOver(bytes, sliceSize),
    '\n\n',
    ollamaChatCompleteStreamChunkTransform,
    false,
    'fallback-id',
    false,
    {} as never,
  )) {
    out += typeof piece === 'string' ? piece : new TextDecoder().decode(piece);
  }
  return out;
}

describe('Stitching a stream loses nothing', () => {
  // One byte at a time cuts every JSON string, every `\n\n` between events,
  // and every character that takes more than one byte to write.
  for (const sliceSize of [1, 2, 3, 7, 64, 997, 1 << 16]) {
    it(`reading ${sliceSize} bytes at a time`, async () => {
      const said = saidBy(await gatewayStream(sliceSize));

      expect(said.reasoning).toBe(THINKING);
      expect(said.thinking).toBe(THINKING);
      expect(said.content).toBe(CONTENT);
    });
  }

  it('rebuilding the log row from those events', async () => {
    const { response_body } = parseStreamChunksToResponseBody(
      await gatewayStream(7),
    );
    const message = (
      response_body.choices as {
        message: {
          content: string;
          content_blocks?: { type: string; thinking?: string }[];
        };
      }[]
    )[0].message;

    expect(message.content).toBe(CONTENT);
    expect(
      (message.content_blocks ?? [])
        .filter((block) => block.type === 'thinking')
        .map((block) => block.thinking)
        .join(''),
    ).toBe(THINKING);
  });

  it('replaying that row as a held stream', async () => {
    const { response_body } = parseStreamChunksToResponseBody(
      await gatewayStream(7),
    );
    const said = saidBy(
      (
        openAIChatCompleteJSONToStreamResponseTransform(
          response_body as never,
          AIProvider.OLLAMA,
          {},
          false,
        ) as string[]
      ).join(''),
    );

    expect(said.reasoning).toBe(THINKING);
    expect(said.thinking).toBe(THINKING);
    expect(said.content).toBe(CONTENT);
  });

  // The replay cuts at 500 characters, which is the one boundary it invents
  // itself rather than inheriting from the provider.
  it('replaying thinking longer than the replay cuts at', () => {
    const long = `${'word '.repeat(400)}end`;
    const said = saidBy(
      (
        openAIChatCompleteJSONToStreamResponseTransform(
          {
            id: 'chatcmpl-1',
            object: 'chat.completion',
            created: 1234567890,
            model: 'glm-5.3-flash',
            choices: [
              {
                index: 0,
                finish_reason: 'stop',
                message: {
                  role: 'assistant',
                  content: 'answer',
                  content_blocks: [
                    { type: 'thinking', thinking: long },
                    { type: 'text', text: 'answer' },
                  ],
                },
              },
            ],
          } as never,
          AIProvider.OLLAMA,
          {},
          false,
        ) as string[]
      ).join(''),
    );

    expect(said.reasoning).toBe(long);
    expect(said.thinking).toBe(long);
    expect(said.content).toBe('answer');
  });
});
