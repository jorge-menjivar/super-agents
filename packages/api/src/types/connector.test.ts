import { createMockContext } from '@api/test-utils/mock-context';
import type {
  EvaluationMethodConnector,
  UserDataStorageConnector,
} from '@api/types/connector';
import type { CompletedLog } from '@shared/types/data/log';
import type { SkillOptimizationEvaluation } from '@shared/types/data/skill-optimization-evaluation';
import {
  type EvaluationMethodDetails,
  EvaluationMethodName,
} from '@shared/types/evaluations';

import { describe, expect, it, type MockedFunction, vi } from 'vitest';
import { z } from 'zod';

// Mock context and storage connector for tests
const mockContext = createMockContext();
const mockStorageConnector = {} as UserDataStorageConnector;

describe('Connector Interfaces', () => {
  describe('EvaluationMethodConnector Interface', () => {
    // Mock implementation for testing interface compliance
    const createMockEvaluationMethodConnector =
      (): EvaluationMethodConnector => ({
        getDetails: vi.fn().mockReturnValue({
          method: EvaluationMethodName.CONVERSATION_COMPLETENESS,
          name: 'Test Method',
          description: 'Test evaluation method',
        } as EvaluationMethodDetails),

        evaluateLog: vi.fn().mockResolvedValue({
          method: EvaluationMethodName.CONVERSATION_COMPLETENESS,
          score: 0.85,
          extra_data: {},
        }),

        getParameterSchema: z.object({
          threshold: z.number().min(0).max(1),
          model: z.string(),
        }),

        getAIParameterSchema: z.object({}),
      });

    // Note: The EvaluationMethodConnector.evaluateLog now takes (c, evaluation, log, storageConnector)

    it('should have all required methods', () => {
      const connector = createMockEvaluationMethodConnector();

      expect(typeof connector.getDetails).toBe('function');
      expect(typeof connector.evaluateLog).toBe('function');
      expect(connector.getParameterSchema).toBeDefined();
    });

    it('should call getDetails and return evaluation method details', () => {
      const connector = createMockEvaluationMethodConnector();
      const details = connector.getDetails();

      expect(connector.getDetails).toHaveBeenCalled();
      expect(details).toMatchObject({
        method: EvaluationMethodName.CONVERSATION_COMPLETENESS,
        name: 'Test Method',
        description: 'Test evaluation method',
      });
    });

    it('should call evaluateLog with correct parameters', async () => {
      const connector = createMockEvaluationMethodConnector();
      const evaluation: SkillOptimizationEvaluation = {
        id: 'test-evaluation-id',
        agent_id: 'test-agent',
        skill_id: 'test-skill',
        evaluation_method: EvaluationMethodName.CONVERSATION_COMPLETENESS,
        params: { threshold: 0.5 },
        weight: 1.0,
        model_id: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      const log = {
        id: 'test-log-id',
        ai_provider_request_log: {
          request_body: { input: 'test input' },
          response_body: { output: 'test output' },
        },
        metadata: { ground_truth: { text: 'expected output' } },
      } as unknown as CompletedLog;

      const result = await connector.evaluateLog(
        mockContext,
        evaluation,
        log,
        mockStorageConnector,
      );

      expect(connector.evaluateLog).toHaveBeenCalledWith(
        mockContext,
        evaluation,
        log,
        mockStorageConnector,
      );
      expect(connector.evaluateLog).toHaveBeenCalledTimes(1);
      expect(result).toHaveProperty('method');
      expect(result).toHaveProperty('score');
      expect(result).toHaveProperty('extra_data');
    });

    it('should have a valid parameter schema', () => {
      const connector = createMockEvaluationMethodConnector();
      const schema = connector.getParameterSchema;

      expect(schema).toBeInstanceOf(z.ZodObject);

      // Test schema validation
      const validParams = { threshold: 0.5, model: 'gpt-4o' };
      const invalidParams = { threshold: 1.5, model: 123 };

      expect(schema.safeParse(validParams).success).toBe(true);
      expect(schema.safeParse(invalidParams).success).toBe(false);
    });

    describe('evaluateLog method signature compliance', () => {
      it('should accept AppContext as first parameter and SkillOptimizationEvaluation as second', async () => {
        const connector = createMockEvaluationMethodConnector();
        const evaluation: SkillOptimizationEvaluation = {
          id: 'test-eval-id',
          agent_id: 'test-agent',
          skill_id: 'test-skill',
          evaluation_method: EvaluationMethodName.CONVERSATION_COMPLETENESS,
          params: {},
          weight: 1.0,
          model_id: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        const log = {} as unknown as CompletedLog;

        await connector.evaluateLog(
          mockContext,
          evaluation,
          log,
          mockStorageConnector,
        );

        expect(connector.evaluateLog).toHaveBeenCalledWith(
          mockContext,
          evaluation,
          expect.any(Object),
          mockStorageConnector,
        );

        // Verify second argument has evaluation properties
        const callArgs = (
          connector.evaluateLog as MockedFunction<typeof connector.evaluateLog>
        ).mock.calls[0];
        expect(callArgs[0]).toBe(mockContext);
        expect(callArgs[1]).toBe(evaluation);
        expect(callArgs[1]).toHaveProperty('evaluation_method');
      });

      it('should accept Log as third parameter', async () => {
        const connector = createMockEvaluationMethodConnector();
        const evaluation: SkillOptimizationEvaluation = {
          id: 'test-eval-id',
          agent_id: 'test-agent',
          skill_id: 'test-skill',
          evaluation_method: EvaluationMethodName.CONVERSATION_COMPLETENESS,
          params: {},
          weight: 1.0,
          model_id: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        const log = {
          id: 'test-log',
          ai_provider_request_log: {
            request_body: { message: 'test' },
          },
          metadata: {},
        } as unknown as CompletedLog;

        await connector.evaluateLog(
          mockContext,
          evaluation,
          log,
          mockStorageConnector,
        );

        const callArgs = (
          connector.evaluateLog as MockedFunction<typeof connector.evaluateLog>
        ).mock.calls[0];
        expect(callArgs[2]).toBe(log);
        expect(callArgs[2]).toHaveProperty('id');
        expect(callArgs[3]).toBe(mockStorageConnector);
      });

      it('should return Promise<SkillOptimizationEvaluationResult>', async () => {
        const connector = createMockEvaluationMethodConnector();
        const evaluation: SkillOptimizationEvaluation = {
          id: 'test-eval-id',
          agent_id: 'test-agent',
          skill_id: 'test-skill',
          evaluation_method: EvaluationMethodName.CONVERSATION_COMPLETENESS,
          params: {},
          weight: 1.0,
          model_id: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        const result = connector.evaluateLog(
          mockContext,
          evaluation,
          {} as unknown as CompletedLog,
          mockStorageConnector,
        );

        expect(result).toBeInstanceOf(Promise);
        const resolvedResult = await result;
        expect(resolvedResult).toHaveProperty('method');
        expect(resolvedResult).toHaveProperty('score');
        expect(resolvedResult).toHaveProperty('extra_data');
      });
    });

    describe('interface backwards compatibility', () => {
      it('should maintain existing getDetails method signature', () => {
        const connector = createMockEvaluationMethodConnector();

        const details = connector.getDetails();

        expect(details).toHaveProperty('method');
        expect(details).toHaveProperty('name');
        expect(details).toHaveProperty('description');
      });

      it('should maintain existing getParameterSchema property', () => {
        const connector = createMockEvaluationMethodConnector();

        expect(connector.getParameterSchema).toBeDefined();
        expect(connector.getParameterSchema.safeParse).toBeInstanceOf(Function);
      });
    });
  });

  describe('Interface Type Safety', () => {
    it('should enforce correct method signatures at compile time', () => {
      // This test verifies TypeScript compilation - if it compiles, types are correct
      const connector: EvaluationMethodConnector = {
        getDetails: () => ({
          method: EvaluationMethodName.CONVERSATION_COMPLETENESS,
          name: 'Test',
          description: 'Test method',
          agent_types: ['text'],
        }),
        evaluateLog: async (_c, evaluation, _log, _storageConnector) => ({
          evaluation_id: evaluation.id,
          method: EvaluationMethodName.CONVERSATION_COMPLETENESS,
          score: 0.5,
          extra_data: {},
          display_info: [],
        }),
        getParameterSchema: z.object({}),
        getAIParameterSchema: z.object({}),
      };

      // Verify all methods exist and have correct types
      expect(typeof connector.getDetails).toBe('function');
      expect(typeof connector.evaluateLog).toBe('function');
      expect(connector.getParameterSchema).toBeDefined();
      expect(connector.getAIParameterSchema).toBeDefined();
    });
  });
});
