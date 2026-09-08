import { createMockContext } from '@api/test-utils/mock-context';
import type { UserDataStorageConnector } from '@api/types/connector';
import { HttpMethod } from '@api/types/http';
import { FunctionName } from '@shared/types/api/request';
import { AIProvider } from '@shared/types/constants';
import type { SkillOptimizationEvaluation } from '@shared/types/data';
import type { CompletedLog } from '@shared/types/data/log';
import { CacheMode, CacheStatus } from '@shared/types/middleware/cache';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A thumbs up/down re-runs the log's evaluations with the human verdict in
 * the judges' prompts. This is the propagation test: every LLM-judge method
 * must show its judge the verdict note; a judge that never hears about the
 * verdict re-answers from the same blind spot the human just corrected.
 */

const mockParse = vi.fn();
const mockWithOptions = vi.fn().mockReturnValue({
  chat: { completions: { parse: mockParse, create: mockParse } },
});

vi.mock('openai', () => ({
  default: vi.fn(
    class {
      chat = { completions: { parse: mockParse, create: mockParse } };
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
  agentOfSkill: vi.fn().mockResolvedValue(null),
  resolveEvaluationModelConfig: vi.fn().mockResolvedValue({
    model: 'judge-model',
    provider: 'ollama',
  }),
}));

vi.mock(
  '@api/connectors/evaluations/task-completion/service/task-and-outcome',
  () => ({
    extractTaskAndOutcome: vi.fn().mockResolvedValue({
      task: 'answer the question',
      outcome: 'an answer was produced',
    }),
  }),
);

import { evaluateLog as evaluateConversationCompleteness } from '@api/connectors/evaluations/conversation-completeness/service/evaluate';
import { evaluateLog as evaluateKnowledgeRetention } from '@api/connectors/evaluations/knowledge-retention/service/evaluate';
import { evaluateLog as evaluateTaskCompletion } from '@api/connectors/evaluations/task-completion/service/evaluate';
import { evaluateLog as evaluateTurnRelevancy } from '@api/connectors/evaluations/turn-relevancy/service/evaluate';

const log: CompletedLog = {
  id: 'log-1',
  agent_id: 'agent-1',
  skill_id: 'skill-1',
  cluster_id: null,
  error: null,
  method: HttpMethod.POST,
  endpoint: '/v1/chat/completions',
  function_name: FunctionName.CHAT_COMPLETE,
  status: 200,
  start_time: 1677652288000,
  first_token_time: null,
  end_time: 1677652289000,
  duration: 1000,
  base_sa_config: {},
  ai_provider: AIProvider.OPENAI,
  model: 'gpt-4',
  hook_logs: [],
  cache_status: CacheStatus.MISS,
  embedding: null,
  trace_id: null,
  parent_span_id: null,
  span_id: null,
  span_name: null,
  app_id: null,
  external_user_id: null,
  external_user_human_name: null,
  original_system_prompt: null,
  user_metadata: null,
  metadata: {},
  ai_provider_request_log: {
    provider: AIProvider.OPENAI,
    function_name: FunctionName.CHAT_COMPLETE,
    method: HttpMethod.POST,
    request_url: 'https://api.openai.com/v1/chat/completions',
    request_body: {
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'What is the capital of France?' }],
    },
    response_body: {
      id: 'chatcmpl-1',
      object: 'chat.completion',
      created: 1677652288,
      model: 'gpt-4',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'Berlin.' },
          finish_reason: 'stop',
        },
      ],
    },
    raw_request_body: '{}',
    raw_response_body: '{}',
    status: 200,
    cache_mode: CacheMode.DISABLED,
    cache_status: CacheStatus.MISS,
  },
} as unknown as CompletedLog;

const evaluationOf = (method: string): SkillOptimizationEvaluation =>
  ({
    id: 'eval-1',
    agent_id: 'agent-1',
    skill_id: 'skill-1',
    evaluation_method: method,
    // task_completion parses its params strictly and needs the full set
    params:
      method === 'task_completion'
        ? {
            task: '',
            threshold: 0.5,
            include_reason: true,
            strict_mode: false,
            async_mode: false,
            verbose_mode: false,
            temperature: 0.1,
            batch_size: 1,
          }
        : { temperature: 0.1 },
    weight: 1,
    model_id: null,
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z',
  }) as SkillOptimizationEvaluation;

const storage = {} as UserDataStorageConnector;

const judges = [
  ['conversation_completeness', evaluateConversationCompleteness],
  ['knowledge_retention', evaluateKnowledgeRetention],
  ['turn_relevancy', evaluateTurnRelevancy],
  ['task_completion', evaluateTaskCompletion],
] as const;

beforeEach(() => {
  vi.clearAllMocks();
  mockParse.mockResolvedValue({
    choices: [
      {
        message: {
          content: JSON.stringify({ score: 0.1, reasoning: 'clearly wrong' }),
        },
      },
    ],
  });
});

describe.each(judges)('%s with a human verdict', (method, evaluateLog) => {
  it('shows the judge the bad verdict', async () => {
    await evaluateLog(createMockContext(), evaluationOf(method), log, storage, {
      humanVerdict: 'bad',
    });

    const judgeSaw = JSON.stringify(mockParse.mock.calls);
    expect(judgeSaw).toContain('manually reviewed this exact response');
    expect(judgeSaw).toContain('BAD output');
  });

  it('shows the judge the good verdict', async () => {
    await evaluateLog(createMockContext(), evaluationOf(method), log, storage, {
      humanVerdict: 'good',
    });

    expect(JSON.stringify(mockParse.mock.calls)).toContain('GOOD output');
  });

  it('says nothing about a verdict on an ordinary run', async () => {
    await evaluateLog(createMockContext(), evaluationOf(method), log, storage);

    expect(JSON.stringify(mockParse.mock.calls)).not.toContain(
      'manually reviewed',
    );
  });
});
