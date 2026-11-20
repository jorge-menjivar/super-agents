import { decisionCorrectnessEvaluationConnector } from '@api/connectors/evaluations/decision-correctness';
import { latencyEvaluationConnector } from '@api/connectors/evaluations/latency/latency';
import { taskCompletionEvaluationConnector } from '@api/connectors/evaluations/task-completion';
import type { AppEnv } from '@api/types/hono';
import { evaluationConnectorsFor } from '@api/utils/evaluation-methods';
import { skillsRouter } from '@api/v1/super-agents/skills';
import { Hono } from 'hono';
import { testClient } from 'hono/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A method judges what a skill's requests are, so a skill gets only the
 * methods that can read them: the conversation judges for an LLM agent, the
 * decision judge for a decision agent, and latency -- which reads only
 * timing -- for both.
 */

const SKILL_ID = 'c13d1678-150a-466b-804f-ecc82de3680e';
const AGENT_ID = '0c1f3a7e-4b8d-4e2a-9f6c-1d2e3f4a5b6c';

const registered = {
  decision_correctness: decisionCorrectnessEvaluationConnector,
  latency: latencyEvaluationConnector,
  task_completion: taskCompletionEvaluationConnector,
};

describe('evaluationConnectorsFor', () => {
  const methodsFor = (agentType: 'text' | 'decision') =>
    evaluationConnectorsFor(registered, agentType)
      .map(([method]) => method)
      .sort();

  it('gives a decision agent the decision judge and latency', () => {
    expect(methodsFor('decision')).toEqual(['decision_correctness', 'latency']);
  });

  it('gives an LLM agent the conversation judges and latency', () => {
    expect(methodsFor('text')).toEqual(['latency', 'task_completion']);
  });
});

describe('POST /:skillId/evaluations', () => {
  const connector = {
    getSkills: vi.fn(),
    getAgents: vi.fn(),
    createSkillOptimizationEvaluations: vi.fn(),
    createSkillEvent: vi.fn(),
  };
  const app = new Hono<AppEnv>()
    .use('*', async (c, next) => {
      c.set('user_data_storage_connector', connector as never);
      c.set('evaluation_connectors_map', registered as never);
      await next();
    })
    .route('/', skillsRouter);
  const client = testClient(app);

  const add = (methods: string[]) =>
    client[':skillId'].evaluations.$post({
      param: { skillId: SKILL_ID },
      json: { methods: methods as never },
    });

  beforeEach(() => {
    vi.clearAllMocks();
    connector.getSkills.mockResolvedValue([
      { id: SKILL_ID, agent_id: AGENT_ID, description: 'Withholds replies.' },
    ]);
    connector.getAgents.mockResolvedValue([
      {
        id: AGENT_ID,
        description: 'Reviews replies.',
        agent_type: 'decision',
      },
    ]);
    connector.createSkillOptimizationEvaluations.mockImplementation(
      async (_c, params: unknown[]) => params,
    );
  });

  it("refuses a method that cannot judge the agent's skills", async () => {
    const response = await add(['task_completion', 'latency']);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'task_completion cannot judge the skills of a decision agent',
    });
    expect(connector.createSkillOptimizationEvaluations).not.toHaveBeenCalled();
  });

  it('adds the ones that can', async () => {
    const response = await add(['decision_correctness', 'latency']);

    expect(response.status).toBe(200);
    const [, created] =
      connector.createSkillOptimizationEvaluations.mock.calls[0];
    expect(
      (created as { evaluation_method: string }[]).map(
        (params) => params.evaluation_method,
      ),
    ).toEqual(['decision_correctness', 'latency']);
  });
});
