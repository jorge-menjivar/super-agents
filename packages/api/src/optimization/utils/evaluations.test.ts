import { DecisionCorrectnessEvaluationParameters } from '@api/connectors/evaluations/decision-correctness/types';
import { ToolCorrectnessEvaluationParameters } from '@api/connectors/evaluations/tool-correctness/types';
import {
  applyRegeneratedEvaluations,
  generateEvaluationCreateParams,
} from '@api/optimization/utils/evaluations';
import { createMockContext } from '@api/test-utils/mock-context';
import type {
  EvaluationMethodConnector,
  UserDataStorageConnector,
} from '@api/types/connector';
import { resolveRoleModel } from '@api/utils/evaluation-model-resolver';
import { ReasoningEffort } from '@shared/types/api/routes/shared/thinking';
import { AIProvider } from '@shared/types/constants';
import type { Skill } from '@shared/types/data';
import type {
  SkillOptimizationEvaluation,
  SkillOptimizationEvaluationCreateParams,
} from '@shared/types/data/skill-optimization-evaluation';
import { EvaluationMethodName } from '@shared/types/evaluations';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const mockParse = vi.fn();

vi.mock('openai', () => ({
  default: vi.fn(
    class {
      withOptions = () => ({ chat: { completions: { parse: mockParse } } });
    },
  ),
}));

vi.mock('@api/constants', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@api/constants')>()),
  getApiUrl: () => 'http://localhost:8787',
}));

vi.mock('@api/utils/evaluation-model-resolver', () => ({
  agentById: vi.fn().mockResolvedValue(null),
  resolveRoleModel: vi.fn(async () => ({
    model: 'glm-5.3-flash:cloud',
    provider: AIProvider.OLLAMA,
    apiKey: '',
    customHost: 'http://localhost:11434',
  })),
}));

const mockContext = createMockContext();

const skill = {
  id: 'skill-1',
  agent_id: 'agent-1',
  description: 'Review the code changes in my repo.',
} as Skill;

const storageConnector = {} as UserDataStorageConnector;

/** Only the two members the generator reads. */
const connectorFor = (
  method: EvaluationMethodName,
  aiParameterSchema?: z.ZodType,
): EvaluationMethodConnector =>
  ({
    getDetails: () => ({
      method,
      name: method,
      description: `the ${method} method`,
    }),
    getAIParameterSchema: aiParameterSchema,
  }) as unknown as EvaluationMethodConnector;

/** What the OpenAI SDK hands back once it has parsed the provider's content. */
const parsedAs = (value: unknown) => ({
  choices: [{ message: { parsed: value } }],
});

