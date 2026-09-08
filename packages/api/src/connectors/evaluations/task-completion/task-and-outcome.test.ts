import { extractTaskAndOutcome } from '@api/connectors/evaluations/task-completion/service/task-and-outcome';
import { createMockContext } from '@api/test-utils/mock-context';
import type { UserDataStorageConnector } from '@api/types/connector';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The extraction call reaches the judge model over the raw OpenAI client,
 * and a self-hosted judge ignores `response_format` often enough that its
 * answer arrives with a trailing comma or prose around the object. The
 * SDK's strict `.parse()` failed the whole task-completion evaluation on
 * that; the reply is now parsed tolerantly, like the judge's own answers.
 */

vi.mock('@api/constants', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@api/constants')>();
  return {
    ...actual,
    getApiUrl: () => 'http://localhost:8787',
  };
});

const mockCreate = vi.fn();
const mockWithOptions = vi.fn().mockReturnValue({
  chat: { completions: { create: mockCreate, parse: mockCreate } },
});

vi.mock('openai', () => ({
  default: vi.fn(
    class {
      chat = { completions: { create: mockCreate, parse: mockCreate } };
      withOptions = mockWithOptions;
    },
  ),
}));

vi.mock('@api/utils/evaluation-model-resolver', () => ({
  agentOfSkill: vi.fn().mockResolvedValue(null),
  resolveJudgeModelConfig: vi.fn().mockResolvedValue({
    model: 'judge-model',
    provider: 'ollama',
    customHost: 'http://localhost:11434/v1',
    maxTokens: 4_000,
  }),
}));

const judgeAnswers = (content: string) => {
  mockCreate.mockResolvedValueOnce({
    choices: [{ message: { content } }],
  });
};

const run = () =>
  extractTaskAndOutcome(
    createMockContext(),
    {
      task: '',
      threshold: 0.5,
      include_reason: true,
      strict_mode: false,
      async_mode: false,
      verbose_mode: false,
      temperature: 0.1,
      batch_size: 1,
    },
    'User: review the code changes',
    'Code changes review',
    {} as UserDataStorageConnector,
  );

describe('extractTaskAndOutcome', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('extracts from clean JSON, scoping the outcome to the latest response', async () => {
    judgeAnswers(
      JSON.stringify({ task: 'produce a title', outcome: 'a title' }),
    );

    await expect(run()).resolves.toEqual({
      task: 'produce a title',
      outcome: 'a title',
    });

    // Earlier turns are each scored by their own request: the extractor is
    // told the conversation is context and the outcome is this turn's --
    // an outcome narrating the whole conversation re-scores those turns
    // and credits this turn's arm for work it did not do.
    const call = mockCreate.mock.calls[0][0];
    expect(call.messages[0].content).toContain(
      "OUTCOME of the assistant's LATEST RESPONSE",
    );
    expect(call.messages[1].content).toContain(
      'CONVERSATION (context only -- earlier turns are evaluated separately):',
    );
    expect(call.messages[1].content).toContain(
      "THE ASSISTANT'S LATEST RESPONSE (extract the outcome of this):",
    );
  });

  it('tolerates a trailing comma and prose around the object', async () => {
    judgeAnswers(
      'Here is the extraction:\n{"task": "produce a title", "outcome": "a title",}\nHope that helps!',
    );

    await expect(run()).resolves.toEqual({
      task: 'produce a title',
      outcome: 'a title',
    });
  });

  it('rejects an answer missing the outcome', async () => {
    judgeAnswers(JSON.stringify({ task: 'produce a title' }));

    await expect(run()).rejects.toThrow(
      'the response does not match the schema',
    );
  });
});
