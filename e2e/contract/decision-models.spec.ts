import type { APIRequestContext } from '@playwright/test';
import {
  AGENTS_PATH,
  createAgent,
  deleteAgent,
  uniqueAgentName,
} from '../fixtures/agents';
import { recordModel, recordProvider } from '../fixtures/cleanup';
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
  uniqueModelName,
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

const PROVIDERS_PATH = '/v1/super-agents/ai-providers';
const MODELS_PATH = '/v1/super-agents/models';

/**
 * A text or embed model nothing asks, for what the database says about a
 * model changing its type. Not `setUpStubModels`, which writes the system
 * settings -- one global row, which other specs are relying on.
 */
const createModel = async (
  request: APIRequestContext,
  scope: string,
  type: { model_type: 'text' } | { model_type: 'embed'; dimensions: number },
): Promise<string> => {
  const provider = await request.post(PROVIDERS_PATH, {
    data: {
      ai_provider: 'ollama',
      name: uniqueModelName(`${scope}-provider`),
      api_key: 'unused-by-the-stub',
      custom_fields: { custom_host: STUB_URL },
    },
  });
  expect(provider.status()).toBe(201);
  const { id: providerId } = (await provider.json()) as { id: string };
  recordProvider(providerId);

  const model = await request.post(MODELS_PATH, {
    data: {
      ai_provider_id: providerId,
      model_name: uniqueModelName(`${scope}-${type.model_type}`),
      model_type: type.model_type,
      ...(type.model_type === 'embed'
        ? { embedding_dimensions: type.dimensions }
        : {}),
    },
  });
  expect(model.status()).toBe(201);
  const { id } = (await model.json()) as { id: string };
  recordModel(id);
  return id;
};

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
    const agent = await createAgent(
      request,
      uniqueAgentName('decide'),
      undefined,
      { agent_type: 'decision' },
    );
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

  // The gateway takes images as Jev names them; Drex numbers them instead.
  test('shows the decision model an image, numbered for Drex', async ({
    request,
  }) => {
    const agent = await createAgent(
      request,
      uniqueAgentName('seeing'),
      undefined,
      { agent_type: 'decision' },
    );
    const skill = await createSkill(request, agent.id, 'decision_skill');
    const model = await createDecisionModel(request, 'seeing');

    try {
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
          state: { photo: 'door-cam' },
          questions: {
            withhold: {
              type: 'noul',
              instructions: 'Is anyone at the door in door-cam?',
            },
          },
          assets: {
            'door-cam': {
              type: 'image',
              format: 'jpg',
              data_base64: '/9j/4AAQ',
            },
          },
        },
      });
      expect(response.status()).toBe(200);

      const [forwarded] = await stubRequests(request, model.name);
      expect(forwarded.images).toEqual(['data:image/jpeg;base64,/9j/4AAQ']);
      expect(forwarded.state).toEqual({ photo: 'Image 1' });
      expect(forwarded.questions).toEqual({
        withhold: {
          type: 'noul',
          instructions: 'Is anyone at the door in Image 1?',
        },
      });
      expect(forwarded).not.toHaveProperty('assets');
    } finally {
      await stubReset(request, model.name);
      await deleteAgent(request, agent.id);
    }
  });

  test('refuses a question that could not be answered before asking anyone', async ({
    request,
  }) => {
    const agent = await createAgent(
      request,
      uniqueAgentName('refused'),
      undefined,
      { agent_type: 'decision' },
    );
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

  test('keeps each agent to the requests and models of its type', async ({
    request,
  }) => {
    const guard = await createAgent(
      request,
      uniqueAgentName('typed'),
      undefined,
      { agent_type: 'decision' },
    );
    const helper = await createAgent(request, uniqueAgentName('typed-llm'));
    const model = await createDecisionModel(request, 'typed');

    try {
      expect(guard.agent_type).toBe('decision');
      expect(helper.agent_type).toBe('text');

      // A chat request reaches no model of a decision agent that could
      // write the answer, and the gateway says where to ask instead.
      const chat = await request.post(
        `/v1/agents/${guard.name}/chat/completions`,
        {
          data: {
            model: 'ignored-by-the-gateway',
            messages: [{ role: 'user', content: 'hello' }],
          },
        },
      );
      expect(chat.status()).toBe(400);
      expect(((await chat.json()) as { error: string }).error).toContain(
        '/v1/systemone',
      );

      const decide = await request.post(`/v1/agents/${helper.name}/systemone`, {
        data: { state: 'x', questions: QUESTIONS },
      });
      expect(decide.status()).toBe(400);

      // Its models are of its type, its own and its skills' alike.
      const wrong = await request.post(`${AGENTS_PATH}/${helper.id}/models`, {
        data: { modelIds: [model.id] },
      });
      expect(wrong.status()).toBe(400);
      expect(((await wrong.json()) as { error: string }).error).toContain(
        'is a decision model',
      );
      const right = await request.post(`${AGENTS_PATH}/${guard.id}/models`, {
        data: { modelIds: [model.id] },
      });
      expect(right.status()).toBe(201);

      // And with a model, its type is fixed.
      const flipped = await request.patch(`${AGENTS_PATH}/${guard.id}`, {
        data: { agent_type: 'text' },
      });
      expect(flipped.status()).toBe(400);
    } finally {
      await deleteAgent(request, guard.id);
      await deleteAgent(request, helper.id);
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

  // The same slot from the other side: a judge cannot become a decision
  // model either. libSQL once counted only an agent's arbiter here, and let
  // this through where Postgres refused it.
  test('keeps the type of a model an agent judges with, on either backend', async ({
    request,
  }) => {
    const judge = await createModel(request, 'judge', { model_type: 'text' });
    const agent = await createAgent(request, uniqueAgentName('judged'));

    try {
      const named = await request.patch(`${AGENTS_PATH}/${agent.id}`, {
        data: { judge_model_id: judge },
      });
      expect(named.status()).toBe(200);

      const retyped = await request.patch(`${MODELS_PATH}/${judge}`, {
        data: { model_type: 'decision' },
      });
      // Refused by the database's guard, in the same words on both backends.
      expect(retyped.status()).toBe(400);
      expect(((await retyped.json()) as { error: string }).error).toBe(
        'Cannot change model_type for a model that an agent asks for itself',
      );

      const reread = await request.get(`${MODELS_PATH}/${judge}`);
      expect(((await reread.json()) as { model_type: string }).model_type).toBe(
        'text',
      );
    } finally {
      await deleteAgent(request, agent.id);
    }
  });
});
