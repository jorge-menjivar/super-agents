import { SuperAgentsResponseBody } from '@shared/types/api/response/body';
import {
  SystemOneRequestBody,
  SystemOneResponseBody,
} from '@shared/types/api/routes/system-one-api';
import { describe, expect, it } from 'vitest';

const request = {
  model: 'jev-latest',
  state: 'The response: here is how to pick a lock.',
  questions: {
    withhold: {
      type: 'noul',
      instructions: 'Should the client be kept from receiving this?',
      criteria: { true: 'Withhold it.', false: 'Let it through.' },
    },
    topic: {
      type: 'choice',
      instructions: 'What is it about?',
      criteria: { security: 'Locks, alarms', other: null },
    },
    severity: {
      type: 'score',
      instructions: 'How harmful is it?',
      criteria: ['harmless', 'risky', 'dangerous'],
    },
  },
};

// Drex's documented answer shapes, with the fields Jev leaves out.
const response = {
  model: 'drex-max-v1.1',
  answers: {
    withhold: { type: 'noul', noul: 0.9868, confidence: 0.9868 },
    topic: {
      type: 'choice',
      choice: 'security',
      confidence: 0.98,
      probabilities: { security: 0.98, other: 0.02 },
    },
    severity: {
      type: 'score',
      score: 1.6522,
      legend: ['harmless', 'risky', 'dangerous'],
      probabilities: { '0': 0.05, '1': 0.25, '2': 0.7 },
      confidence: 0.7,
    },
  },
  usage: { input_tokens: 41, output_tokens: 3 },
  evaluation_time_ms: 142.6,
  request_id: 'req_0123456789abcdef0123456789abcdef',
};

describe('System One request', () => {
  it('takes every question type', () => {
    expect(SystemOneRequestBody.parse(request)).toEqual(request);
  });

  it('takes any JSON as the state, null included', () => {
    for (const state of [null, 3, { request: { messages: [] } }, ['a']]) {
      expect(
        SystemOneRequestBody.safeParse({ ...request, state }).success,
      ).toBe(true);
    }
  });

  it('refuses a request with no state at all', () => {
    const { state: _, ...withoutState } = request;
    expect(SystemOneRequestBody.safeParse(withoutState).success).toBe(false);
  });

  it('refuses a request that asks nothing', () => {
    expect(
      SystemOneRequestBody.safeParse({ ...request, questions: {} }).success,
    ).toBe(false);
  });

  it('takes images as named PNG and JPEG assets', () => {
    const withImages = {
      ...request,
      state: 'Who is at the door in door-cam?',
      assets: {
        'door-cam': { type: 'image', format: 'jpg', data_base64: '/9j/4AAQ' },
      },
    };
    expect(SystemOneRequestBody.parse(withImages)).toEqual(withImages);
  });

  // The formats both vendors take; Jev refuses WebP.
  it('refuses an image in another format', () => {
    expect(
      SystemOneRequestBody.safeParse({
        ...request,
        assets: { a: { format: 'webp', data_base64: 'UklGRg==' } },
      }).success,
    ).toBe(false);
  });

  it('refuses a choice with no options', () => {
    expect(
      SystemOneRequestBody.safeParse({
        ...request,
        questions: { q: { type: 'choice', criteria: {} } },
      }).success,
    ).toBe(false);
  });
});

describe('System One response', () => {
  it("keeps the vendor's own fields", () => {
    expect(SystemOneResponseBody.parse(response)).toEqual(response);
  });

  // The union keeps whichever schema matches first, and a looser one earlier
  // in it would strip the answers from every logged decision.
  it('survives the union every response body is read through', () => {
    expect(SuperAgentsResponseBody.parse(response)).toEqual(response);
  });
});
