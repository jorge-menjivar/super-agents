import { evaluateLog } from '@api/connectors/evaluations/latency/service/evaluate';
import { createMockContext } from '@api/test-utils/mock-context';
import { HttpMethod } from '@api/types/http';
import { FunctionName } from '@shared/types/api/request';
import { AIProvider } from '@shared/types/constants';
import type { SkillOptimizationEvaluation } from '@shared/types/data';
import type {
  AIProviderRequestLog,
  CompletedLog,
} from '@shared/types/data/log';
import { EvaluationMethodName } from '@shared/types/evaluations';
import { CacheMode, CacheStatus } from '@shared/types/middleware/cache';
import { beforeEach, describe, expect, it } from 'vitest';
import { createMockStorageConnector } from '../__mocks__/mock-storage-connector';

describe('Latency - evaluateLog', () => {
  let baseLog: CompletedLog;
  let baseEvaluation: SkillOptimizationEvaluation;
  const mockStorageConnector = createMockStorageConnector();

  beforeEach(() => {
    baseLog = {
      id: 'log-123',
      agent_id: 'agent-123',
      skill_id: 'skill-123',
      cluster_id: null,
      error: null,
      method: HttpMethod.POST,
      endpoint: '/v1/chat/completions',
      function_name: FunctionName.CHAT_COMPLETE,
      status: 200,
      start_time: 1000,
      first_token_time: null,
      end_time: 2000,
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
      request_body: null,
      original_system_prompt: null,
      served_system_prompt: null,
      user_metadata: null,
      metadata: {},
      ai_provider_request_log: {
        provider: AIProvider.OPENAI,
        function_name: FunctionName.CHAT_COMPLETE,
        method: HttpMethod.POST,
        request_url: 'https://api.openai.com/v1/chat/completions',
        request_body: {
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'Hello' }],
        },
        response_body: {
          id: 'chatcmpl-123',
          object: 'chat.completion',
          created: 1677652288,
          model: 'gpt-4',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: 'Hello! How can I help you?',
              },
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
    };

    baseEvaluation = {
      id: 'eval-123',
      agent_id: 'agent-123',
      skill_id: 'skill-123',
      evaluation_method: EvaluationMethodName.LATENCY,
      params: {
        target_latency_ms: 300,
        max_latency_ms: 8787,
      },
      weight: 1.0,
      model_id: null,
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-01T00:00:00.000Z',
    };
  });

  describe('Streaming responses (with first_token_time)', () => {
    it('should score 1.0 for TTFT at or below target', async () => {
      const log: CompletedLog = {
        ...baseLog,
        start_time: 1000,
        first_token_time: 1200, // 200ms TTFT (below 300ms target)
        end_time: 8787,
        duration: 2000,
      };

      const result = await evaluateLog(
        createMockContext(),
        baseEvaluation,
        log,
        mockStorageConnector,
      );

      expect(result.method).toBe(EvaluationMethodName.LATENCY);
      expect(result.score).toBe(1.0);
      expect(result.extra_data.latency_ms).toBe(200);
      expect(result.extra_data.has_first_token_time).toBe(true);
      expect(result.extra_data.target_latency_ms).toBe(300);
      expect(result.extra_data.max_latency_ms).toBe(8787);
    });

    it('should score 0.0 for TTFT at or above max', async () => {
      const log: CompletedLog = {
        ...baseLog,
        start_time: 1000,
        first_token_time: 10000, // 9000ms TTFT (above 8787ms max)
        end_time: 11000,
        duration: 10000,
      };

      const result = await evaluateLog(
        createMockContext(),
        baseEvaluation,
        log,
        mockStorageConnector,
      );

      expect(result.method).toBe(EvaluationMethodName.LATENCY);
      expect(result.score).toBe(0.0);
      expect(result.extra_data.latency_ms).toBe(9000);
      expect(result.extra_data.has_first_token_time).toBe(true);
    });

    it('should linearly interpolate score between target and max', async () => {
      // Target: 300ms, Max: 8787ms
      // Range: 8487ms
      // TTFT: 4543.5ms (midpoint)
      // Score: 1.0 - (4543.5 - 300) / 8487 = 1.0 - 4243.5/8487 = ~0.5
      const midpoint = (300 + 8787) / 2; // 4543.5
      const log: CompletedLog = {
        ...baseLog,
        start_time: 1000,
        first_token_time: 1000 + midpoint, // midpoint TTFT
        end_time: 8000,
        duration: 7000,
      };

      const result = await evaluateLog(
        createMockContext(),
        baseEvaluation,
        log,
        mockStorageConnector,
      );

      expect(result.method).toBe(EvaluationMethodName.LATENCY);
      expect(result.score).toBeCloseTo(0.5, 2);
      expect(result.extra_data.latency_ms).toBe(midpoint);
      expect(result.extra_data.has_first_token_time).toBe(true);
    });

    it('should handle exact target latency', async () => {
      const log: CompletedLog = {
        ...baseLog,
        start_time: 1000,
        first_token_time: 1300, // Exactly 300ms TTFT
        end_time: 8787,
        duration: 2000,
      };

      const result = await evaluateLog(
        createMockContext(),
        baseEvaluation,
        log,
        mockStorageConnector,
      );

      expect(result.score).toBe(1.0);
      expect(result.extra_data.latency_ms).toBe(300);
    });

    it('should handle exact max latency', async () => {
      const log: CompletedLog = {
        ...baseLog,
        start_time: 1000,
        first_token_time: 1000 + 8787, // Exactly 8787ms TTFT (max latency)
        end_time: 10000,
        duration: 9000,
      };

      const result = await evaluateLog(
        createMockContext(),
        baseEvaluation,
        log,
        mockStorageConnector,
      );

      expect(result.score).toBe(0.0);
      expect(result.extra_data.latency_ms).toBe(8787);
    });
  });

  describe('Non-streaming responses (without first_token_time)', () => {
    it('should use duration as proxy when first_token_time is null', async () => {
      const log: CompletedLog = {
        ...baseLog,
        start_time: 1000,
        first_token_time: null,
        end_time: 1250, // 250ms total duration
        duration: 250,
      };

      const result = await evaluateLog(
        createMockContext(),
        baseEvaluation,
        log,
        mockStorageConnector,
      );

      expect(result.method).toBe(EvaluationMethodName.LATENCY);
      expect(result.score).toBe(1.0); // 250ms is below 300ms target
      expect(result.extra_data.latency_ms).toBe(250);
      expect(result.extra_data.has_first_token_time).toBe(false);
    });

    it('should score correctly using duration', async () => {
      // Use midpoint between target (300) and max (8787) for ~0.5 score
      const midpoint = (300 + 8787) / 2; // 4543.5
      const log: CompletedLog = {
        ...baseLog,
        start_time: 1000,
        first_token_time: null,
        end_time: 1000 + midpoint,
        duration: midpoint,
      };

      const result = await evaluateLog(
        createMockContext(),
        baseEvaluation,
        log,
        mockStorageConnector,
      );

      expect(result.score).toBeCloseTo(0.5, 2);
      expect(result.extra_data.latency_ms).toBe(midpoint);
      expect(result.extra_data.has_first_token_time).toBe(false);
    });
  });

  describe('Provider timing', () => {
    // The row spans the whole request: it arrived at 1000 and was answered
    // at 9000, with the skill chosen, the request embedded and a reviewer
    // consulted somewhere in between. The provider itself was asked at 6000.
    const timed = (
      first_token_time: number | null,
      provider: Pick<AIProviderRequestLog, 'start_time' | 'end_time'>,
    ): CompletedLog => ({
      ...baseLog,
      start_time: 1000,
      first_token_time,
      end_time: 9000,
      duration: 8000,
      ai_provider_request_log: {
        ...(baseLog.ai_provider_request_log as AIProviderRequestLog),
        ...provider,
      },
    });

    it("counts the provider's answer from the moment it was asked, not the request from its arrival", async () => {
      const result = await evaluateLog(
        createMockContext(),
        baseEvaluation,
        timed(null, { start_time: 6000, end_time: 6250 }),
        mockStorageConnector,
      );

      // 250ms, under the 300ms target. The 8000ms the row spans would have
      // scored the model for the gateway's work around the call.
      expect(result.score).toBe(1.0);
      expect(result.extra_data.latency_ms).toBe(250);
      expect(result.extra_data.measured).toBe('response');
      expect(result.extra_data.measured_from).toBe('provider');
      expect(result.display_info[1].content).toContain(
        'Provider Response Time: 250ms',
      );
    });

    it('counts time to first token from the moment the provider was asked', async () => {
      const result = await evaluateLog(
        createMockContext(),
        baseEvaluation,
        timed(6200, { start_time: 6000, end_time: 7000 }),
        mockStorageConnector,
      );

      expect(result.score).toBe(1.0);
      expect(result.extra_data.latency_ms).toBe(200);
      expect(result.extra_data.measured).toBe('ttft');
      expect(result.extra_data.measured_from).toBe('provider');
    });

    it("measures across the whole request when the log predates the provider's timing", async () => {
      const result = await evaluateLog(
        createMockContext(),
        baseEvaluation,
        timed(null, {}),
        mockStorageConnector,
      );

      expect(result.extra_data.latency_ms).toBe(8000);
      expect(result.extra_data.measured).toBe('response');
      expect(result.extra_data.measured_from).toBe('request');
      expect(result.score).toBeCloseTo(1 - (8000 - 300) / (8787 - 300), 5);
      expect(result.display_info[1].content).toContain(
        'Total Response Time: 8000ms',
      );
    });

    it("falls back to the request's span when only the provider's start was recorded", async () => {
      const result = await evaluateLog(
        createMockContext(),
        baseEvaluation,
        timed(null, { start_time: 6000 }),
        mockStorageConnector,
      );

      expect(result.extra_data.latency_ms).toBe(8000);
      expect(result.extra_data.measured_from).toBe('request');
    });
  });

  describe('Edge cases', () => {
    it('should return neutral score when latency cannot be extracted', async () => {
      // This shouldn't happen in practice, but test defensive coding
      const log: CompletedLog = {
        ...baseLog,
        start_time: 1000,
        first_token_time: null,
        end_time: 2000,
        duration: 0, // Invalid duration
      };

      // Mock extractLatency to return null
      const result = await evaluateLog(
        createMockContext(),
        baseEvaluation,
        log,
        mockStorageConnector,
      );

      expect(result.method).toBe(EvaluationMethodName.LATENCY);
      // Should still work with duration of 0
      expect(result.score).toBe(1.0);
    });

    it('should handle invalid parameters gracefully', async () => {
      const invalidEvaluation: SkillOptimizationEvaluation = {
        ...baseEvaluation,
        params: {
          target_latency_ms: 'invalid',
        },
      };

      const result = await evaluateLog(
        createMockContext(),
        invalidEvaluation,
        baseLog,
        mockStorageConnector,
      );

      expect(result.method).toBe(EvaluationMethodName.LATENCY);
      expect(result.score).toBe(0.5); // Neutral score on error
      expect(result.extra_data.error).toBeDefined();
    });

    it('should include execution time in extra_data', async () => {
      const result = await evaluateLog(
        createMockContext(),
        baseEvaluation,
        baseLog,
        mockStorageConnector,
      );

      expect(result.extra_data.execution_time).toBeDefined();
      expect(typeof result.extra_data.execution_time).toBe('number');
      expect(result.extra_data.execution_time).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Custom threshold configurations', () => {
    it('should respect custom target_latency_ms', async () => {
      const customEvaluation: SkillOptimizationEvaluation = {
        ...baseEvaluation,
        params: {
          target_latency_ms: 500,
          max_latency_ms: 2000,
        },
      };

      const log: CompletedLog = {
        ...baseLog,
        start_time: 1000,
        first_token_time: 1450, // 450ms TTFT
        end_time: 2000,
        duration: 1000,
      };

      const result = await evaluateLog(
        createMockContext(),
        customEvaluation,
        log,
        mockStorageConnector,
      );

      expect(result.score).toBe(1.0); // Below 500ms target
    });

    it('should respect custom max_latency_ms', async () => {
      const customEvaluation: SkillOptimizationEvaluation = {
        ...baseEvaluation,
        params: {
          target_latency_ms: 100,
          max_latency_ms: 1000,
        },
      };

      const log: CompletedLog = {
        ...baseLog,
        start_time: 1000,
        first_token_time: 2200, // 1200ms TTFT
        end_time: 8787,
        duration: 2000,
      };

      const result = await evaluateLog(
        createMockContext(),
        customEvaluation,
        log,
        mockStorageConnector,
      );

      expect(result.score).toBe(0.0); // Above 1000ms max
    });

    it('should use default parameters when params is empty', async () => {
      const defaultEvaluation: SkillOptimizationEvaluation = {
        ...baseEvaluation,
        params: {},
      };

      const log: CompletedLog = {
        ...baseLog,
        start_time: 1000,
        first_token_time: 1250, // 250ms TTFT
        end_time: 2000,
        duration: 1000,
      };

      const result = await evaluateLog(
        createMockContext(),
        defaultEvaluation,
        log,
        mockStorageConnector,
      );

      // Default target is 10000ms, so 250ms should score 1.0
      expect(result.score).toBe(1.0);
      expect(result.extra_data.target_latency_ms).toBe(10000);
      expect(result.extra_data.max_latency_ms).toBe(30000);
    });
  });
});
