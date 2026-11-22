import { decisionReview } from '@api/connectors/hooks/agent';
import {
  REVIEW_MATERIAL_BUDGET,
  withinReviewBudget,
} from '@api/connectors/hooks/review-budget';
import type { SuperAgentsRequestData } from '@shared/types/api/request/body';
import { FunctionName } from '@shared/types/api/request/function-name';
import {
  type Hook,
  type HookInput,
  HookProvider,
  HookType,
} from '@shared/types/middleware/hooks';
import { describe, expect, it } from 'vitest';

const size = (value: unknown) => JSON.stringify(value).length;

/** An agent harness's session: a long system prompt, tools, and turns. */
const session = (turns: number) => ({
  messages: [
    {
      role: 'system',
      content: `You are a coding agent. ${'x'.repeat(12_000)}`,
    },
    { role: 'user', content: 'Fix the failing test in parser.ts' },
    ...Array.from({ length: turns }, (_, index) =>
      index % 2 === 0
        ? {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: `call-${index}`,
                type: 'function',
                function: { name: 'read', arguments: `{"n":${index}}` },
              },
            ],
          }
        : {
            role: 'tool',
            tool_call_id: `call-${index - 1}`,
            content: `file ${index}: ${'y'.repeat(5_000)}`,
          },
    ),
  ] as Record<string, unknown>[],
  tools: [
    {
      type: 'function',
      function: {
        name: 'read',
        description: 'Reads a file',
        parameters: {
          type: 'object',
          properties: { path: { type: 'string' } },
        },
      },
    },
    { type: 'function', function: { name: 'bash', parameters: {} } },
  ] as unknown[],
});

const reply = (content: string) => ({
  choices: [
    {
      index: 0,
      message: { role: 'assistant', content },
      finish_reason: 'stop',
    },
  ],
});

const response = reply('I will run rm -rf / now.');

type Bounded = {
  request: {
    messages: Record<string, unknown>[];
    tools?: unknown[];
    excerpt?: string;
  };
  response: {
    choices: { message: { content: string } }[];
    excerpt?: string;
  };
};

const bound = <T extends { request: unknown; response?: unknown }>(
  material: T,
) => {
  const { material: bounded, complete } = withinReviewBudget(material);
  return { bounded: bounded as unknown as Bounded, complete };
};

