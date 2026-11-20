import { decisionReviewRequest } from '@api/connectors/hooks/agent';
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
  ],
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
  ],
});

const response = {
  choices: [
    {
      index: 0,
      message: { role: 'assistant', content: 'I will run rm -rf / now.' },
      finish_reason: 'stop',
    },
  ],
};

type Bounded = {
  request: {
    messages: Record<string, unknown>[];
    tools?: unknown[];
    excerpt?: string;
  };
  response: typeof response;
};

describe('withinReviewBudget', () => {
  it('leaves material that fits exactly as it was', () => {
    const material = { request: session(4), response };

    expect(size(material)).toBeLessThan(REVIEW_MATERIAL_BUDGET);
    expect(withinReviewBudget(material)).toBe(material);
  });

  describe('a session past the budget', () => {
    const material = { request: session(60), response };
    const bounded = withinReviewBudget(material) as unknown as Bounded;
    const { messages } = bounded.request;

    it('fits within it', () => {
      expect(size(material)).toBeGreaterThan(REVIEW_MATERIAL_BUDGET);
      expect(size(bounded)).toBeLessThanOrEqual(REVIEW_MATERIAL_BUDGET);
    });

    it('keeps the response it is reviewing whole', () => {
      expect(bounded.response).toEqual(response);
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

  it('clips a response string past what a reviewer needs', () => {
    const long = {
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'z'.repeat(30_000) },
        },
      ],
    };

    const bounded = withinReviewBudget({
      request: session(60),
      response: long,
    }) as unknown as Bounded;

    expect(bounded.response.choices[0].message.content.length).toBeLessThan(
      12_100,
    );
    expect(size(bounded)).toBeLessThanOrEqual(REVIEW_MATERIAL_BUDGET);
  });

  it('keeps the newest end of a request that is not a conversation', () => {
    const request = { input: `${'a'.repeat(100_000)}the newest part` };

    const bounded = withinReviewBudget({ request }) as unknown as Bounded;

    expect(bounded.request.excerpt).toMatch(
      /^\[\d+ earlier characters omitted\]/,
    );
    expect(bounded.request.excerpt).toMatch(/the newest part"}$/);
    expect(size(bounded)).toBeLessThanOrEqual(REVIEW_MATERIAL_BUDGET + 100);
  });
});

describe('decisionReviewRequest, for a long session', () => {
  const hook: Hook = {
    id: 'reviewer:guard',
    type: HookType.OUTPUT_HOOK,
    hook_provider: HookProvider.AGENT,
    config: { agent_name: 'guard', api: 'system_one' },
  } as Hook;

  /** A session whose first user turn showed an image, and so may its last. */
  const withImages = (lastToo: boolean): HookInput => {
    const image = (bytes: string) => ({
      type: 'image_url',
      image_url: { url: `data:image/png;base64,${bytes}` },
    });
    const { messages, tools } = session(60);
    messages.splice(1, 1, {
      role: 'user',
      content: [{ type: 'text', text: 'Look at this.' }, image('OLD')],
    } as never);
    if (lastToo) {
      messages.push({
        role: 'user',
        content: [{ type: 'text', text: 'And this.' }, image('NEW')],
      } as never);
    }
    return {
      requestData: {
        functionName: FunctionName.CHAT_COMPLETE,
        requestBody: { model: 'm', messages, tools },
      } as unknown as SuperAgentsRequestData,
      responseBody: response,
    } as unknown as HookInput;
  };

  it('asks a decision model only what it can read', () => {
    const asked = decisionReviewRequest(hook, withImages(false));

    expect(size(asked.state)).toBeLessThanOrEqual(REVIEW_MATERIAL_BUDGET);
  });

  // Both vendors refuse an asset nothing in the request refers to.
  it('sends only the images the kept turns refer to', () => {
    const asked = decisionReviewRequest(hook, withImages(true));

    expect(Object.values(asked.assets ?? {})).toEqual([
      { type: 'image', format: 'png', data_base64: 'NEW' },
    ]);
  });
});
