import { expect, test } from '@playwright/test';
import { createAgent, deleteAgent, uniqueAgentName } from '../fixtures/agents';
import {
  CHAT_COMPLETIONS_PATH,
  chatBody,
  saConfig,
  stubReset,
  uniqueModelName,
} from '../fixtures/gateway';
import { createSkill } from '../fixtures/skills';

const LOGS_PATH = '/v1/super-agents/observability/logs';
const FEEDBACKS_PATH = '/v1/super-agents/feedbacks';

/**
 * The thumbs on a whole session, asked for at once.
 *
 * The session rail marks each request a person judged, which has to be one
 * query over the window rather than one per row -- a session is up to a
 * hundred requests. That is `log_ids`, a list filter, and each backend writes
 * it by hand: `in.(a,b)` for PostgREST, `IN (?, ?)` for SQLite. Two
 * implementations of the same promise is what this directory is for.
 */
test.describe('the verdicts on several logs', () => {
  test('answers with the verdicts of exactly the logs asked for', async ({
    request,
  }) => {
    const agent = await createAgent(request, uniqueAgentName('verdicts'));
    await createSkill(request, agent.id, 'verdict_skill');
    const model = uniqueModelName('verdicts');

    try {
      // Three requests, each said differently so none is served from cache
      for (const message of ['first turn', 'second turn', 'third turn']) {
        const response = await request.post(CHAT_COMPLETIONS_PATH, {
          headers: {
            'sa-config': saConfig(agent.name, 'verdict_skill', { model }),
          },
          data: chatBody(message),
        });
        expect(response.status()).toBe(200);
      }

      const completedLogs = async (): Promise<{ id: string }[]> => {
        const logs = (await request
          .get(`${LOGS_PATH}?agent_id=${agent.id}`)
          .then((r) => r.json())) as { id: string; end_time: number | null }[];
        return logs.filter((log) => log.end_time !== null);
      };

      await expect
        .poll(async () => (await completedLogs()).length, {
          timeout: 15_000,
          message: 'the requests were never logged',
        })
        .toBe(3);

      const [judgedBad, judgedGood, unjudged] = await completedLogs();
      for (const [log, score] of [
        [judgedBad, 0],
        [judgedGood, 1],
      ] as const) {
        const created = await request.post(FEEDBACKS_PATH, {
          data: { log_id: log.id, score },
        });
        expect(created.status()).toBe(201);
      }

      const asked = [judgedBad.id, unjudged.id, judgedGood.id];
      const found = (await request
        .get(`${FEEDBACKS_PATH}?log_ids=${asked.join(',')}`)
        .then((r) => r.json())) as { log_id: string; score: number }[];

      // The log nobody judged contributes nothing, and neither does any
      // other log on the deployment.
      expect(new Map(found.map((f) => [f.log_id, f.score]))).toEqual(
        new Map([
          [judgedBad.id, 0],
          [judgedGood.id, 1],
        ]),
      );

      // A list of one is still a list, and a single id still means one log
      const one = (await request
        .get(`${FEEDBACKS_PATH}?log_ids=${judgedGood.id}`)
        .then((r) => r.json())) as { log_id: string }[];
      expect(one.map((f) => f.log_id)).toEqual([judgedGood.id]);

      const none = (await request
        .get(`${FEEDBACKS_PATH}?log_id=${unjudged.id}`)
        .then((r) => r.json())) as unknown[];
      expect(none).toEqual([]);
    } finally {
      await stubReset(request, model);
      await deleteAgent(request, agent.id);
    }
  });
});