describe('withinReviewBudget', () => {
  it('leaves material that fits exactly as it was', () => {
    const material = { request: session(4), response };

    expect(size(material)).toBeLessThan(REVIEW_MATERIAL_BUDGET);
    expect(withinReviewBudget(material)).toEqual({ material, complete: true });
  });

  describe('a session past the budget', () => {
    const material = { request: session(60), response };
    const { bounded, complete } = bound(material);
    const { messages } = bounded.request;

    it('fits within it', () => {
      expect(size(material)).toBeGreaterThan(REVIEW_MATERIAL_BUDGET);
      expect(size(bounded)).toBeLessThanOrEqual(REVIEW_MATERIAL_BUDGET);
    });

    it('keeps the response it is reviewing whole', () => {
      expect(bounded.response).toEqual(response);
      expect(complete).toBe(true);
    });

    it('keeps the start of the system prompt, and says what it cut', () => {
      const [system] = messages;
      expect(system.role).toBe('system');
      expect(system.content).toMatch(/^You are a coding agent\./);
      expect(system.content).toMatch(/more characters\]$/);
    });

    it('keeps what the user asked, and the newest turns', () => {
      expect(messages[1]).toEqual({
        role: 'user',
        content: 'Fix the failing test in parser.ts',
      });
      const last = messages.at(-1) as { content: string };
      expect(last.content).toMatch(/^file 59: /);
    });

    it('marks where it left turns out, and how many', () => {
      expect(messages[2]).toHaveProperty('omitted_messages');
      const omitted = messages[2].omitted_messages as number;
      // Everything is accounted for: kept, or counted as left out.
      const kept = messages.filter(
        (message) => !('omitted_messages' in message),
      );
      expect(kept.length + omitted).toBe(1 + 1 + 60);
    });

    it('clips a long tool output rather than dropping the turn', () => {
      const last = messages.at(-1) as { content: string };
      expect(last.content.length).toBeLessThan(4_100);
      expect(last.content).toMatch(/more characters\]$/);
    });

    it('names the tools instead of describing them', () => {
      expect(bounded.request.tools).toEqual(['read', 'bash']);
    });
  });

  // Text placed after a cut would never be reviewed, so a response that
  // fits is never cut -- however long its strings are.
  it('keeps a long response whole while it fits', () => {
    const long = reply(`${'z'.repeat(30_000)} and then the harmful part`);

    const { bounded, complete } = bound({
      request: session(60),
      response: long,
    });

    expect(bounded.response).toEqual(long);
    expect(complete).toBe(true);
    expect(size(bounded)).toBeLessThanOrEqual(REVIEW_MATERIAL_BUDGET);
  });

  it('says so when even the response had to be cut', () => {
    const { bounded, complete } = bound({
      request: session(60),
      response: reply('z'.repeat(80_000)),
    });

    expect(complete).toBe(false);
    expect(size(bounded)).toBeLessThanOrEqual(REVIEW_MATERIAL_BUDGET);
  });

  it('holds for a response with many choices', () => {
    const many = {
      choices: Array.from({ length: 20 }, (_, index) => ({
        index,
        message: { role: 'assistant', content: 'w'.repeat(10_000) },
      })),
    };

    const { bounded, complete } = bound({
      request: session(4),
      response: many,
    });

    expect(complete).toBe(false);
    expect(size(bounded)).toBeLessThanOrEqual(REVIEW_MATERIAL_BUDGET);
  });

  it('holds for a last turn made of many parts', () => {
    const request = session(4);
    request.messages.push({
      role: 'user',
      content: Array.from({ length: 40 }, () => ({
        type: 'text',
        text: 'p'.repeat(7_000),
      })),
    });

    const { bounded } = bound({ request, response });

    expect(size(bounded)).toBeLessThanOrEqual(REVIEW_MATERIAL_BUDGET);
    expect(bounded.response).toEqual(response);
  });

  it('holds for thousands of tools and system messages', () => {
    const request = session(60);
    request.tools = Array.from({ length: 5_000 }, (_, index) => ({
      type: 'function',
      function: { name: `tool_${index}`, parameters: {} },
    }));
    request.messages.unshift(
      ...Array.from({ length: 500 }, () => ({
        role: 'system',
        content: 's'.repeat(500),
      })),
    );

    const { bounded } = bound({ request, response });

    expect(size(bounded)).toBeLessThanOrEqual(REVIEW_MATERIAL_BUDGET);
    expect(bounded.request.tools?.at(-1)).toMatch(/and \d+ more$/);
    expect(
      bounded.request.messages.filter((message) => message.role === 'system'),
    ).toHaveLength(1);
  });

  // JSON-encoding escapes every quote, so quote-heavy text grows on the way:
  // cutting it by its own length used to overshoot the budget many times.
  it('holds for quote-heavy tool calls in a huge conversation', () => {
    const quoted = '{"a":"\\"b\\""}'.repeat(400);
    const calls = {
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: null,
            tool_calls: Array.from({ length: 80 }, (_, i) => ({
              id: `call-${i}`,
              type: 'function',
              function: { name: 'write', arguments: quoted },
            })),
          },
        },
      ],
    };
    const request = session(4);
    request.messages.push({ role: 'user', content: '"'.repeat(1_000_000) });

    const { bounded, complete } = bound({ request, response: calls });

    expect(size(bounded)).toBeLessThanOrEqual(REVIEW_MATERIAL_BUDGET);
    expect(complete).toBe(false);
  });

  it('holds for a quote-heavy prompt with nothing else', () => {
    const { bounded } = bound({ request: { prompt: '"'.repeat(200_000) } });

    expect(size(bounded)).toBeLessThanOrEqual(REVIEW_MATERIAL_BUDGET);
  });

  it('keeps the newest end of a request that is not a conversation', () => {
    const request = { input: `${'a'.repeat(100_000)}the newest part` };

    const { bounded } = bound({ request });

    expect(bounded.request.excerpt).toMatch(
      /^\[\d+ earlier characters omitted\]/,
    );
    expect(bounded.request.excerpt).toMatch(/the newest part"}$/);
    expect(size(bounded)).toBeLessThanOrEqual(REVIEW_MATERIAL_BUDGET);
  });
});

