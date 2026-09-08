import type { UserDataStorageConnector } from '@api/types/connector';
import { SystemSettingsOptions } from '@shared/types/data/system-settings';
import { vi } from 'vitest';

/**
 * Creates a mock storage connector for testing evaluations.
 * Returns a connector that provides a default model configuration.
 */
export function createMockStorageConnector(): UserDataStorageConnector {
  return {
    // Required methods for evaluation model resolution
    getSystemSettings: vi.fn().mockResolvedValue({
      id: 'settings-1',
      judge_model_id: 'model-123',
      reflection_model_id: 'model-123',
      evaluation_generation_model_id: 'model-123',
      embedding_model_id: 'embed-123',
      skill_arbiter_model_id: null,
      intent_compaction_model_id: null,
      options: SystemSettingsOptions.parse({
        intent_compaction: { timeout_ms: 15_000 },
      }),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }),
    getModels: vi.fn().mockResolvedValue([
      {
        id: 'model-123',
        ai_provider_id: 'provider-123',
        model_name: 'gpt-4o-mini',
        model_type: 'text',
        embedding_dimensions: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ]),
    getAIProviderAPIKeys: vi.fn().mockResolvedValue([
      {
        id: 'provider-123',
        ai_provider: 'openai',
        api_key: 'test-api-key',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ]),
    // Stub other methods (not used in evaluation tests)
    // Judging resolves the agent whose answer is being scored; an empty
    // list is "no agent", which leaves the call on the system settings.
    getAgents: vi.fn().mockResolvedValue([]),
    getAgentById: vi.fn(),
    createAgent: vi.fn(),
    updateAgent: vi.fn(),
    deleteAgent: vi.fn(),
    getSkills: vi.fn().mockResolvedValue([]),
    getSkillById: vi.fn(),
    createSkill: vi.fn(),
    updateSkill: vi.fn(),
    deleteSkill: vi.fn(),
    getSkillOptimizationClusters: vi.fn(),
    createSkillOptimizationClusters: vi.fn(),
    updateSkillOptimizationCluster: vi.fn(),
    deleteSkillOptimizationClusters: vi.fn(),
    getSkillOptimizationArms: vi.fn(),
    createSkillOptimizationArms: vi.fn(),
    updateSkillOptimizationArm: vi.fn(),
    deleteSkillOptimizationArms: vi.fn(),
    getSkillOptimizationEvaluations: vi.fn(),
    createSkillOptimizationEvaluation: vi.fn(),
    updateSkillOptimizationEvaluation: vi.fn(),
    deleteSkillOptimizationEvaluation: vi.fn(),
    createModel: vi.fn(),
    updateModel: vi.fn(),
    deleteModel: vi.fn(),
    getSkillModels: vi.fn(),
    addSkillModel: vi.fn(),
    removeSkillModel: vi.fn(),
    createAIProviderAPIKey: vi.fn(),
    getAIProviderAPIKeyById: vi.fn(),
    updateAIProviderAPIKey: vi.fn(),
    deleteAIProviderAPIKey: vi.fn(),
    updateSystemSettings: vi.fn(),
  } as unknown as UserDataStorageConnector;
}
