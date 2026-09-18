import type { APIRequestContext } from '@playwright/test';
import { createAgent, deleteAgent, uniqueAgentName } from '../fixtures/agents';
import { recordModel, recordProvider } from '../fixtures/cleanup';
import { STUB_URL, uniqueModelName } from '../fixtures/gateway';
import { createSkill, SKILLS_PATH } from '../fixtures/skills';
import { expect, test } from '../fixtures/test';

const AGENTS_PATH = '/v1/super-agents/agents';
const PROVIDERS_PATH = '/v1/super-agents/ai-providers';
const MODELS_PATH = '/v1/super-agents/models';

/**
 * A model to attach to a skill, and nothing else.
 *
 * Deliberately not `setUpStubModels`: that also writes the system settings,
 * which are one global row, and this file has no business changing what the
 * internal skills resolve through while another spec is relying on it.
 */
const createTextModel = async (
  request: APIRequestContext,
  scope: string,
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
      model_name: uniqueModelName(`${scope}-text`),
      model_type: 'text',
    },
  });
  expect(model.status()).toBe(201);
  const { id: modelId } = (await model.json()) as { id: string };
  recordModel(modelId);
  return modelId;
};

interface Readiness {
  skill_id: string;
  model_count: number;
  evaluation_count: number;
  optimize: boolean;
}

const readinessOf = async (
  request: APIRequestContext,
  agentId: string,
): Promise<Map<string, Readiness>> => {
  const response = await request.get(
    `${AGENTS_PATH}/${agentId}/skill-readiness`,
  );
  expect(response.status()).toBe(200);
  const rows = (await response.json()) as Readiness[];
  return new Map(rows.map((row) => [row.skill_id, row]));
};

/**
 * What every skill of an agent has, counted in one answer.
 *
 * The dashboard draws a readiness mark on each skill card and on every agent
 * in the sidebar, so this is asked on every page. Each backend counts it
 * differently -- one GROUP BY in SQLite, three PostgREST reads tallied in
 * TypeScript -- and the two have to agree, including on the skill that has
 * nothing, which is the one the mark is for.
 */
test.describe('what each of an agent’s skills has', () => {
  test('counts models and evaluations per skill, zeroes included', async ({
    request,
  }) => {
    const textId = await createTextModel(request, 'readiness');
    const agent = await createAgent(request, uniqueAgentName('readiness'));

    try {
      const equipped = await createSkill(request, agent.id, 'equipped_skill');
      const bare = await createSkill(request, agent.id, 'bare_skill', {
        optimize: true,
      });

      // A skill with nothing attached is still in the answer, as zeroes.
      let readiness = await readinessOf(request, agent.id);
      expect(readiness.size).toBe(2);
      expect(readiness.get(equipped.id)).toEqual({
        skill_id: equipped.id,
        model_count: 0,
        evaluation_count: 0,
        optimize: false,
      });
      expect(readiness.get(bare.id)?.model_count).toBe(0);
      // Whether a missing evaluation matters travels with the counts, so
      // deciding readiness needs nothing else.
      expect(readiness.get(bare.id)?.optimize).toBe(true);

      const attached = await request.post(
        `${SKILLS_PATH}/${equipped.id}/models`,
        { data: { modelIds: [textId] } },
      );
      expect(attached.status()).toBe(201);

      readiness = await readinessOf(request, agent.id);
      expect(readiness.get(equipped.id)?.model_count).toBe(1);
      // The other skill is untouched: the counts are per skill, not per agent.
      expect(readiness.get(bare.id)?.model_count).toBe(0);

      // A skill that was never given a model has no evaluations either:
      // attaching one is what generates them.
      expect(readiness.get(bare.id)?.evaluation_count).toBe(0);
      expect(readiness.get(equipped.id)?.optimize).toBe(false);
    } finally {
      await deleteAgent(request, agent.id);
    }
  });

  test('answers with nothing for an agent that has no skills', async ({
    request,
  }) => {
    const agent = await createAgent(request, uniqueAgentName('readiness-none'));
    try {
      expect((await readinessOf(request, agent.id)).size).toBe(0);
    } finally {
      await deleteAgent(request, agent.id);
    }
  });
});
