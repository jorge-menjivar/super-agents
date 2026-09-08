import { createMockContext } from '@api/test-utils/mock-context';
import type { UserDataStorageConnector } from '@api/types/connector';
import {
  resolveEmbeddingModelConfig,
  resolveEvaluationModelConfig,
  resolveJudgeModelConfig,
  resolveRoleModel,
  resolveSystemSettingsModel,
} from '@api/utils/evaluation-model-resolver';
import { ReasoningEffort } from '@shared/types/api/routes/shared/thinking';
import type {
  Agent,
  Model,
  SkillOptimizationEvaluation,
} from '@shared/types/data';
import { AgentOptions } from '@shared/types/data/agent';
import { SystemSettingsOptions } from '@shared/types/data/system-settings';
import { EvaluationMethodName } from '@shared/types/evaluations';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockContext = createMockContext();

// Mock console.warn to suppress warning messages in tests
vi.spyOn(console, 'warn').mockImplementation(() => {
  // Intentionally empty - suppressing console warnings in tests
});

describe('Evaluation Model Resolver', () => {
  const mockConnector = {
    getSystemSettings: vi.fn(),
    getModels: vi.fn(),
    getAIProviderAPIKeys: vi.fn(),
    // Every role resolves through the agent it is being asked for; these
    // answer "no agent", which is the system's own settings.
    getSkills: vi.fn().mockResolvedValue([]),
    getAgents: vi.fn().mockResolvedValue([]),
  } as unknown as UserDataStorageConnector;

  const mockModel: Model = {
    id: 'model-1111-2222-3333-444455556666',
    ai_provider_id: 'provider-1111-2222-3333-444455556666',
    model_name: 'gpt-4',
    model_type: 'text',
    embedding_dimensions: null,
    created_at: '2023-01-01T00:00:00Z',
    updated_at: '2023-01-01T00:00:00Z',
  };

  const mockEmbedModel: Model = {
    id: 'embed-1111-2222-3333-444455556666',
    ai_provider_id: 'provider-1111-2222-3333-444455556666',
    model_name: 'text-embedding-3-small',
    model_type: 'embed',
    embedding_dimensions: 1536,
    created_at: '2023-01-01T00:00:00Z',
    updated_at: '2023-01-01T00:00:00Z',
  };

  const mockProvider = {
    id: 'provider-1111-2222-3333-444455556666',
    ai_provider: 'openai',
    name: 'OpenAI',
    api_key: 'sk-test-api-key',
    custom_fields: {},
    created_at: '2023-01-01T00:00:00Z',
    updated_at: '2023-01-01T00:00:00Z',
  };

  const mockSystemSettings = {
    id: 'settings-1111-2222-3333-444455556666',
    judge_model_id: 'model-1111-2222-3333-444455556666',
    embedding_model_id: 'embed-1111-2222-3333-444455556666',
    system_prompt_reflection_model_id: 'model-1111-2222-3333-444455556666',
    evaluation_generation_model_id: 'model-1111-2222-3333-444455556666',
    skill_arbiter_model_id: null,
    intent_compaction_model_id: null,
    options: SystemSettingsOptions.parse({
      intent_compaction: { timeout_ms: 15_000 },
    }),
    created_at: '2023-01-01T00:00:00Z',
    updated_at: '2023-01-01T00:00:00Z',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('resolveSystemSettingsModel', () => {
    it('should resolve judge model from system settings', async () => {
      vi.mocked(mockConnector.getSystemSettings).mockResolvedValue(
        mockSystemSettings,
      );
      vi.mocked(mockConnector.getModels).mockResolvedValue([mockModel]);
      vi.mocked(mockConnector.getAIProviderAPIKeys).mockResolvedValue([
        mockProvider,
      ]);

      const result = await resolveSystemSettingsModel(
        mockContext,
        'judge',
        mockConnector,
      );

      expect(result).toEqual({
        model: 'gpt-4',
        provider: 'openai',
        apiKey: 'sk-test-api-key',
        timeoutMs: 60_000,
        reasoningEffort: null,
      });
      expect(mockConnector.getSystemSettings).toHaveBeenCalled();
      expect(mockConnector.getModels).toHaveBeenCalledWith(mockContext, {
        id: mockSystemSettings.judge_model_id,
      });
    });

    it('should resolve embedding model from system settings', async () => {
      vi.mocked(mockConnector.getSystemSettings).mockResolvedValue(
        mockSystemSettings,
      );
      vi.mocked(mockConnector.getModels).mockResolvedValue([mockEmbedModel]);
      vi.mocked(mockConnector.getAIProviderAPIKeys).mockResolvedValue([
        mockProvider,
      ]);

      const result = await resolveSystemSettingsModel(
        mockContext,
        'embedding',
        mockConnector,
      );

      expect(result).toEqual({
        model: 'text-embedding-3-small',
        provider: 'openai',
        apiKey: 'sk-test-api-key',
        timeoutMs: 30_000,
        reasoningEffort: null,
      });
      expect(mockConnector.getModels).toHaveBeenCalledWith(mockContext, {
        id: mockSystemSettings.embedding_model_id,
      });
    });

    it('should resolve system_prompt_reflection model from system settings', async () => {
      vi.mocked(mockConnector.getSystemSettings).mockResolvedValue(
        mockSystemSettings,
      );
      vi.mocked(mockConnector.getModels).mockResolvedValue([mockModel]);
      vi.mocked(mockConnector.getAIProviderAPIKeys).mockResolvedValue([
        mockProvider,
      ]);

      const result = await resolveSystemSettingsModel(
        mockContext,
        'system_prompt_reflection',
        mockConnector,
      );

      expect(result).toEqual({
        model: 'gpt-4',
        provider: 'openai',
        apiKey: 'sk-test-api-key',
        timeoutMs: 120_000,
        reasoningEffort: null,
      });
      expect(mockConnector.getModels).toHaveBeenCalledWith(mockContext, {
        id: mockSystemSettings.system_prompt_reflection_model_id,
      });
    });

    it('should resolve evaluation_generation model from system settings', async () => {
      vi.mocked(mockConnector.getSystemSettings).mockResolvedValue(
        mockSystemSettings,
      );
      vi.mocked(mockConnector.getModels).mockResolvedValue([mockModel]);
      vi.mocked(mockConnector.getAIProviderAPIKeys).mockResolvedValue([
        mockProvider,
      ]);

      const result = await resolveSystemSettingsModel(
        mockContext,
        'evaluation_generation',
        mockConnector,
      );

      expect(result).toEqual({
        model: 'gpt-4',
        provider: 'openai',
        apiKey: 'sk-test-api-key',
        timeoutMs: 120_000,
        reasoningEffort: null,
      });
      expect(mockConnector.getModels).toHaveBeenCalledWith(mockContext, {
        id: mockSystemSettings.evaluation_generation_model_id,
      });
    });

    it('should return null when model_id is not configured in system settings', async () => {
      const settingsWithNoJudge = {
        ...mockSystemSettings,
        judge_model_id: null,
      };
      vi.mocked(mockConnector.getSystemSettings).mockResolvedValue(
        settingsWithNoJudge,
      );

      const result = await resolveSystemSettingsModel(
        mockContext,
        'judge',
        mockConnector,
      );

      expect(result).toBeNull();
      expect(mockConnector.getModels).not.toHaveBeenCalled();
    });

    it('should return null when model is not found', async () => {
      vi.mocked(mockConnector.getSystemSettings).mockResolvedValue(
        mockSystemSettings,
      );
      vi.mocked(mockConnector.getModels).mockResolvedValue([]);

      const result = await resolveSystemSettingsModel(
        mockContext,
        'judge',
        mockConnector,
      );

      expect(result).toBeNull();
    });

    it('should return null when provider is not found', async () => {
      vi.mocked(mockConnector.getSystemSettings).mockResolvedValue(
        mockSystemSettings,
      );
      vi.mocked(mockConnector.getModels).mockResolvedValue([mockModel]);
      vi.mocked(mockConnector.getAIProviderAPIKeys).mockResolvedValue([]);

      const result = await resolveSystemSettingsModel(
        mockContext,
        'judge',
        mockConnector,
      );

      expect(result).toBeNull();
    });

    it('should return null when provider has no API key', async () => {
      vi.mocked(mockConnector.getSystemSettings).mockResolvedValue(
        mockSystemSettings,
      );
      vi.mocked(mockConnector.getModels).mockResolvedValue([mockModel]);
      vi.mocked(mockConnector.getAIProviderAPIKeys).mockResolvedValue([
        { ...mockProvider, api_key: null },
      ]);

      const result = await resolveSystemSettingsModel(
        mockContext,
        'judge',
        mockConnector,
      );

      expect(result).toBeNull();
    });

    it('should resolve a keyless provider that needs no API key', async () => {
      vi.mocked(mockConnector.getSystemSettings).mockResolvedValue(
        mockSystemSettings,
      );
      vi.mocked(mockConnector.getModels).mockResolvedValue([
        { ...mockModel, model_name: 'qwen3.8b27b' },
      ]);
      vi.mocked(mockConnector.getAIProviderAPIKeys).mockResolvedValue([
        {
          ...mockProvider,
          ai_provider: 'ollama',
          name: 'Ollama',
          api_key: null,
          custom_fields: { custom_host: 'http://localhost:11434' },
        },
      ]);

      const result = await resolveSystemSettingsModel(
        mockContext,
        'evaluation_generation',
        mockConnector,
      );

      expect(result).toEqual({
        model: 'qwen3.8b27b',
        provider: 'ollama',
        apiKey: undefined,
        customHost: 'http://localhost:11434',
        timeoutMs: 120_000,
        reasoningEffort: null,
      });
    });

    it('resolves intent compaction to its own model when one is chosen, and the reflection model otherwise', async () => {
      vi.mocked(mockConnector.getModels).mockResolvedValue([mockModel]);
      vi.mocked(mockConnector.getAIProviderAPIKeys).mockResolvedValue([
        mockProvider,
      ]);

      // Unset, it borrows the reflection model, as it always did.
      await resolveSystemSettingsModel(
        mockContext,
        'intent_compaction',
        mockConnector,
      );
      expect(mockConnector.getModels).toHaveBeenCalledWith(mockContext, {
        id: mockSystemSettings.system_prompt_reflection_model_id,
      });

      const compactionModelId = 'compact-11-2222-3333-444455556666';
      vi.mocked(mockConnector.getSystemSettings).mockResolvedValue({
        ...mockSystemSettings,
        intent_compaction_model_id: compactionModelId,
      });
      vi.mocked(mockConnector.getModels).mockResolvedValue([
        { ...mockModel, id: compactionModelId, model_name: 'gpt-5-mini' },
      ]);

      const result = await resolveSystemSettingsModel(
        mockContext,
        'intent_compaction',
        mockConnector,
      );

      expect(mockConnector.getModels).toHaveBeenCalledWith(mockContext, {
        id: compactionModelId,
      });
      expect(result?.model).toBe('gpt-5-mini');
    });

    it('resolves the skill arbiter to its own model when one is chosen', async () => {
      const arbiterModelId = 'arbiter-111-2222-3333-444455556666';
      vi.mocked(mockConnector.getSystemSettings).mockResolvedValue({
        ...mockSystemSettings,
        skill_arbiter_model_id: arbiterModelId,
      });
      vi.mocked(mockConnector.getModels).mockResolvedValue([
        { ...mockModel, id: arbiterModelId, model_name: 'gpt-5-mini' },
      ]);
      vi.mocked(mockConnector.getAIProviderAPIKeys).mockResolvedValue([
        mockProvider,
      ]);

      const result = await resolveSystemSettingsModel(
        mockContext,
        'skill_arbiter',
        mockConnector,
      );

      expect(mockConnector.getModels).toHaveBeenCalledWith(mockContext, {
        id: arbiterModelId,
      });
      expect(result?.model).toBe('gpt-5-mini');
    });

    it('falls back to the reflection model for the skill arbiter when none is chosen', async () => {
      vi.mocked(mockConnector.getSystemSettings).mockResolvedValue(
        mockSystemSettings,
      );
      vi.mocked(mockConnector.getModels).mockResolvedValue([mockModel]);
      vi.mocked(mockConnector.getAIProviderAPIKeys).mockResolvedValue([
        mockProvider,
      ]);

      const result = await resolveSystemSettingsModel(
        mockContext,
        'skill_arbiter',
        mockConnector,
      );

      expect(mockConnector.getModels).toHaveBeenCalledWith(mockContext, {
        id: mockSystemSettings.system_prompt_reflection_model_id,
      });
      expect(result?.model).toBe('gpt-4');
    });

    it('reads the settings it is handed instead of storage', async () => {
      vi.mocked(mockConnector.getModels).mockResolvedValue([mockModel]);
      vi.mocked(mockConnector.getAIProviderAPIKeys).mockResolvedValue([
        mockProvider,
      ]);

      const result = await resolveSystemSettingsModel(
        mockContext,
        'judge',
        mockConnector,
        mockSystemSettings,
      );

      expect(mockConnector.getSystemSettings).not.toHaveBeenCalled();
      expect(result?.model).toBe('gpt-4');
    });
  });

  describe('resolveRoleModel, as an agent has it', () => {
    /** An agent that answers for the judge and inherits everything else. */
    const opinionated = {
      id: 'agent-1',
      name: 'helper',
      judge_model_id: 'agent-judge-model',
      system_prompt_reflection_model_id: null,
      evaluation_generation_model_id: null,
      embedding_model_id: null,
      skill_arbiter_model_id: null,
      intent_compaction_model_id: null,
      options: AgentOptions.parse({
        judge: { timeout_ms: 5_000, reasoning_effort: ReasoningEffort.NONE },
      }),
    } as Agent;

    beforeEach(() => {
      vi.mocked(mockConnector.getSystemSettings).mockResolvedValue(
        mockSystemSettings,
      );
      vi.mocked(mockConnector.getModels).mockResolvedValue([mockModel]);
      vi.mocked(mockConnector.getAIProviderAPIKeys).mockResolvedValue([
        mockProvider,
      ]);
    });

    it('asks for the model the agent named, on the terms it named', async () => {
      const result = await resolveRoleModel(
        mockContext,
        'judge',
        mockConnector,
        opinionated,
      );

      expect(mockConnector.getModels).toHaveBeenCalledWith(mockContext, {
        id: 'agent-judge-model',
      });
      expect(result).toMatchObject({
        timeoutMs: 5_000,
        reasoningEffort: ReasoningEffort.NONE,
      });
    });

    it('falls through to the system for every role it left alone', async () => {
      const result = await resolveRoleModel(
        mockContext,
        'system_prompt_reflection',
        mockConnector,
        opinionated,
      );

      expect(mockConnector.getModels).toHaveBeenCalledWith(mockContext, {
        id: mockSystemSettings.system_prompt_reflection_model_id,
      });
      // The role's own settings, untouched by the agent's opinion of the judge.
      expect(result).toMatchObject({
        timeoutMs: mockSystemSettings.options.system_prompt_reflection
          .timeout_ms as number,
      });
    });

    it('answers as the system does when there is no agent at all', async () => {
      const withAgent = await resolveRoleModel(
        mockContext,
        'judge',
        mockConnector,
        null,
      );

      expect(withAgent).toEqual(
        await resolveSystemSettingsModel(mockContext, 'judge', mockConnector),
      );
    });

    it("takes the agent's timeout even for the system's model", async () => {
      // The two are resolved separately, so an agent can be impatient with a
      // model it never chose.
      const impatient = {
        ...opinionated,
        judge_model_id: null,
        options: AgentOptions.parse({ judge: { timeout_ms: 2_000 } }),
      } as Agent;

      const result = await resolveRoleModel(
        mockContext,
        'judge',
        mockConnector,
        impatient,
      );

      expect(mockConnector.getModels).toHaveBeenCalledWith(mockContext, {
        id: mockSystemSettings.judge_model_id,
      });
      expect(result).toMatchObject({ timeoutMs: 2_000 });
    });
  });

  describe('resolveEvaluationModelConfig', () => {
    const mockEvaluation: SkillOptimizationEvaluation = {
      id: 'eval-1111-2222-3333-444455556666',
      agent_id: 'agent-1111-2222-3333-444455556666',
      skill_id: 'skill-1111-2222-3333-444455556666',
      evaluation_method: EvaluationMethodName.TASK_COMPLETION,
      weight: 1.0,
      params: {},
      model_id: null,
      created_at: '2023-01-01T00:00:00Z',
      updated_at: '2023-01-01T00:00:00Z',
    };

    it('should use evaluation-specific model_id when set', async () => {
      const evalWithModel: SkillOptimizationEvaluation = {
        ...mockEvaluation,
        model_id: 'custom-model-1111-2222-333344445555',
      };
      const customModel = {
        ...mockModel,
        id: 'custom-model-1111-2222-333344445555',
        model_name: 'custom-model',
      };

      vi.mocked(mockConnector.getModels).mockResolvedValue([customModel]);
      vi.mocked(mockConnector.getAIProviderAPIKeys).mockResolvedValue([
        mockProvider,
      ]);

      const result = await resolveEvaluationModelConfig(
        mockContext,
        evalWithModel,
        mockConnector,
      );

      expect(result).toEqual({
        model: 'custom-model',
        provider: 'openai',
        apiKey: 'sk-test-api-key',
        timeoutMs: 60_000,
        maxTokens: 4_000,
        reasoningEffort: null,
      });
      expect(mockConnector.getModels).toHaveBeenCalledWith(mockContext, {
        id: 'custom-model-1111-2222-333344445555',
      });
      // The model comes from the evaluation, but a model named there has no
      // timeout or budget of its own, so the judge's are still read for it.
      expect(mockConnector.getSystemSettings).toHaveBeenCalled();
    });

    it('should fall back to system settings judge_model_id when evaluation has no model_id', async () => {
      vi.mocked(mockConnector.getSystemSettings).mockResolvedValue(
        mockSystemSettings,
      );
      vi.mocked(mockConnector.getModels).mockResolvedValue([mockModel]);
      vi.mocked(mockConnector.getAIProviderAPIKeys).mockResolvedValue([
        mockProvider,
      ]);

      const result = await resolveEvaluationModelConfig(
        mockContext,
        mockEvaluation,
        mockConnector,
      );

      expect(result).toEqual({
        model: 'gpt-4',
        provider: 'openai',
        apiKey: 'sk-test-api-key',
        timeoutMs: 60_000,
        maxTokens: 4_000,
        reasoningEffort: null,
      });
      expect(mockConnector.getSystemSettings).toHaveBeenCalled();
    });

    it('should return null when evaluation model is not found', async () => {
      const evalWithModel: SkillOptimizationEvaluation = {
        ...mockEvaluation,
        model_id: 'nonexistent-model-1111-222233334444',
      };

      vi.mocked(mockConnector.getModels).mockResolvedValue([]);

      const result = await resolveEvaluationModelConfig(
        mockContext,
        evalWithModel,
        mockConnector,
      );

      expect(result).toBeNull();
    });

    it('should return null when system settings fallback has no judge model', async () => {
      vi.mocked(mockConnector.getSystemSettings).mockResolvedValue({
        ...mockSystemSettings,
        judge_model_id: null,
      });

      const result = await resolveEvaluationModelConfig(
        mockContext,
        mockEvaluation,
        mockConnector,
      );

      expect(result).toBeNull();
    });
  });

  describe('reasoning effort', () => {
    beforeEach(() => {
      vi.mocked(mockConnector.getModels).mockResolvedValue([mockModel]);
      vi.mocked(mockConnector.getAIProviderAPIKeys).mockResolvedValue([
        mockProvider,
      ]);
    });

    it('carries each text role’s own effort, not one shared value', async () => {
      // The roles ask for different work, so they are set independently and
      // a caller must get the one belonging to the role it resolved.
      vi.mocked(mockConnector.getSystemSettings).mockResolvedValue({
        ...mockSystemSettings,
        options: SystemSettingsOptions.parse({
          judge: { reasoning_effort: ReasoningEffort.NONE },
          system_prompt_reflection: { reasoning_effort: ReasoningEffort.HIGH },
          skill_arbiter: { reasoning_effort: ReasoningEffort.LOW },
        }),
      });

      for (const [role, expected] of [
        ['judge', 'none'],
        ['system_prompt_reflection', 'high'],
        ['skill_arbiter', 'low'],
        // Never set, so the model is left at its own default.
        ['intent_compaction', null],
      ] as const) {
        const resolved = await resolveSystemSettingsModel(
          mockContext,
          role,
          mockConnector,
        );
        expect(resolved?.reasoningEffort).toBe(expected);
      }
    });

    it('resolves the embedding model without one', async () => {
      vi.mocked(mockConnector.getSystemSettings).mockResolvedValue({
        ...mockSystemSettings,
        options: SystemSettingsOptions.parse({
          judge: { reasoning_effort: ReasoningEffort.HIGH },
        }),
      });
      vi.mocked(mockConnector.getModels).mockResolvedValue([mockEmbedModel]);

      const resolved = await resolveSystemSettingsModel(
        mockContext,
        'embedding',
        mockConnector,
      );

      // An embedding has nothing to think about; the judge's setting is not
      // borrowed for it.
      expect(resolved?.reasoningEffort).toBeNull();
    });
  });

  describe('resolveJudgeModelConfig', () => {
    it('resolves the judge with its timeout, budget and effort', async () => {
      vi.mocked(mockConnector.getSystemSettings).mockResolvedValue({
        ...mockSystemSettings,
        options: {
          ...mockSystemSettings.options,
          judge: {
            timeout_ms: 90_000,
            max_tokens: 16_000,
            reasoning_effort: ReasoningEffort.LOW,
          },
        },
      });
      vi.mocked(mockConnector.getModels).mockResolvedValue([mockModel]);
      vi.mocked(mockConnector.getAIProviderAPIKeys).mockResolvedValue([
        mockProvider,
      ]);

      const result = await resolveJudgeModelConfig(mockContext, mockConnector);

      expect(result).toEqual({
        model: 'gpt-4',
        provider: 'openai',
        apiKey: 'sk-test-api-key',
        timeoutMs: 90_000,
        maxTokens: 16_000,
        reasoningEffort: 'low',
      });
    });

    it('returns null when no judge model is configured', async () => {
      vi.mocked(mockConnector.getSystemSettings).mockResolvedValue({
        ...mockSystemSettings,
        judge_model_id: null,
      });

      expect(
        await resolveJudgeModelConfig(mockContext, mockConnector),
      ).toBeNull();
    });
  });

  describe('resolveEmbeddingModelConfig', () => {
    it('should resolve embedding model with dimensions', async () => {
      vi.mocked(mockConnector.getSystemSettings).mockResolvedValue(
        mockSystemSettings,
      );
      vi.mocked(mockConnector.getModels).mockResolvedValue([mockEmbedModel]);

      const result = await resolveEmbeddingModelConfig(
        mockContext,
        mockConnector,
      );

      expect(result).toEqual({
        modelId: 'embed-1111-2222-3333-444455556666',
        model: mockEmbedModel,
        dimensions: 1536,
        timeoutMs: 30_000,
      });
    });

    it('should return null when embedding_model_id is not configured', async () => {
      vi.mocked(mockConnector.getSystemSettings).mockResolvedValue({
        ...mockSystemSettings,
        embedding_model_id: null,
      });

      const result = await resolveEmbeddingModelConfig(
        mockContext,
        mockConnector,
      );

      expect(result).toBeNull();
      expect(mockConnector.getModels).not.toHaveBeenCalled();
    });

    it('should return null when embedding model is not found', async () => {
      vi.mocked(mockConnector.getSystemSettings).mockResolvedValue(
        mockSystemSettings,
      );
      vi.mocked(mockConnector.getModels).mockResolvedValue([]);

      const result = await resolveEmbeddingModelConfig(
        mockContext,
        mockConnector,
      );

      expect(result).toBeNull();
    });

    it('should return null when embedding model has no dimensions', async () => {
      const modelWithoutDimensions = {
        ...mockEmbedModel,
        embedding_dimensions: null,
      };
      vi.mocked(mockConnector.getSystemSettings).mockResolvedValue(
        mockSystemSettings,
      );
      vi.mocked(mockConnector.getModels).mockResolvedValue([
        modelWithoutDimensions,
      ]);

      const result = await resolveEmbeddingModelConfig(
        mockContext,
        mockConnector,
      );

      expect(result).toBeNull();
    });

    it('should handle different embedding dimensions correctly', async () => {
      const model3072 = {
        ...mockEmbedModel,
        id: 'embed-3072-1111-2222-333344445555',
        model_name: 'text-embedding-3-large',
        embedding_dimensions: 3072,
      };
      vi.mocked(mockConnector.getSystemSettings).mockResolvedValue({
        ...mockSystemSettings,
        embedding_model_id: 'embed-3072-1111-2222-333344445555',
      });
      vi.mocked(mockConnector.getModels).mockResolvedValue([model3072]);

      const result = await resolveEmbeddingModelConfig(
        mockContext,
        mockConnector,
      );

      expect(result?.dimensions).toBe(3072);
      expect(result?.model.model_name).toBe('text-embedding-3-large');
    });
  });

  describe('Error Handling', () => {
    it('should handle database errors gracefully for system settings', async () => {
      vi.mocked(mockConnector.getSystemSettings).mockRejectedValue(
        new Error('Database error'),
      );

      await expect(
        resolveSystemSettingsModel(mockContext, 'judge', mockConnector),
      ).rejects.toThrow('Database error');
    });

    it('should handle database errors gracefully for model lookup', async () => {
      vi.mocked(mockConnector.getSystemSettings).mockResolvedValue(
        mockSystemSettings,
      );
      vi.mocked(mockConnector.getModels).mockRejectedValue(
        new Error('Model lookup failed'),
      );

      await expect(
        resolveSystemSettingsModel(mockContext, 'judge', mockConnector),
      ).rejects.toThrow('Model lookup failed');
    });

    it('should handle database errors gracefully for provider lookup', async () => {
      vi.mocked(mockConnector.getSystemSettings).mockResolvedValue(
        mockSystemSettings,
      );
      vi.mocked(mockConnector.getModels).mockResolvedValue([mockModel]);
      vi.mocked(mockConnector.getAIProviderAPIKeys).mockRejectedValue(
        new Error('Provider lookup failed'),
      );

      await expect(
        resolveSystemSettingsModel(mockContext, 'judge', mockConnector),
      ).rejects.toThrow('Provider lookup failed');
    });
  });
});
