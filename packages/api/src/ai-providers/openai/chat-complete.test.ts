import {
  openAIChatCompleteConfig,
  openAIChatCompleteJSONToStreamResponseTransform,
} from '@api/ai-providers/openai/chat-complete';
import { transformUsingProviderConfig } from '@api/services/transform-to-provider-request';
import type { SuperAgentsRequestBody } from '@shared/types/api/request/body';
import type { SuperAgentsTarget } from '@shared/types/api/request/headers';
import { AIProvider } from '@shared/types/constants';
import { describe, expect, it } from 'vitest';

describe('OpenAI chat completions configuration', () => {
  const target = {} as SuperAgentsTarget;
  const body = {
    model: 'gpt-5.6',
    messages: [{ role: 'user', content: 'Hello' }],
  } as SuperAgentsRequestBody;

  /**
   * The parameter only helps if it reaches OpenAI: the internal skills send
   * it to stop a billed cache write, and a config that did not list it would
   * drop it on the way out.
   */
  it('forwards prompt_cache_options as sent', () => {
    const sent = transformUsingProviderConfig(
      openAIChatCompleteConfig,
      { ...body, prompt_cache_options: { mode: 'explicit' } },
      target,
    );

    expect(sent.prompt_cache_options).toEqual({ mode: 'explicit' });
  });

  it('leaves prompt_cache_options out when the request has none', () => {
    const sent = transformUsingProviderConfig(
      openAIChatCompleteConfig,
      body,
      target,
    );

    expect(sent).not.toHaveProperty('prompt_cache_options');
  });
});

/**
 * What a blocking output hook -- a reviewer -- leaves the client: the answer
 * was fetched whole, judged, and only then streamed. This replay is the only
 * stream that client ever sees.
 */
describe('Replaying a held answer as a stream', () => {
  function replay(message: Record<string, unknown>): Record<string, unknown>[] {
    const chunks = openAIChatCompleteJSONToStreamResponseTransform(
      {
        id: 'chatcmpl-871',
        object: 'chat.completion',
        created: 1234567890,
        model: 'glm-5.3-flash',
        choices: [{ index: 0, message, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 111, total_tokens: 121 },
        // The implementation reads the second argument as the provider it
        // stamps on every chunk, whatever the shared signature calls it.
      } as unknown as Record<string, unknown>,
      AIProvider.OLLAMA,
      {},
      false,
    ) as string[];

    return chunks
      .filter((chunk) => !chunk.includes('[DONE]'))
      .map((chunk) => JSON.parse(chunk.replace(/^data: /, '').trim()));
  }

  function deltasOf(
    message: Record<string, unknown>,
  ): Record<string, unknown>[] {
    return replay(message).map(
      (chunk) =>
        (chunk.choices as { delta: Record<string, unknown> }[])[0].delta,
    );
  }

  it('streams the thinking in the field a client reads, and the block the dashboard reads', () => {
    const deltas = deltasOf({
      role: 'assistant',
      content: 'Multiplying 17 by 23',
      content_blocks: [
        { type: 'thinking', thinking: '17 * 23 = 340 + 51' },
        { type: 'text', text: 'Multiplying 17 by 23' },
      ],
    });

    const thought = deltas.find((delta) => delta.reasoning);
    expect(thought?.reasoning).toBe('17 * 23 = 340 + 51');
    expect(thought?.content_blocks).toEqual([
      { index: 0, delta: { thinking: '17 * 23 = 340 + 51' } },
    ]);

    // And the answer still arrives, after the thinking.
    expect(
      deltas.some((delta) => delta.content === 'Multiplying 17 by 23'),
    ).toBe(true);
  });

  it('sends no chunk for a thinking block nothing signed', () => {
    const deltas = deltasOf({
      role: 'assistant',
      content: 'Multiplying 17 by 23',
      content_blocks: [
        { type: 'thinking', thinking: '17 * 23 = 340 + 51' },
        { type: 'text', text: 'Multiplying 17 by 23' },
      ],
    });

    expect(
      deltas.some(
        (delta) =>
          Array.isArray(delta.content_blocks) &&
          delta.content_blocks.some(
            (block) =>
              Object.keys((block as { delta: object }).delta).length === 0,
          ),
      ),
    ).toBe(false);
  });

  it('says nothing about reasoning for an answer that did none', () => {
    const deltas = deltasOf({
      role: 'assistant',
      content: 'Multiplying 17 by 23',
    });

    expect(deltas.every((delta) => delta.reasoning === undefined)).toBe(true);
  });
});
