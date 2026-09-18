import { createAgent, deleteAgent, uniqueAgentName } from '../fixtures/agents';
import {
  CHAT_COMPLETIONS_PATH,
  chatBody,
  saConfig,
  stubReset,
  uniqueModelName,
} from '../fixtures/gateway';
import { createSkill } from '../fixtures/skills';
import { expect, test } from '../fixtures/test';

const LOGS_PATH = '/v1/super-agents/observability/logs';
const SUMMARIES_PATH = `${LOGS_PATH}/summaries`;

interface LogRow {
  id: string;
  status: number | null;
  end_time: number | null;
  model: string | null;
  function_name: string;
  hook_logs: unknown[];
  metadata: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * A log read as a list rather than as a conversation.
 *
 * Both backends answer from a view of their own -- `json_remove` in SQLite,
 * `jsonb` subtraction in Postgres -- and the two have to leave out the same
 * things and keep the same ones. What is kept is what a table of requests
 * draws, plus the parameters the provider was asked with, which is where the
 * temperature column comes from.
 */
test.describe('a request read as a list row', () => {
  test('carries what a table draws and none of the conversation', async ({
    request,
  }) => {
    const agent = await createAgent(request, uniqueAgentName('summaries'));
    await createSkill(request, agent.id, 'summary_skill');
    const model = uniqueModelName('summaries');

    try {
      const answered = await request.post(CHAT_COMPLETIONS_PATH, {
        headers: {
          'sa-config': saConfig(agent.name, 'summary_skill', { model }),
        },
        // The temperature the caller sends is what reaches the provider, and
        // what the logs table shows in its own column.
        data: { ...chatBody('summarise this'), temperature: 0.25 },
      });
      expect(answered.status()).toBe(200);

      const summaries = async (): Promise<LogRow[]> =>
        (await request
          .get(`${SUMMARIES_PATH}?agent_id=${agent.id}`)
          .then((r) => r.json())) as LogRow[];

      await expect
        .poll(
          async () =>
            (await summaries()).filter((log) => log.end_time !== null).length,
          { timeout: 15_000, message: 'the request was never logged' },
        )
        .toBe(1);

      const [summary] = (await summaries()).filter(
        (log) => log.end_time !== null,
      );

      // Everything a row shows.
      expect(summary.status).toBe(200);
      expect(summary.model).toBe(model);
      expect(summary.function_name).toBe('chat_complete');
      expect(Array.isArray(summary.hook_logs)).toBe(true);
      expect(typeof summary.metadata).toBe('object');

      // And none of what it does not.
      for (const absent of [
        'request_body',
        'ai_provider_request_log',
        'embedding',
        'base_sa_config',
        'original_system_prompt',
        'served_system_prompt',
      ]) {
        expect(summary).not.toHaveProperty(absent);
      }

      // The inference parameters survive; the conversation inside them does
      // not. This is the temperature column on the logs page.
      const params = summary.provider_request_params as Record<
        string,
        unknown
      > | null;
      expect(params).not.toBeNull();
      expect(params?.temperature).toBe(0.25);
      expect(params).not.toHaveProperty('messages');
      expect(params).not.toHaveProperty('tools');

      // The whole row is still there to be read one at a time.
      const [whole] = (await request
        .get(`${LOGS_PATH}?id=${summary.id}`)
        .then((r) => r.json())) as LogRow[];
      expect(whole.id).toBe(summary.id);
      expect(whole).toHaveProperty('request_body');
      expect(
        (whole.ai_provider_request_log as { request_body: { messages: [] } })
          .request_body.messages.length,
      ).toBeGreaterThan(0);
    } finally {
      await stubReset(request, model);
      await deleteAgent(request, agent.id);
    }
  });

  test('takes the same filters as the whole rows do', async ({ request }) => {
    const agent = await createAgent(request, uniqueAgentName('sum-filter'));
    await createSkill(request, agent.id, 'filtered_skill');
    const model = uniqueModelName('sum-filter');

    try {
      for (const message of ['one', 'two', 'three']) {
        const response = await request.post(CHAT_COMPLETIONS_PATH, {
          headers: {
            'sa-config': saConfig(agent.name, 'filtered_skill', { model }),
          },
          data: chatBody(message),
        });
        expect(response.status()).toBe(200);
      }

      await expect
        .poll(
          async () =>
            (
              (await request
                .get(`${SUMMARIES_PATH}?agent_id=${agent.id}`)
                .then((r) => r.json())) as LogRow[]
            ).filter((log) => log.end_time !== null).length,
          { timeout: 15_000, message: 'the requests were never logged' },
        )
        .toBe(3);

      const limited = (await request
        .get(`${SUMMARIES_PATH}?agent_id=${agent.id}&limit=2`)
        .then((r) => r.json())) as LogRow[];
      expect(limited.length).toBe(2);

      // Newest first unless asked otherwise, as the whole rows are.
      const ascending = (await request
        .get(`${SUMMARIES_PATH}?agent_id=${agent.id}&order=asc`)
        .then((r) => r.json())) as { start_time: number }[];
      const times = ascending.map((log) => log.start_time);
      expect([...times].sort((a, b) => a - b)).toEqual(times);

      const byStatus = (await request
        .get(`${SUMMARIES_PATH}?agent_id=${agent.id}&status=200`)
        .then((r) => r.json())) as LogRow[];
      expect(byStatus.length).toBeGreaterThan(0);
      expect(byStatus.every((log) => log.status === 200)).toBe(true);
    } finally {
      await stubReset(request, model);
      await deleteAgent(request, agent.id);
    }
  });
});