describe('generateEvaluationCreateParams', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('asks the model for the parameters a method actually declares', async () => {
    mockParse.mockResolvedValue(parsedAs({ task: 'Review the diff' }));

    const params = await generateEvaluationCreateParams(
      mockContext,
      skill,
      connectorFor(
        EvaluationMethodName.TASK_COMPLETION,
        z.object({
          task: z.string(),
          threshold: z.number().min(0).max(1).default(0.7),
        }),
      ),
      EvaluationMethodName.TASK_COMPLETION,
      'an agent that maintains a website',
      storageConnector,
    );

    expect(mockParse).toHaveBeenCalledTimes(1);
    // The threshold the model left out comes from the schema's default.
    expect(params.params).toEqual({ task: 'Review the diff', threshold: 0.7 });
    expect(params.evaluation_method).toBe(EvaluationMethodName.TASK_COMPLETION);
    expect(params.skill_id).toBe('skill-1');
  });

  it('opts out of the implicit prompt cache, like every internal skill call', async () => {
    mockParse.mockResolvedValue(parsedAs({ task: 'Review the diff' }));

    await generateEvaluationCreateParams(
      mockContext,
      skill,
      connectorFor(
        EvaluationMethodName.TASK_COMPLETION,
        z.object({ task: z.string() }),
      ),
      EvaluationMethodName.TASK_COMPLETION,
      'an agent that maintains a website',
      storageConnector,
    );

    expect(mockParse.mock.calls[0][0]).toMatchObject({
      prompt_cache_options: { mode: 'explicit' },
    });
  });

  it("sends the evaluation-generation role's reasoning effort", async () => {
    vi.mocked(resolveRoleModel).mockResolvedValueOnce({
      model: 'glm-5.3-flash:cloud',
      provider: AIProvider.OLLAMA,
      apiKey: '',
      customHost: 'http://localhost:11434',
      reasoningEffort: ReasoningEffort.LOW,
    });
    mockParse.mockResolvedValue(parsedAs({ task: 'Review the diff' }));

    await generateEvaluationCreateParams(
      mockContext,
      skill,
      connectorFor(
        EvaluationMethodName.TASK_COMPLETION,
        z.object({ task: z.string() }),
      ),
      EvaluationMethodName.TASK_COMPLETION,
      'an agent that maintains a website',
      storageConnector,
    );

    expect(mockParse.mock.calls[0][0]).toMatchObject({
      reasoning_effort: 'low',
    });
  });

  it('sends none when the role leaves the model to its default', async () => {
    mockParse.mockResolvedValue(parsedAs({ task: 'Review the diff' }));

    await generateEvaluationCreateParams(
      mockContext,
      skill,
      connectorFor(
        EvaluationMethodName.TASK_COMPLETION,
        z.object({ task: z.string() }),
      ),
      EvaluationMethodName.TASK_COMPLETION,
      'an agent that maintains a website',
      storageConnector,
    );

    expect(mockParse.mock.calls[0][0]).not.toHaveProperty('reasoning_effort');
  });

  it('adds a method with no AI parameters before any model is configured', async () => {
    // Nothing for a model to fill in means nothing to ask, so the settings
    // are not even consulted: a fresh deployment, which has none configured,
    // can still add these. Left unstubbed on purpose -- what matters is that
    // the resolver is never reached.
    const params = await generateEvaluationCreateParams(
      mockContext,
      skill,
      connectorFor(EvaluationMethodName.TURN_RELEVANCY),
      EvaluationMethodName.TURN_RELEVANCY,
      'an agent that maintains a website',
      storageConnector,
    );

    expect(params.evaluation_method).toBe(EvaluationMethodName.TURN_RELEVANCY);
    expect(params.params).toEqual({});
    expect(mockParse).not.toHaveBeenCalled();
    expect(resolveRoleModel).not.toHaveBeenCalled();
  });

  it('does not call the model for a method with no AI parameters', async () => {
    /**
     * Every method but task_completion declares an empty AI schema. Asking a
     * model to fill in nothing spends a request, and a provider that does not
     * enforce the schema answers with a field the method's own parameter
     * schema then rejects at evaluation time.
     */
    const params = await generateEvaluationCreateParams(
      mockContext,
      skill,
      connectorFor(
        EvaluationMethodName.TOOL_CORRECTNESS,
        z.object({}).strict(),
      ),
      EvaluationMethodName.TOOL_CORRECTNESS,
      'an agent that maintains a website',
      storageConnector,
    );

    expect(mockParse).not.toHaveBeenCalled();
    expect(params.params).toEqual({});
  });

  it('does not call the model for a method with no AI schema at all', async () => {
    const params = await generateEvaluationCreateParams(
      mockContext,
      skill,
      connectorFor(EvaluationMethodName.LATENCY),
      EvaluationMethodName.LATENCY,
      'an agent that maintains a website',
      storageConnector,
    );

    expect(mockParse).not.toHaveBeenCalled();
    expect(params.params).toEqual({});
  });

  it('refuses parameters that do not match the schema the model was given', async () => {
    mockParse.mockResolvedValue(parsedAs({ threshold: 0.7 }));

    await expect(
      generateEvaluationCreateParams(
        mockContext,
        skill,
        connectorFor(
          EvaluationMethodName.TASK_COMPLETION,
          z.object({ task: z.string(), threshold: z.number().default(0.7) }),
        ),
        EvaluationMethodName.TASK_COMPLETION,
        'an agent that maintains a website',
        storageConnector,
      ),
    ).rejects.toThrow(/task_completion parameters the model returned/);
  });

  it('drops fields the model volunteered beyond the schema', async () => {
    mockParse.mockResolvedValue(
      parsedAs({
        task: 'Review the diff',
        reasoning: 'because I felt like it',
      }),
    );

    const params = await generateEvaluationCreateParams(
      mockContext,
      skill,
      connectorFor(
        EvaluationMethodName.TASK_COMPLETION,
        z.object({
          task: z.string(),
          threshold: z.number().default(0.7),
        }),
      ),
      EvaluationMethodName.TASK_COMPLETION,
      'an agent that maintains a website',
      storageConnector,
    );

    expect(params.params).toEqual({ task: 'Review the diff', threshold: 0.7 });
  });
});

