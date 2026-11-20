import { conversationCompletenessEvaluationConnector } from '@api/connectors/evaluations/conversation-completeness';
import { decisionCorrectnessEvaluationConnector } from '@api/connectors/evaluations/decision-correctness';
import { knowledgeRetentionEvaluationConnector } from '@api/connectors/evaluations/knowledge-retention';
import { latencyEvaluationConnector } from '@api/connectors/evaluations/latency/latency';
import { taskCompletionEvaluationConnector } from '@api/connectors/evaluations/task-completion';
import { toolCorrectnessEvaluationConnector } from '@api/connectors/evaluations/tool-correctness';
import { turnRelevancyEvaluationConnector } from '@api/connectors/evaluations/turn-relevancy';
import type { EvaluationMethodConnector } from '@api/types/connector';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

/** The connectors registered in `v1/index.ts`. */
const connectors: EvaluationMethodConnector[] = [
  conversationCompletenessEvaluationConnector,
  decisionCorrectnessEvaluationConnector,
  knowledgeRetentionEvaluationConnector,
  latencyEvaluationConnector,
  taskCompletionEvaluationConnector,
  toolCorrectnessEvaluationConnector,
  turnRelevancyEvaluationConnector,
];

describe.each(connectors.map((c) => [c.getDetails().method, c] as const))(
  '%s parameters',
  (method, connector) => {
    const aiSchema = connector.getAIParameterSchema;
    const generated =
      aiSchema instanceof z.ZodObject ? Object.keys(aiSchema.shape) : [];

    /**
     * A method whose AI schema is empty is stored with `params: {}` -- nothing
     * generates a value for it, and nothing else fills one in. Its own schema
     * therefore has to be satisfied by its defaults alone, or the evaluation
     * fails on every request it is asked to score, long after the evaluation
     * was created:
     *
     *   [REALTIME_EVAL] Failed to evaluate log ... with method ...
     */
    it('evaluates with the parameters it is created with', () => {
      const created = generated.length === 0 ? {} : undefined;
      if (created === undefined) {
        // Generated parameters are covered by the generator's own tests; the
        // invariant here is about the methods that generate nothing.
        expect(method).toBe('task_completion');
        return;
      }

      const parsed = connector.getParameterSchema.safeParse(created);
      expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    });
  },
);