describe('decisionReview, for a long session', () => {
  const hook: Hook = {
    id: 'reviewer:guard',
    type: HookType.OUTPUT_HOOK,
    hook_provider: HookProvider.AGENT,
    config: { agent_name: 'guard', api: 'system_one' },
  } as Hook;

  const asked = (
    messages: Record<string, unknown>[],
    responseBody: unknown = response,
  ): HookInput =>
    ({
      requestData: {
        functionName: FunctionName.CHAT_COMPLETE,
        requestBody: { model: 'm', messages, tools: session(0).tools },
      } as unknown as SuperAgentsRequestData,
      responseBody,
    }) as unknown as HookInput;

  const image = (bytes: string) => ({
    type: 'image_url',
    image_url: { url: `data:image/png;base64,${bytes}` },
  });

  it('asks a decision model only what it can read', () => {
    const { body } = decisionReview(hook, asked(session(60).messages));

    expect(size(body.state)).toBeLessThanOrEqual(REVIEW_MATERIAL_BUDGET);
  });

  // Token log-probabilities say nothing about the answer, and can run to
  // megabytes: they would push the review past what the model reads.
  it('leaves the response log-probabilities out', () => {
    const withLogprobs = {
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'Fine.' },
          logprobs: {
            content: Array.from({ length: 20_000 }, (_, i) => ({
              token: `t${i}`,
              logprob: -0.1,
              top_logprobs: [],
            })),
          },
          finish_reason: 'stop',
        },
      ],
    };

    const { body, complete } = decisionReview(
      hook,
      asked(session(4).messages, withLogprobs),
    );

    expect(JSON.stringify(body.state)).not.toContain('logprob');
    expect((body.state as Bounded).response).toEqual(reply('Fine.'));
    expect(complete).toBe(true);
  });

  // Whatever the client receives, the reviewer sees: a reply that is only a
  // legacy function call, or thinking in content blocks, is the reply.
  it('shows a function call and content blocks the client would receive', () => {
    const calling = {
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: null,
            function_call: { name: 'wire_money', arguments: '{"to":"x"}' },
            content_blocks: [
              { type: 'thinking', thinking: 'They asked me to.' },
            ],
          },
          finish_reason: 'function_call',
        },
      ],
    };

    const { body } = decisionReview(hook, asked(session(4).messages, calling));
    const shown = JSON.stringify((body.state as Bounded).response);

    expect(shown).toContain('wire_money');
    expect(shown).toContain('They asked me to.');
  });

  // Both vendors refuse an asset nothing in the request refers to.
  it('sends only the images the kept turns refer to', () => {
    const { messages } = session(60);
    messages.splice(1, 1, {
      role: 'user',
      content: [{ type: 'text', text: 'Look at this.' }, image('OLD')],
    });
    messages.push({
      role: 'user',
      content: [{ type: 'text', text: 'And this.' }, image('NEW')],
    });

    const { body } = decisionReview(hook, asked(messages));

    expect(Object.values(body.assets ?? {})).toEqual([
      { type: 'image', format: 'png', data_base64: 'NEW' },
    ]);
  });

  // The newest images are the ones the review is about.
  it('shows the newest images when there are more than it can', () => {
    const { messages } = session(4);
    for (let i = 0; i < 12; i++) {
      messages.push({
        role: 'user',
        content: [{ type: 'text', text: `Picture ${i}.` }, image(`IMG${i}`)],
      });
    }

    const { body } = decisionReview(hook, asked(messages));
    const shown = Object.values(body.assets ?? {}).map(
      (asset) => asset.data_base64,
    );

    expect(shown).toContain('IMG11');
    expect(shown).not.toContain('IMG0');
  });
});
