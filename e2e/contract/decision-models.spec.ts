import {
  AGENTS_PATH,
  createAgent,
  deleteAgent,
  uniqueAgentName,
} from '../fixtures/agents';
import {
  createDecisionModel,
  SYSTEM_ONE_PATH,
  type SystemOneAnswerBody,
} from '../fixtures/decision';
import {
  STUB_URL,
  stubReply,
  stubRequests,
  stubReset,
} from '../fixtures/gateway';
import { getLogs } from '../fixtures/logs';
import { createSkill } from '../fixtures/skills';
import { expect, test } from '../fixtures/test';

/**
 * Decision models, on the API they speak: System One, `POST /v1/systemone`.
 *
 * Jev and Drex answer questions about some material with probabilities and
 * write nothing, so the gateway takes their API as it is rather than through
 * chat completions. What only shows up end to end is the whole path holding:
 * the route and its agent and skill mounts, the request forwarded as the
 * caller wrote it, the skill's system prompt put ahead of the questions, the
 * answer stamped and logged, and the `decision` model type the database keeps
 * out of the slots that need written text.
 *
 * The stub stands in for a self-hosted Drex: `nace` with a custom host and no
 * key. Nothing here touches system settings, which are one global row; a
 * skill served by its own arms needs the embedding model they configure, so
 * that case is in `optimizer.spec.ts` ("decision skills").
 */

const QUESTIONS = {
  withhold: {
    type: 'noul',
    instructions: 'Should the client be kept from receiving this?',
  },
  topic: {
    type: 'choice',
    instructions: 'What is it about?',
    criteria: { security: 'Locks and alarms', other: null },
  },
};

test.describe('decision models', () => {
  test('answers a System One request as the decision model gave it, and logs it', async ({
    request,
  }) => {
    const agent = await createAgent(request, uniqueAgentName('decide'));
    const skill = await createSkill(request, agent.id, 'decision_skill');
    const model = await createDecisionModel(request, 'direct');

    try {
      await stubReply(
        request,
        model.name,
        JSON.stringify({ withhold: { type: 'noul', noul: 0.91 } }),
      );

      const response = await request.post(SYSTEM_ONE_PATH, {
        headers: {
          'sa-config': JSON.stringify({
            agent_name: agent.name,
            skill_name: skill.name,
            targets: [
              { provider: 'nace', custom_host: STUB_URL, model: model.name },
            ],
          }),
        },
        data: {
          state: 'Here is how to pick a lock.',
          questions: QUESTIONS,
          // Not System One: nothing the vendor would understand is sent on.
          temperature: 0.2,
        },
      });

      expect(response.status()).toBe(200);
      const body = (await response.json()) as SystemOneAnswerBody;
      expect(body.model).toBe(model.name);
      expect(body.provider).toBe('nace');
      expect(body.answers.withhold).toEqual({ type: 'noul', noul: 0.91 });
      expect(body.answers.topic.choice).toBe('security');

      // The request reached the provider as the caller wrote it.
      const [forwarded] = await stubRequests(request, model.name);
      expect(forwarded).toEqual({
        model: model.name,
        state: 'Here is how to pick a lock.',
        questions: QUESTIONS,
      });

      // And the exchange is logged as a System One one, answers and all.
      await expect
        .poll(async () => {
          const [log] = await getLogs(request, skill.id);
          return log?.ai_provider_request_log ? log : null;
        })
        .not.toBeNull();
      const [log] = await getLogs(request, skill.id);
      expect(log.original_system_prompt).toBe(
        'Should the client be kept from receiving this?\n\nWhat is it about?',
      );
      const exchange = log.ai_provider_request_log as unknown as {
        response_body: SystemOneAnswerBody;
      };
      expect(exchange.response_body.answers.withhold.noul).toBe(0.91);
    } finally {
      await stubReset(request, model.name);
      await deleteAgent(request, agent.id);
    }
  });

  test('refuses a question that could not be answered before asking anyone', async ({
    request,
  }) => {
    const agent = await createAgent(request, uniqueAgentName('refused'));
    const skill = await createSkill(request, agent.id, 'decision_skill');

    try {
      // A choice with no options never reaches the provider.
      const response = await request.post(SYSTEM_ONE_PATH, {
        headers: {
          'sa-config': JSON.stringify({
            agent_name: agent.name,
            skill_name: skill.name,
            targets: [
              { provider: 'nace', custom_host: STUB_URL, model: 'drex-latest' },
            ],
          }),
        },
        data: {
          state: 'anything',
          questions: { topic: { type: 'choice', criteria: {} } },
        },
      });
      expect(response.status()).toBe(422);
    } finally {
      await deleteAgent(request, agent.id);
    }
  });

  test('keeps a decision model out of a slot that needs written text', async ({
    request,
  }) => {
    const agent = await createAgent(request, uniqueAgentName('slot'));
    const model = await createDecisionModel(request, 'slot');

    try {
      const patched = await request.patch(`${AGENTS_PATH}/${agent.id}`, {
        data: { judge_model_id: model.id },
      });
      // Refused by the database's model-type trigger, in its own words.
      expect(patched.status()).toBe(400);
      expect(((await patched.json()) as { error: string }).error).toBe(
        'judge_model_id must reference a text model',
      );

      const reread = await request.get(AGENTS_PATH, {
        params: { id: agent.id },
      });
      const [{ judge_model_id }] = (await reread.json()) as {
        judge_model_id: string | null;
      }[];
      expect(judge_model_id).toBeNull();
    } finally {
      await deleteAgent(request, agent.id);
    }
  });
});
