import { FunctionName } from '@shared/types/api/request';
import type { SuperAgentsRequestData } from '@shared/types/api/request/body';
import type { SystemOneQuestion } from '@shared/types/api/routes/system-one-api';
import { describeRequestIntent } from '@shared/utils/request-intent';
import {
  systemOneInstructionsText,
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

describe('systemOneInstructionsText', () => {
  it("joins the questions' text instructions in order", () => {
    expect(systemOneInstructionsText({ questions })).toBe(
      'Should the client be kept from receiving this?\n\nWhat is it about?',
    );
  });

  it('is null when no question says anything in words', () => {
    expect(
      systemOneInstructionsText({
        questions: {
          a: { type: 'noul', criteria: { true: 'Yes' } },
          b: { type: 'noul', instructions: { structured: true } },
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