/**
 * Regeneration replaces what a model generated and keeps the rest of an
 * evaluation's parameters, which are the user's -- but only the parameters
 * its method still has.
 */
describe('applyRegeneratedEvaluations', () => {
  const evaluation = (
    method: EvaluationMethodName,
    params: Record<string, unknown>,
  ): SkillOptimizationEvaluation =>
    ({
      id: `eval-${method}`,
      agent_id: 'agent-1',
      skill_id: 'skill-1',
      evaluation_method: method,
      params,
      weight: 3,
    }) as SkillOptimizationEvaluation;

  const regenerated = (
    method: EvaluationMethodName,
    params: Record<string, unknown>,
  ): SkillOptimizationEvaluationCreateParams => ({
    agent_id: 'agent-1',
    skill_id: 'skill-1',
    evaluation_method: method,
    params,
    weight: 1,
  });

  /** A method known only by its full parameter schema. */
  const parametersOf = (schema: z.ZodType): EvaluationMethodConnector =>
    ({ getParameterSchema: schema }) as unknown as EvaluationMethodConnector;

  const storeFor = () =>
    ({
      updateSkillOptimizationEvaluation: vi.fn().mockResolvedValue(undefined),
    }) as unknown as UserDataStorageConnector;

  /** What the evaluation was updated with. */
  const written = (store: UserDataStorageConnector) =>
    vi.mocked(store.updateSkillOptimizationEvaluation).mock.calls[0][2] as {
      params: Record<string, unknown>;
    };

  // Tool correctness's parameters are strict, and a row from before they
  // dropped `task` still had one: kept by the merge, it failed every log the
  // evaluation judged with "Unrecognized key".
  it("drops a key the method's parameters no longer have", async () => {
    const store = storeFor();

    await applyRegeneratedEvaluations(
      mockContext,
      store,
      [
        evaluation(EvaluationMethodName.TOOL_CORRECTNESS, {
          task: 'Review the diff',
          threshold: 0.7,
        }),
      ],
      [regenerated(EvaluationMethodName.TOOL_CORRECTNESS, {})],
      {
        tool_correctness: parametersOf(ToolCorrectnessEvaluationParameters),
      },
    );

    const { params } = written(store);
    expect(params).toEqual({ threshold: 0.7 });
    expect(() =>
      ToolCorrectnessEvaluationParameters.parse(params),
    ).not.toThrow();
  });

  it("keeps the user's own settings, and leaves the weight alone", async () => {
    const store = storeFor();

    await applyRegeneratedEvaluations(
      mockContext,
      store,
      [
        evaluation(EvaluationMethodName.DECISION_CORRECTNESS, {
          guidance: 'A reply that helps someone in is a yes.',
          temperature: 0.3,
          max_tokens: 8_000,
        }),
      ],
      [regenerated(EvaluationMethodName.DECISION_CORRECTNESS, {})],
      {
        decision_correctness: parametersOf(
          DecisionCorrectnessEvaluationParameters,
        ),
      },
    );

    expect(written(store)).toEqual({
      params: {
        guidance: 'A reply that helps someone in is a yes.',
        temperature: 0.3,
        max_tokens: 8_000,
      },
    });
  });

  it('keeps every key of a method it has no object schema for', async () => {
    const store = storeFor();

    await applyRegeneratedEvaluations(
      mockContext,
      store,
      [evaluation(EvaluationMethodName.LATENCY, { anything: 1 })],
      [regenerated(EvaluationMethodName.LATENCY, { max_ms: 5_000 })],
      {},
    );

    expect(written(store).params).toEqual({ anything: 1, max_ms: 5_000 });
  });
});
