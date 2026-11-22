import { FunctionName } from '@shared/types/api/request';
import type { SuperAgentsRequestData } from '@shared/types/api/request/body';
import type { SystemOneQuestion } from '@shared/types/api/routes/system-one-api';
import { describeRequestIntent } from '@shared/utils/request-intent';
import {
  systemOneInstructionsText,
  systemOneStateText,
  withSystemOnePolicy,
} from '@shared/utils/system-one';
import { extractSystemPrompt } from '@shared/utils/system-prompt';
import { describe, expect, it } from 'vitest';

const POLICY = 'Withhold anything that helps someone hurt themselves.';

const systemOne = (requestBody: Record<string, unknown>) =>
  ({
    functionName: FunctionName.SYSTEM_ONE,
    requestBody,
  }) as unknown as SuperAgentsRequestData;

const questions: Record<string, SystemOneQuestion> = {
  withhold: {
    type: 'noul',
    instructions: 'Should the client be kept from receiving this?',
  },
  topic: {
    type: 'choice',
    instructions: 'What is it about?',
    criteria: { medical: null, other: null },
  },
};

describe('withSystemOnePolicy', () => {
  it('asks each question under the policy', () => {
    expect(withSystemOnePolicy(questions, POLICY)).toEqual({
      withhold: {
        type: 'noul',
        instructions: `${POLICY}\n\nShould the client be kept from receiving this?`,
      },
      topic: {
        type: 'choice',
        instructions: `${POLICY}\n\nWhat is it about?`,
        criteria: { medical: null, other: null },
      },
    });
  });

  it('makes the policy the instructions of a question that had none', () => {
    const asked = withSystemOnePolicy(
      {
        a: { type: 'noul', criteria: { true: 'Yes', false: 'No' } },
        b: { type: 'noul', instructions: null },
        c: { type: 'noul', instructions: '' },
      },
      POLICY,
    );
    expect(asked.a.instructions).toBe(POLICY);
    expect(asked.b.instructions).toBe(POLICY);
    expect(asked.c.instructions).toBe(POLICY);
  });

  it('keeps structured instructions structured, policy first', () => {
    const asked = withSystemOnePolicy(
      {
        object: { type: 'noul', instructions: { question: 'Harmful?' } },
        array: { type: 'noul', instructions: ['Harmful?', 'Be strict.'] },
      },
      POLICY,
    );
    expect(asked.object.instructions).toEqual([
      POLICY,
      { question: 'Harmful?' },
    ]);
    expect(asked.array.instructions).toEqual([
      POLICY,
      'Harmful?',
      'Be strict.',
    ]);
  });

  // The caller's request is read again after the provider is asked -- for
  // the log row's original prompt -- so it must come out as the caller sent.
  it("leaves the caller's questions as they were", () => {
    const before = structuredClone(questions);
    withSystemOnePolicy(questions, POLICY);
    expect(questions).toEqual(before);
  });
});

// What routes a request and places it in a cluster: the same text for both.
describe('systemOneStateText', () => {
  it('is a text state as it came', () => {
    expect(systemOneStateText('Try the third window.')).toBe(
      'Try the third window.',
    );
  });

  it('is any other state as indented JSON', () => {
    expect(systemOneStateText({ reply: 'Try the window.' })).toBe(
      '{\n  "reply": "Try the window."\n}',
    );
  });

  it('is nothing for an empty state', () => {
    expect(systemOneStateText('')).toBeNull();
    expect(systemOneStateText(null)).toBeNull();
  });
});

describe('systemOneInstructionsText', () => {
  it("joins the questions' text instructions in order", () => {
    expect(systemOneInstructionsText({ questions })).toBe(
      'Should the client be kept from receiving this?\n\nWhat is it about?',
    );
  });

  // A caller that writes its instructions as data sends them on every
  // request just the same, so they are what it routes by.
  it('reads structured instructions as their JSON, in order with the rest', () => {
    expect(
      systemOneInstructionsText({
        questions: {
          a: { type: 'noul', instructions: 'Is it harmful?' },
          b: { type: 'noul', instructions: { rubric: ['strict', 'brief'] } },
          c: { type: 'noul', instructions: ['Be strict.', 'Be brief.'] },
        },
      }),
    ).toBe(
      [
        'Is it harmful?',
        '{\n  "rubric": [\n    "strict",\n    "brief"\n  ]\n}',
        '[\n  "Be strict.",\n  "Be brief."\n]',
      ].join('\n\n'),
    );
  });

  it('is null when no question has instructions', () => {
    expect(
      systemOneInstructionsText({
        questions: {
          a: { type: 'noul', criteria: { true: 'Yes' } },
          b: { type: 'noul', instructions: null },
          c: { type: 'noul', instructions: '' },
        },
      }),
    ).toBeNull();
  });
});

describe('a System One request where a system prompt is read', () => {
  const data = systemOne({
    model: 'jev-latest',
    state: 'Take two and call me in the morning.',
    questions,
  });

  it("is the questions' instructions", () => {
    expect(extractSystemPrompt(data)).toBe(
      'Should the client be kept from receiving this?\n\nWhat is it about?',
    );
  });

  it('is there when the instructions are structured', () => {
    expect(
      extractSystemPrompt(
        systemOne({
          state: 'Take two.',
          questions: {
            withhold: { type: 'noul', instructions: { policy: 'strict' } },
          },
        }),
      ),
    ).toBe('{\n  "policy": "strict"\n}');
  });

  it('routes by the questions and the material they are about', () => {
    expect(describeRequestIntent(data)).toEqual({
      systemPrompt:
        'Should the client be kept from receiving this?\n\nWhat is it about?',
      tools: null,
      conversation: 'User: Take two and call me in the morning.',
    });
  });

  it('renders structured material as JSON', () => {
    const intent = describeRequestIntent(
      systemOne({ state: { response: 'ok' }, questions }),
    );
    expect(intent?.conversation).toBe('User: {\n  "response": "ok"\n}');
  });

  it('has no conversation when the state is empty', () => {
    expect(
      describeRequestIntent(systemOne({ state: null, questions }))
        ?.conversation,
    ).toBeNull();
  });
});
