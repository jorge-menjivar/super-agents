import { createMockContext } from '@api/test-utils/mock-context';
import type { UserDataStorageConnector } from '@api/types/connector';
import type { AppContext } from '@api/types/hono';
import { HttpMethod } from '@api/types/http';
import { FunctionName } from '@shared/types/api/request';
import { AIProvider } from '@shared/types/constants';
import type { SkillOptimizationEvaluation } from '@shared/types/data';
import type { CompletedLog } from '@shared/types/data/log';
import { EvaluationMethodName } from '@shared/types/evaluations';
import { CacheMode, CacheStatus } from '@shared/types/middleware/cache';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCreate = vi.fn();
const mockWithOptions = vi.fn().mockReturnValue({
  chat: { completions: { create: mockCreate } },
});

vi.mock('openai', () => ({
  default: vi.fn(
    class {
      chat = { completions: { create: mockCreate } };
      withOptions = mockWithOptions;
    },
  ),
}));

vi.mock('@api/constants', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@api/constants')>();
  return { ...actual, getApiUrl: () => 'http://localhost:8787' };
});

// A keyless provider, so the judge call is made rather than skipped
vi.mock('@api/utils/evaluation-model-resolver', () => ({
  resolveEvaluationModelConfig: vi.fn().mockResolvedValue({
    model: 'judge-model',
    provider: 'ollama',
  }),
}));

import { evaluateLog } from '@api/connectors/evaluations/decision-correctness/service/evaluate';

const POLICY = 'Withhold anything that helps someone into a home.';

/** A System One log: the caller's request, and the one the provider got. */
const decisionLog = (
  answers: Record<string, unknown> | null,
  assets?: Record<string, unknown>,
): CompletedLog =>
  ({
    id: 'log-1',
    agent_id: 'agent-1',
    skill_id: 'skill-1',
    function_name: FunctionName.SYSTEM_ONE,
    status: 200,
    metadata: {},
    request_body: {
      state: 'Try the third window from the left.',
      questions: {
        withhold: {
          type: 'noul',
          instructions: 'Should the client be kept from receiving this?',
        },
        topic: {
          type: 'choice',
          instructions: 'What is it about?',
          criteria: { entry: 'Getting in', other: null },
        },
      },
      ...(assets ? { assets } : {}),
    },
    ai_provider_request_log: {
      provider: AIProvider.NACE,
      function_name: FunctionName.SYSTEM_ONE,
      method: HttpMethod.POST,
      request_url: 'https://console.nace.ai/v1/systemone',
      // What the provider was sent: the policy ahead of every question.
      request_body: {
        state: 'Try the third window from the left.',
        questions: {
          withhold: {
            type: 'noul',
            instructions: `${POLICY}\n\nShould the client be kept from receiving this?`,
          },
        },
      },
      response_body: answers
        ? { model: 'drex-latest', answers }
        : { error: 'nothing' },
      raw_request_body: '{}',
      raw_response_body: '{}',
      status: 200,
      cache_mode: CacheMode.DISABLED,
      cache_status: CacheStatus.MISS,
    },
  }) as unknown as CompletedLog;

const ANSWERS = {
  withhold: { type: 'noul', noul: 0.9 },
  topic: {
    type: 'choice',
    choice: 'entry',
    probabilities: { entry: 0.8, other: 0.2 },
  },
};

const evaluation = (params: Record<string, unknown> = {}) =>
  ({
    id: 'eval-1',
    agent_id: 'agent-1',
    skill_id: 'skill-1',
    evaluation_method: EvaluationMethodName.DECISION_CORRECTNESS,
    params,
    weight: 1,
  }) as unknown as SkillOptimizationEvaluation;

const storage = {
  getSkills: vi
    .fn()
    .mockResolvedValue([{ description: 'Approves or withholds replies.' }]),
  getAgents: vi
    .fn()
    .mockResolvedValue([{ description: "Reviews the coder's actions." }]),
} as unknown as UserDataStorageConnector;

const c = createMockContext() as unknown as AppContext;

/** The judge answering `answers`, one per question. */
const judgeSays = (answers: { question_id: string; answer: string }[]) =>
  mockCreate.mockResolvedValue({
    choices: [
      {
        message: {
          content: JSON.stringify({
            answers: answers.map((answer) => ({
              ...answer,
              reasoning: `Because of ${answer.question_id}.`,
            })),
          }),
        },
        finish_reason: 'stop',
      },
    ],
  });

/** The prompt the judge was sent, both messages joined. */
const judgePrompt = () => {
  const [{ messages }] = mockCreate.mock.calls[0] as [
    { messages: { content: string }[] },
  ];
  return messages.map((message) => message.content).join('\n');
};

