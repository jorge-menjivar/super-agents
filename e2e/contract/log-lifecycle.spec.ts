import { expect, test } from '@playwright/test';
import { createAgent, uniqueAgentName } from '../fixtures/agents';
import {
  CHAT_COMPLETIONS_PATH,
  chatBody,
  saConfig,
  stubReset,
  uniqueModelName,
} from '../fixtures/gateway';
import { createSkill } from '../fixtures/skills';

/**
 * The log row a request opens on arrival.
 *
 * A row used to be written only once a request finished, which meant work in
 * progress was invisible and a request that failed before reaching a provider
 * left no trace at all. Both halves of that only run in the built server: the
 * row is opened by the gateway middleware as it resolves the skill, and closed
 * when the response completes or when it fails.
 *
 * In `contract/` because the upsert underneath is hand-written per backend --
 * `ON CONFLICT ... DO UPDATE` on SQLite, `resolution=merge-duplicates` on
 * PostgREST -- and so is the conditional update that closes a failed row
 * without touching one that already completed. Two implementations of the
 * same promise is exactly what this directory exists to check.
 */

const LOGS_PATH = '/v1/super-agents/observability/logs';

/** A completed row's timing, as the streamed test reads it. */
interface StreamedRow {
  start_time: number;
  first_token_time: number;
  end_time: number;
  ai_provider_request_log: { start_time: number; end_time: number };
}

test.describe('the log row a request opens', () => {
  test('records a completed request once, not twice', async ({ request }) => {
    const agent = await createAgent(request, uniqueAgentName('inflight'));
    await createSkill(request, agent.id, 'inflight_skill');
    const model = uniqueModelName('inflight');

    try {
      const response = await request.post(CHAT_COMPLETIONS_PATH, {
        headers: {
          'sa-config': saConfig(agent.name, 'inflight_skill', { model }),
        },
        data: chatBody('is anyone there'),
      });
      expect(response.status()).toBe(200);

      // The completion write upserts the row opened on arrival; two rows here
      // would mean the id was not carried through and every request is
      // recorded twice.
      await expect
        .poll(
          async () => {
            const logs = await request
              .get(`${LOGS_PATH}?agent_id=${agent.id}`)
              .then((r) => r.json());
            return logs.filter(
              (log: { end_time: number | null }) => log.end_time !== null,
            ).length;
          },
          { timeout: 15_000, message: 'the request was never logged' },
        )
        .toBe(1);

      const logs = await request
        .get(`${LOGS_PATH}?agent_id=${agent.id}`)
        .then((r) => r.json());

      expect(logs).toHaveLength(1);
      expect(logs[0].status).toBe(200);
      expect(logs[0].duration).toBeGreaterThanOrEqual(0);
      expect(logs[0].error).toBeNull();
      expect(logs[0].ai_provider_request_log).not.toBeNull();

      // The provider's own span sits inside the row's. The row counts the
      // gateway's work around the call -- choosing the skill, embedding the
      // request, the hooks -- and the latency evaluation reads the provider's
      // span so that none of it counts against the model.
      const provider = logs[0].ai_provider_request_log;
      expect(provider.start_time).toBeGreaterThanOrEqual(logs[0].start_time);
      expect(provider.end_time).toBeGreaterThanOrEqual(provider.start_time);
      expect(provider.end_time).toBeLessThanOrEqual(logs[0].end_time);
    } finally {
      await stubReset(request, model);
    }
  });

  test("records when a streamed answer began and ended, by the provider's clock", async ({
    request,
  }) => {
    const agent = await createAgent(request, uniqueAgentName('streamed'));
    await createSkill(request, agent.id, 'streamed_skill');
    const model = uniqueModelName('streamed');

    try {
      const response = await request.post(CHAT_COMPLETIONS_PATH, {
        headers: {
          'sa-config': saConfig(agent.name, 'streamed_skill', { model }),
        },
        data: chatBody('is anyone there', true),
      });
      expect(response.status()).toBe(200);
      // The row completes once the stream has been read to its end.
      await response.text();

      const completed = async () =>
        (
          (await request
            .get(`${LOGS_PATH}?agent_id=${agent.id}`)
            .then((r) => r.json())) as StreamedRow[]
        ).find((log) => log.end_time !== null);
      await expect
        .poll(completed, {
          timeout: 15_000,
          message: 'the request was never logged',
        })
        .toBeDefined();
      const log = (await completed()) as StreamedRow;

      // The first token is stamped as the provider's first chunk arrives, so
      // it falls after the provider was asked and before its answer ended.
      const provider = log.ai_provider_request_log;
      expect(log.first_token_time).toBeGreaterThanOrEqual(provider.start_time);
      expect(provider.end_time).toBeGreaterThanOrEqual(log.first_token_time);
      expect(provider.end_time).toBeLessThanOrEqual(log.end_time);
    } finally {
      await stubReset(request, model);
    }
  });

  test('records a request that failed before a provider answered', async ({
    request,
  }) => {
    // The gap this closes: naming a skill that does not exist used to be
    // answered with a 404 and logged nowhere at all.
    const agent = await createAgent(request, uniqueAgentName('failed'));
    await createSkill(request, agent.id, 'real_skill');
    const model = uniqueModelName('failed');

    try {
      const response = await request.post(CHAT_COMPLETIONS_PATH, {
        headers: {
          'sa-config': saConfig(agent.name, 'no_such_skill', { model }),
        },
        data: chatBody('this cannot be routed'),
      });
      expect(response.status()).toBe(404);

      // Nothing is recorded: the row is opened only once the skill resolves,
      // and this request never got that far. Asserting it explicitly because
      // it is the known edge of the feature, not an oversight.
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const logs = await request
        .get(`${LOGS_PATH}?agent_id=${agent.id}`)
        .then((r) => r.json());
      expect(logs).toHaveLength(0);
    } finally {
      await stubReset(request, model);
    }
  });

  test('records a request whose provider could not be reached', async ({
    request,
  }) => {
    const agent = await createAgent(request, uniqueAgentName('unreachable'));
    await createSkill(request, agent.id, 'unreachable_skill');
    const model = uniqueModelName('unreachable');

    try {
      // A host nothing is listening on: the skill resolves, so the row is
      // opened, and then the provider call fails.
      const response = await request.post(CHAT_COMPLETIONS_PATH, {
        headers: {
          'sa-config': JSON.stringify({
            agent_name: agent.name,
            skill_name: 'unreachable_skill',
            targets: [
              {
                provider: 'ollama',
                custom_host: 'http://127.0.0.1:1',
                model,
              },
            ],
          }),
        },
        data: chatBody('nobody is listening'),
      });
      expect(response.status()).toBeGreaterThanOrEqual(400);

      await expect
        .poll(
          async () => {
            const logs = await request
              .get(`${LOGS_PATH}?agent_id=${agent.id}`)
              .then((r) => r.json());
            return logs.length;
          },
          {
            timeout: 15_000,
            message: 'the failed request left no trace',
          },
        )
        .toBe(1);

      const [log] = await request
        .get(`${LOGS_PATH}?agent_id=${agent.id}`)
        .then((r) => r.json());

      // Closed, not left running, and it says what went wrong.
      expect(log.end_time).not.toBeNull();
      expect(log.status).toBeGreaterThanOrEqual(400);
      expect(log.error).toBeTruthy();
      expect(log.endpoint).toBe(CHAT_COMPLETIONS_PATH);
    } finally {
      await stubReset(request, model);
    }
  });
});