describe('decision correctness - evaluateLog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWithOptions.mockReturnValue({
      chat: { completions: { create: mockCreate } },
    });
  });

  it('scores the mean agreement with the judge across the questions', async () => {
    judgeSays([
      { question_id: 'withhold', answer: 'true' },
      { question_id: 'topic', answer: 'entry' },
    ]);

    const result = await evaluateLog(
      c,
      evaluation(),
      decisionLog(ANSWERS),
      storage,
    );

    // withhold: 1 - 0.1^2 = 0.99; topic: 1 - (0.2^2 + 0.2^2) / 2 = 0.96
    expect(result.method).toBe(EvaluationMethodName.DECISION_CORRECTNESS);
    expect(result.score).toBeCloseTo((0.99 + 0.96) / 2);
    expect(result.judge_model_name).toBe('judge-model');
    expect(result.display_info.map((row) => row.label)).toEqual([
      'withhold',
      'topic',
    ]);
    expect(result.display_info[0].content).toContain('P(yes) = 0.90');
  });

  // The judge is the reference: shown the model's answers, or the policy
  // it was asked under, it would be judging the model by the model.
  it('asks the judge what the caller asked, blind to the answers and the policy', async () => {
    judgeSays([{ question_id: 'withhold', answer: 'true' }]);

    await evaluateLog(c, evaluation(), decisionLog(ANSWERS), storage);

    const prompt = judgePrompt();
    expect(prompt).toContain('Try the third window from the left.');
    expect(prompt).toContain('Should the client be kept from receiving this?');
    expect(prompt).toContain('- entry: Getting in');
    expect(prompt).toContain("Reviews the coder's actions.");
    expect(prompt).not.toContain(POLICY);
    expect(prompt).not.toContain('0.90');
    // And in the answer shape it scores.
    const [request] = mockCreate.mock.calls[0] as [
      { response_format: { json_schema: { name: string } } },
    ];
    expect(request.response_format.json_schema.name).toBe('decision_judgment');
  });

  it("holds the model to the evaluation's own standard", async () => {
    judgeSays([{ question_id: 'withhold', answer: 'false' }]);

    await evaluateLog(
      c,
      evaluation({ guidance: 'Directions to public places are fine.' }),
      decisionLog(ANSWERS),
      storage,
    );

    expect(judgePrompt()).toContain('Directions to public places are fine.');
  });

  // A human's thumbs is the one reference that is not a model's: the judge
  // sees what was judged, and the verdict.
  it("shows the judge the model's answers under a human's verdict", async () => {
    judgeSays([{ question_id: 'withhold', answer: 'false' }]);

    await evaluateLog(c, evaluation(), decisionLog(ANSWERS), storage, {
      humanVerdict: 'bad',
      humanVerdictReason: 'It is a fire drill.',
    });

    const prompt = judgePrompt();
    expect(prompt).toContain('- withhold: P(yes) = 0.90');
    expect(prompt).toContain('verified it as a BAD output');
    expect(prompt).toContain('It is a fire drill.');
  });

  it('names images it cannot show the judge', async () => {
    judgeSays([{ question_id: 'withhold', answer: 'unknown' }]);

    await evaluateLog(
      c,
      evaluation(),
      decisionLog(ANSWERS, {
        'door-cam': { format: 'jpg', data_base64: '/9j/secret' },
      }),
      storage,
    );

    const prompt = judgePrompt();
    expect(prompt).toContain('door-cam');
    expect(prompt).not.toContain('/9j/secret');
  });

  it('scores only the questions the judge could settle', async () => {
    judgeSays([
      { question_id: 'withhold', answer: 'unknown' },
      { question_id: 'topic', answer: 'entry' },
    ]);

    const result = await evaluateLog(
      c,
      evaluation(),
      decisionLog(ANSWERS),
      storage,
    );

    expect(result.score).toBeCloseTo(0.96);
    expect(result.display_info[0].content).toContain('not scored');
  });

  // A result left out would count as a zero against the arm that served it.
  describe('scores a neutral half when it cannot judge', () => {
    it('when the judge could settle nothing', async () => {
      judgeSays([
        { question_id: 'withhold', answer: 'unknown' },
        { question_id: 'topic', answer: 'unknown' },
      ]);

      const result = await evaluateLog(
        c,
        evaluation(),
        decisionLog(ANSWERS),
        storage,
      );

      expect(result.score).toBe(0.5);
      expect(result.extra_data.fallback).toBe(true);
    });

    it('when the judge cannot be asked', async () => {
      mockCreate.mockRejectedValue(new Error('Bad request'));

      const result = await evaluateLog(
        c,
        evaluation(),
        decisionLog(ANSWERS),
        storage,
      );

      expect(result.score).toBe(0.5);
      expect(result.extra_data.fallback).toBe(true);
      expect(result.judge_model_name).toBe('judge-model');
    });

    it('when the log has no answers to judge', async () => {
      const result = await evaluateLog(
        c,
        evaluation(),
        decisionLog(null),
        storage,
      );

      expect(result.score).toBe(0.5);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('when the log is not a System One request', async () => {
      const chat = {
        ...decisionLog(ANSWERS),
        request_body: { messages: [{ role: 'user', content: 'hi' }] },
      } as unknown as CompletedLog;

      const result = await evaluateLog(c, evaluation(), chat, storage);

      expect(result.score).toBe(0.5);
      expect(mockCreate).not.toHaveBeenCalled();
    });
  });
});
