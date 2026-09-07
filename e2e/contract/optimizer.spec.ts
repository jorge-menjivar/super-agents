import { type APIRequestContext, expect, test } from '@playwright/test';
import {
  AGENTS_PATH,
  type Agent,
  addModelsToAgent,
  createAgent,
  deleteAgent,
  getSkillRoutings,
  uniqueAgentName,
} from '../fixtures/agents';
import {
  CHAT_COMPLETIONS_PATH,
  chatBody,
  parseSSE,
  STUB_URL,
  saConfig,
  stubReply,
  stubRequests,
  stubReset,
  type TargetOptions,
  uniqueModelName,
} from '../fixtures/gateway';
import { getLogs, getLogsByArm, type LoggedRequest } from '../fixtures/logs';
import {
  getArms,
  getClusters,
  MODELS_PATH,
  type OptimizedSkill,
  optimizedConfig,
  STUB_SYSTEM_PROMPT,
  type StubModels,
  setUpOptimizedSkill,
  setUpStubModels,
} from '../fixtures/optimizer';
import {
  createSkill,
  getSkillEvaluations,
  getSkillModels,
  getSkills,
  SKILLS_PATH,
  type Skill,
} from '../fixtures/skills';

/**
 * The self-optimization loop, running for real against the stub provider.
 *
 * The internal skills -- prompt seeding, embedding, judging, evaluation
 * generation -- are ordinary gateway requests the server sends back to its own
 * `/v1`, resolved through system settings. Nothing about that path is
 * observable from unit tests, and until now nothing exercised it end to end:
 * the loop could stop working entirely and every ordinary request would carry
 * on being served, because each internal call swallows its own errors.
 *
 * Serial, because system settings are a single global row that the whole
 * deployment shares.
 */
test.describe.configure({ mode: 'serial' });

/**
 * The request the *caller* made, out of everything recorded for a model.
 *
 * Not simply the last one: the internal skills -- judging, task extraction,
 * describing a new skill -- resolve their model from system settings, which
 * are global to the server, so any traffic anywhere in the suite can append to
 * this recording between the call under test and the assertion. Identifying
 * the request by the message the caller sent is stable regardless.
 */
const servedRequestFor = (
  forwarded: Record<string, unknown>[],
  userMessage: string,
): { messages: { role: string; content: string }[] } => {
  const match = [...forwarded]
    .reverse()
    .find((entry) =>
      (entry as { messages?: { content?: unknown }[] }).messages?.some(
        (message) => message.content === userMessage,
      ),
    );

  expect(match, `no forwarded request carried "${userMessage}"`).toBeDefined();
  return match as { messages: { role: string; content: string }[] };
};

test.describe('optimization loop', () => {
  let configured: OptimizedSkill;

  test.beforeAll(async ({ request }, testInfo) => {
    /**
     * Scoped by project: both storage backends run this file against their own
     * server but share one stub, which buckets traffic by model name. The
     * project name is sanitised because it becomes part of an agent name, and
     * those permit only lowercase letters, digits, `_` and `-`.
     */
    const scope = `opt-${testInfo.project.name.replace(/[^a-z0-9]+/gi, '-')}`;
    configured = await setUpOptimizedSkill(request, scope.toLowerCase());
  });

  test('generates a cluster per configuration', async ({ request }) => {
    // `configuration_count` is what the skill asked for, and the clusters are
    // what the request router later picks between.
    expect(await getClusters(request, configured.skillId)).toHaveLength(3);
  });

  test('generates arms carrying a prompt written by the internal skill', async ({
    request,
  }) => {
    /**
     * The end-to-end proof that the internal skills are wired up. That prompt
     * text can only exist if the seeding skill resolved a model from system
     * settings, called back into this server's own `/v1`, reached the stub
     * through the provider's `custom_host`, and had its structured output
     * parsed and stored.
     */
    const arms = await getArms(request, configured.skillId);

    expect(arms.length).toBeGreaterThan(0);
    for (const arm of arms) {
      expect(arm.params.system_prompt).toBe(STUB_SYSTEM_PROMPT);
    }
  });

  test('spreads arms across every cluster', async ({ request }) => {
    // An arm belongs to exactly one cluster; a cluster with none would be
    // unusable, and requests routed to it would have nothing to select.
    const clusters = await getClusters(request, configured.skillId);
    const arms = await getArms(request, configured.skillId);

    const populated = new Set(arms.map((arm) => arm.cluster_id));
    expect(populated.size).toBe(clusters.length);
  });

  test('serves an optimized request with the generated prompt', async ({
    request,
  }) => {
    /**
     * The whole loop in one request: embed the input, route it to a cluster,
     * sample an arm, and send that arm's generated system prompt to the
     * provider. The prompt is asserted at the provider, because the client
     * never sees which configuration served it.
     */
    const response = await request.post(CHAT_COMPLETIONS_PATH, {
      headers: {
        'sa-config': optimizedConfig(
          configured.agentName,
          configured.skillName,
        ),
      },
      data: chatBody('plan a trip to Lisbon'),
    });

    expect(response.status()).toBe(200);
    const body = (await response.json()) as {
      choices: { message: { content: string } }[];
    };
    expect(body.choices[0].message.content).toBe('echo: plan a trip to Lisbon');

    const forwarded = await stubRequests(request, configured.textModel);
    const served = servedRequestFor(forwarded, 'plan a trip to Lisbon');
    expect(served.messages[0]).toEqual({
      role: 'system',
      content: STUB_SYSTEM_PROMPT,
    });
    expect(served.messages[1].content).toBe('plan a trip to Lisbon');
  });

  test('keeps the caller system prompt on the log it replaced', async ({
    request,
  }) => {
    /**
     * On an optimized skill the client's own system prompt never reaches the
     * provider -- the arm's does -- and `ai_provider_request_log` records the
     * body as it was sent. The log is the only place the client's prompt
     * survives, so it is checked here on both backends.
     */
    const userMessage = 'book a table for two';
    const response = await request.post(CHAT_COMPLETIONS_PATH, {
      headers: {
        'sa-config': optimizedConfig(
          configured.agentName,
          configured.skillName,
        ),
      },
      data: {
        ...chatBody(userMessage),
        messages: [
          { role: 'system', content: 'You are a restaurant concierge.' },
          { role: 'user', content: userMessage },
        ],
      },
    });
    expect(response.status()).toBe(200);

    const forwarded = await stubRequests(request, configured.textModel);
    const served = servedRequestFor(forwarded, userMessage);
    expect(served.messages[0]).toEqual({
      role: 'system',
      content: STUB_SYSTEM_PROMPT,
    });

    await expect
      .poll(async () => {
        const logs = await getLogs(request, configured.skillId);
        const logged = logs.find((log) =>
          log.ai_provider_request_log?.request_body.messages?.some(
            (message) => message.content === userMessage,
          ),
        );
        return logged?.original_system_prompt;
      })
      .toBe('You are a restaurant concierge.');
  });

  test('records the configuration that served the request, and filters by it', async ({
    request,
  }) => {
    /**
     * The log row keeps `cluster_id`, which names the partition but not
     * which of its configurations was pulled, and the prompt that reached
     * the provider is that configuration's template already rendered -- so
     * the arm cannot be recovered afterwards. It is recorded on the log
     * instead, and `arm_id` filters on it: `json_extract` on SQLite, a
     * `metadata->served_configuration->>id` path on PostgREST. Two
     * hand-written translations of one filter, so both are checked.
     */
    const userMessage = 'which configuration answered this';
    const response = await request.post(CHAT_COMPLETIONS_PATH, {
      headers: {
        'sa-config': optimizedConfig(
          configured.agentName,
          configured.skillName,
        ),
      },
      data: chatBody(userMessage),
    });
    expect(response.status()).toBe(200);

    const loggedRequest = async (): Promise<LoggedRequest | undefined> =>
      (await getLogs(request, configured.skillId)).find((log) =>
        log.ai_provider_request_log?.request_body.messages?.some(
          (message) => message.content === userMessage,
        ),
      );

    await expect
      .poll(async () => (await loggedRequest())?.metadata.served_configuration)
      .toBeDefined();

    const logged = await loggedRequest();
    const served = logged?.metadata.served_configuration as {
      id: string;
      name: string;
    };
    const arms = await getArms(request, configured.skillId);
    const pulled = arms.find((arm) => arm.id === served.id);
    expect(
      pulled,
      'the log names a configuration this skill does not have',
    ).toBeDefined();
    expect(served.name).toBe(pulled?.name);

    const byArm = await getLogsByArm(request, served.id);
    expect(byArm.map((log) => log.id)).toContain(logged?.id);

    const byOtherArm = await getLogsByArm(
      request,
      '00000000-0000-4000-8000-000000000000',
    );
    expect(byOtherArm).toEqual([]);
  });

  test('embeds the request through the embedding skill', async ({
    request,
  }) => {
    // Routing to a cluster is a cosine comparison against the request's
    // embedding, so without this call the optimized path cannot run at all --
    // it falls back and reports that no provider was configured.
    expect(
      await stubRequests(request, configured.embeddingModel),
    ).not.toHaveLength(0);
  });
});

/** A chat completion to the agent-only path, with a plain (unoptimized) target. */
const chatToAgent = (
  request: APIRequestContext,
  agent: string,
  textModel: string,
  systemPrompt: string,
  content: string,
  config: Record<string, unknown> = {},
) =>
  request.post(`/v1/agents/${agent}/chat/completions`, {
    headers: {
      'sa-config': JSON.stringify({
        ...config,
        targets: [
          { provider: 'ollama', custom_host: STUB_URL, model: textModel },
        ],
      }),
    },
    data: {
      model: 'ignored-by-the-gateway',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content },
      ],
    },
  });

/**
 * How the log carrying `content` under `skillId` says its skill was chosen:
 * the routing method, `named` when the caller named it, or undefined when no
 * such log exists (yet -- logs are written after the response).
 */
const decisionFor = async (
  request: APIRequestContext,
  skillId: string,
  content: string,
): Promise<string | undefined> => {
  const logs = await getLogs(request, skillId);
  // A row still running has no provider exchange to match against yet.
  const log = logs.find((entry) =>
    entry.ai_provider_request_log?.request_body.messages?.some(
      (message) => message.content === content,
    ),
  );
  if (!log) {
    return undefined;
  }
  const routing = log.metadata.skill_routing as { method: string } | undefined;
  return routing?.method ?? 'named';
};

/**
 * Routing when the caller names only the agent (`/v1/agents/:agent_name/...`).
 *
 * In this file rather than its own because choosing between several skills
 * goes through the embedding model in system settings -- the global row the
 * loop above also configures -- and spec files run in parallel.
 */
test.describe('skill routing', () => {
  let stub: StubModels;
  let agentName: string;
  let translate: Skill;
  let sql: Skill;

  test.beforeAll(async ({ request }, testInfo) => {
    const scope =
      `route-${testInfo.project.name.replace(/[^a-z0-9]+/gi, '-')}`.toLowerCase();
    stub = await setUpStubModels(request, scope);

    // Skills made by hand, so creation stays out of these tests.
    const agent = await createAgent(
      request,
      uniqueAgentName(scope),
      undefined,
      {
        auto_create_skills: false,
      },
    );
    agentName = agent.name;
    // The stub embeds a `vec(...)` marker verbatim, so each description pins
    // its skill to an axis and a request picks one by carrying the same.
    translate = await createSkill(request, agent.id, 'translate', {
      description:
        'Translates whatever the user sends into another language. vec(1,0,0,0,0,0,0,0)',
    });
    sql = await createSkill(request, agent.id, 'write_sql', {
      description:
        'Writes SQL queries against the analytics warehouse. vec(0,1,0,0,0,0,0,0)',
    });
  });

  test('routes a request to the skill its intent is closest to', async ({
    request,
  }) => {
    const response = await chatToAgent(
      request,
      agentName,
      stub.textModel,
      'Translate the message. vec(1,0,0,0,0,0,0,0)',
      'hola mundo',
    );

    expect(response.status()).toBe(200);
    await expect
      .poll(() => decisionFor(request, translate.id, 'hola mundo'))
      .toBe('embedding');
    expect(await decisionFor(request, sql.id, 'hola mundo')).toBeUndefined();
  });

  test('tells the skills apart by the prompt, not by creation order', async ({
    request,
  }) => {
    const response = await chatToAgent(
      request,
      agentName,
      stub.textModel,
      'Write the query. vec(0,1,0,0,0,0,0,0)',
      'monthly revenue',
    );

    expect(response.status()).toBe(200);
    await expect
      .poll(() => decisionFor(request, sql.id, 'monthly revenue'))
      .toBe('embedding');
  });

  test('still honours a skill named in the header', async ({ request }) => {
    // A translate-shaped prompt sent to the SQL skill by name: the name wins.
    const response = await chatToAgent(
      request,
      agentName,
      stub.textModel,
      'Translate the message. vec(1,0,0,0,0,0,0,0)',
      'buenos dias',
      { skill_name: sql.name },
    );

    expect(response.status()).toBe(200);
    await expect
      .poll(() => decisionFor(request, sql.id, 'buenos dias'))
      .toBe('named');
  });

  test('uses the only skill of an agent that does not create skills', async ({
    request,
  }) => {
    const agent = await createAgent(
      request,
      uniqueAgentName('route-single'),
      undefined,
      { auto_create_skills: false },
    );
    const only = await createSkill(request, agent.id, 'only_skill');

    const response = await chatToAgent(
      request,
      agent.name,
      stub.textModel,
      'Anything.',
      'ping',
    );

    expect(response.status()).toBe(200);
    await expect
      .poll(() => decisionFor(request, only.id, 'ping'))
      .toBe('only_skill');
  });

  test('refuses an agent that has no skills and does not create them', async ({
    request,
  }) => {
    const agent = await createAgent(
      request,
      uniqueAgentName('route-empty'),
      undefined,
      { auto_create_skills: false },
    );

    const response = await chatToAgent(
      request,
      agent.name,
      stub.textModel,
      'Anything.',
      'ping',
    );

    expect(response.status()).toBe(404);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain('has no skills');
  });

  test('learns what a skill is for from a request that names it', async ({
    request,
  }) => {
    const agent = await createAgent(
      request,
      uniqueAgentName('route-learn'),
      undefined,
      { auto_create_skills: false },
    );
    const translate = await createSkill(request, agent.id, 'translate', {
      description:
        'Translates whatever the user sends into another language. vec(1,0,0,0,0,0,0,0)',
    });
    const sql = await createSkill(request, agent.id, 'write_sql', {
      description:
        'Writes SQL queries against the analytics warehouse. vec(0,1,0,0,0,0,0,0)',
    });
    // Closer to translate's description than to sql's -- so by description
    // alone this prompt would be routed to translate.
    const prompt = 'Report on the data. vec(0.8,0.6,0,0,0,0,0,0)';

    const named = await chatToAgent(
      request,
      agent.name,
      stub.textModel,
      prompt,
      'sales last week',
      { skill_name: sql.name },
    );
    expect(named.status()).toBe(200);
    // The router learns once the response is out; the row says when it has.
    await expect
      .poll(
        async () =>
          (await getSkillRoutings(request, agent.id)).find(
            (row) => row.skill_id === sql.id,
          )?.sample_count,
      )
      .toBe(1);

    const routed = await chatToAgent(
      request,
      agent.name,
      stub.textModel,
      prompt,
      'sales this week',
    );
    expect(routed.status()).toBe(200);
    await expect
      .poll(() => decisionFor(request, sql.id, 'sales this week'))
      .toBe('embedding');
    expect(
      await decisionFor(request, translate.id, 'sales this week'),
    ).toBeUndefined();
  });
});

/**
 * Skills the gateway creates for requests that resemble none of the agent's.
 * Serial with the block above for the same reason: system settings.
 */
test.describe('skill creation', () => {
  let stub: StubModels;
  let agent: Agent;
  const conciergePrompt =
    'You are a restaurant concierge. vec(1,0,0,0,0,0,0,0)';

  test.beforeAll(async ({ request }, testInfo) => {
    const scope =
      `create-${testInfo.project.name.replace(/[^a-z0-9]+/gi, '-')}`.toLowerCase();
    stub = await setUpStubModels(request, scope);
    agent = await createAgent(request, uniqueAgentName(scope));
    // What the created skills start with; without it they could not serve an
    // optimized request.
    await addModelsToAgent(request, agent.id, [stub.textId]);
  });

  test('creates the first skill from the first request, seeded with its prompt', async ({
    request,
  }) => {
    const response = await chatToAgent(
      request,
      agent.name,
      stub.textModel,
      conciergePrompt,
      'a table for two',
    );
    expect(response.status()).toBe(200);

    const skills = await getSkills(request, { agent_id: agent.id });
    expect(skills).toHaveLength(1);
    const [created] = skills;
    expect(created.auto_created).toBe(true);
    expect(created.seed_system_prompt).toBe(conciergePrompt);
    expect(created.optimize).toBe(true);

    // Day one is a pass-through: every arm carries the caller's own prompt.
    const arms = await getArms(request, created.id);
    expect(arms.length).toBeGreaterThan(0);
    for (const arm of arms) {
      expect(arm.params.system_prompt).toBe(conciergePrompt);
    }

    await expect
      .poll(() => decisionFor(request, created.id, 'a table for two'))
      .toBe('created');
  });

  test('serves an optimized request through the new skill with the caller prompt', async ({
    request,
  }) => {
    // No sa-config at all: the plainest possible client, so the target is the
    // optimized configuration and the arm's prompt is what reaches the provider.
    const response = await request.post(
      `/v1/agents/${agent.name}/chat/completions`,
      {
        data: {
          model: 'ignored-by-the-gateway',
          messages: [
            { role: 'system', content: conciergePrompt },
            { role: 'user', content: 'a table for four' },
          ],
        },
      },
    );

    expect(response.status()).toBe(200);
    expect(await getSkills(request, { agent_id: agent.id })).toHaveLength(1);

    const forwarded = await stubRequests(request, stub.textModel);
    const served = servedRequestFor(forwarded, 'a table for four');
    expect(served.messages[0]).toEqual({
      role: 'system',
      content: conciergePrompt,
    });
    expect(served.messages[1].content).toBe('a table for four');
  });

  test('gives a request unlike any skill a skill of its own', async ({
    request,
  }) => {
    const response = await chatToAgent(
      request,
      agent.name,
      stub.textModel,
      'You write SQL for the warehouse. vec(0,1,0,0,0,0,0,0)',
      'monthly revenue by region',
    );

    expect(response.status()).toBe(200);
    const skills = await getSkills(request, { agent_id: agent.id });
    expect(skills).toHaveLength(2);
    expect(new Set(skills.map((skill) => skill.name)).size).toBe(2);
    expect(skills.every((skill) => skill.auto_created)).toBe(true);

    // The arbiter was asked before anything was created: its call went
    // through the reflection model in system settings, which is the stub.
    const forwarded = await stubRequests(request, stub.textModel);
    expect(JSON.stringify(forwarded)).toContain(
      'You route requests for an AI gateway agent',
    );
  });

  test('stops creating at the agent cap and routes to the closest skill', async ({
    request,
  }) => {
    const patched = await request.patch(`${AGENTS_PATH}/${agent.id}`, {
      data: { max_auto_created_skills: 2 },
    });
    expect(patched.status()).toBe(200);

    const response = await chatToAgent(
      request,
      agent.name,
      stub.textModel,
      'You draw pictures. vec(0,0,1,0,0,0,0,0)',
      'a cat on a mat',
    );

    expect(response.status()).toBe(200);
    expect(await getSkills(request, { agent_id: agent.id })).toHaveLength(2);
  });

  test('gives default models added later to a skill created without them', async ({
    request,
  }) => {
    // An agent with nothing to give its skills: the first request still
    // creates one, but it cannot serve until the agent has default models.
    // No sa-config, as the plainest client sends: a named target would be
    // served as it is, and it is the optimized configuration that needs arms.
    const bare = await createAgent(request, uniqueAgentName('create-bare'));
    const prompt = 'You are a florist. vec(0,0,0,0,1,0,0,0)';
    const plainChat = (content: string) =>
      request.post(`/v1/agents/${bare.name}/chat/completions`, {
        data: {
          model: 'ignored-by-the-gateway',
          messages: [
            { role: 'system', content: prompt },
            { role: 'user', content },
          ],
        },
      });

    const refused = await plainChat('a bouquet');
    expect(refused.status()).toBe(422);
    const body = (await refused.json()) as { error: string };
    expect(body.error).toContain('created automatically');
    expect(body.error).toContain(`agent ${bare.name} had no default models`);
    const [created] = await getSkills(request, { agent_id: bare.id });
    expect(created.auto_created).toBe(true);
    expect(await getSkillModels(request, created.id)).toEqual([]);

    // Adding the defaults is what the message asks for; it equips the skill.
    await addModelsToAgent(request, bare.id, [stub.textId]);
    expect(
      (await getSkillModels(request, created.id)).map((model) => model.id),
    ).toEqual([stub.textId]);
    const arms = await getArms(request, created.id);
    expect(arms.length).toBeGreaterThan(0);
    for (const arm of arms) {
      expect(arm.params.system_prompt).toBe(prompt);
    }

    // Its evaluations arrive in the background -- generated at creation, or
    // by the adoption above if creation could not. They are what optimization
    // scores with, so a fully ready skill has some.
    await expect
      .poll(async () => (await getSkillEvaluations(request, created.id)).length)
      .toBeGreaterThan(0);

    const served = await plainChat('another bouquet');
    expect(served.status()).toBe(200);
    expect(await getSkills(request, { agent_id: bare.id })).toHaveLength(1);
  });

  test('creates one skill for concurrent first requests', async ({
    request,
  }) => {
    const fresh = await createAgent(request, uniqueAgentName('create-race'));
    await addModelsToAgent(request, fresh.id, [stub.textId]);
    const prompt = 'You are a travel agent. vec(0,0,0,1,0,0,0,0)';
    const guests = ['one', 'two', 'three', 'four', 'five'];

    const responses = await Promise.all(
      guests.map((guest) =>
        chatToAgent(
          request,
          fresh.name,
          stub.textModel,
          prompt,
          `a trip for ${guest}`,
        ),
      ),
    );

    for (const response of responses) {
      expect(response.status()).toBe(200);
    }
    const skills = await getSkills(request, { agent_id: fresh.id });
    expect(skills).toHaveLength(1);
    // One request created the skill; the rest waited for it and were routed
    // to it, as its centroid is their very intent.
    await expect
      .poll(async () => {
        const decisions = await Promise.all(
          guests.map((guest) =>
            decisionFor(request, skills[0].id, `a trip for ${guest}`),
          ),
        );
        return decisions.sort();
      })
      .toEqual(['created', 'embedding', 'embedding', 'embedding', 'embedding']);
  });
});

/**
 * Thumbs up/down on a log is the one evaluation with a human in it: posting
 * feedback re-runs the log's evaluations with the verdict folded into the
 * judges' prompts and replaces the stored run. The loop only executes end to
 * end here -- the POST, the background re-run through the internal judge
 * skill, the run replacement in storage -- and the run replacement is a
 * storage behaviour that has to hold on both backends. It lives in this file
 * because it writes the same global system settings row as the rest.
 */
test.describe('feedback re-evaluation', () => {
  let configured: OptimizedSkill;

  test.beforeAll(async ({ request }) => {
    configured = await setUpOptimizedSkill(request, 'feedback');

    // Give the skill a judge-backed evaluation to re-run.
    const created = await request.post(
      `${SKILLS_PATH}/${configured.skillId}/evaluations`,
      { data: { methods: ['conversation_completeness'] } },
    );
    expect(created.ok()).toBe(true);
  });

  test('a thumbs down re-judges the log with the verdict as context', async ({
    request,
  }) => {
    const userMessage = 'summarize the release notes for me';
    const response = await request.post(CHAT_COMPLETIONS_PATH, {
      headers: {
        'sa-config': optimizedConfig(
          configured.agentName,
          configured.skillName,
        ),
      },
      data: chatBody(userMessage),
    });
    expect(response.status()).toBe(200);

    // The log and its realtime evaluation run are written in the background.
    let logId = '';
    await expect
      .poll(async () => {
        const logs = await getLogs(request, configured.skillId);
        const logged = logs.find((log) =>
          log.ai_provider_request_log?.request_body.messages?.some(
            (message) => message.content === userMessage,
          ),
        );
        logId = logged?.id ?? '';
        return logId;
      })
      .not.toBe('');

    const runsForLog = async (): Promise<{ id: string }[]> => {
      const runs = await request.get(
        `${SKILLS_PATH}/${configured.skillId}/evaluation-runs`,
        { params: { log_id: logId } },
      );
      return (await runs.json()) as { id: string }[];
    };

    let originalRunId = '';
    await expect
      .poll(
        async () => {
          const runs = await runsForLog();
          originalRunId = runs[0]?.id ?? '';
          return runs.length;
        },
        { timeout: 30_000 },
      )
      .toBe(1);

    // The human presses thumbs down.
    const feedback = await request.post('/v1/super-agents/feedbacks', {
      data: { log_id: logId, score: 0 },
    });
    expect(feedback.status()).toBe(201);

    // The verdict-informed run replaces the original -- still exactly one.
    await expect
      .poll(
        async () => {
          const runs = await runsForLog();
          return runs.length === 1 && runs[0].id !== originalRunId
            ? 'replaced'
            : 'waiting';
        },
        { timeout: 30_000 },
      )
      .toBe('replaced');

    // And the judge really was told: the re-run's request to the provider
    // carries the verdict note.
    const forwarded = await stubRequests(request, configured.textModel);
    const verdictCalls = forwarded.filter((body) =>
      JSON.stringify(body).includes('manually reviewed this exact response'),
    );
    expect(verdictCalls.length).toBeGreaterThan(0);
    expect(JSON.stringify(verdictCalls)).toContain('BAD output');
  });
});

/**
 * Response review, end to end: an agent whose responses another agent judges
 * before the client hears them. The reviewer answers under a model of its own
 * on the stub, so its verdicts can be scripted (`stubReply`) and its traffic
 * told from the reviewed agent's. In this file because the reviewer is reached
 * by agent name alone, which routes by intent and needs the embedding model
 * `setUpStubModels` configures.
 */
test.describe('response review', () => {
  let stub: StubModels;
  let reviewerModel: string;
  let guardScope: string;
  let reviewer: Agent;
  let reviewerSkillId: string;
  let reviewed: Agent;
  let reviewedSkillId: string;
  const created: string[] = [];

  const allow = JSON.stringify({
    verdict: 'allow',
    reason: 'Nothing to object to.',
    replacement: null,
  });
  const deny = JSON.stringify({
    verdict: 'deny',
    reason: 'Leaks a credential.',
    replacement: null,
  });
  const replace = JSON.stringify({
    verdict: 'replace',
    reason: 'Redacted the credential.',
    replacement: 'I cannot share that.',
  });

  /** What the client receives once the hooks have spoken. */
  interface Reviewed {
    choices?: { message: { content: string } }[];
    error?: {
      type: string;
      hook_id: string;
      message: string;
      reason?: string;
    };
  }

  /**
   * An agent with one skill serving through the stub under `modelId`. The
   * seed prompt is what its arms carry, so nothing is generated for it.
   */
  const servingAgent = async (
    request: APIRequestContext,
    scope: string,
    modelId: string,
    overrides: Record<string, unknown> = {},
  ) => {
    const agent = await createAgent(
      request,
      uniqueAgentName(scope),
      undefined,
      {
        auto_create_skills: false,
        ...overrides,
      },
    );
    created.push(agent.id);
    const skill = await createSkill(request, agent.id, 'only_skill', {
      seed_system_prompt: `You are ${scope}.`,
    });
    const attached = await request.post(`${SKILLS_PATH}/${skill.id}/models`, {
      data: { modelIds: [modelId] },
    });
    expect(attached.status()).toBe(201);
    return { agent, skillId: skill.id };
  };

  test.beforeAll(async ({ request }, testInfo) => {
    const scope =
      `review-${testInfo.project.name.replace(/[^a-z0-9]+/gi, '-')}`.toLowerCase();
    stub = await setUpStubModels(request, scope);

    // The reviewer answers under a model of its own, so its traffic can be
    // told from the reviewed agent's on the shared stub.
    reviewerModel = uniqueModelName(`${scope}-guard`);
    const guardModel = await request.post(MODELS_PATH, {
      data: {
        ai_provider_id: stub.providerId,
        model_name: reviewerModel,
        model_type: 'text',
      },
    });
    expect(guardModel.status()).toBe(201);
    const { id: guardModelId } = (await guardModel.json()) as { id: string };

    guardScope = `${scope}-guard`;
    const guard = await servingAgent(request, guardScope, guardModelId);
    reviewer = guard.agent;
    reviewerSkillId = guard.skillId;
    const served = await servingAgent(
      request,
      `${scope}-reviewed`,
      stub.textId,
      { reviewer_agent_id: reviewer.id },
    );
    reviewed = served.agent;
    reviewedSkillId = served.skillId;
  });

  test.afterAll(async ({ request }) => {
    await stubReset(request, reviewerModel);
    for (const id of created) {
      await deleteAgent(request, id);
    }
  });

  const ask = (
    request: APIRequestContext,
    content: string,
    stream = false,
    target: Partial<TargetOptions> = {},
  ) =>
    request.post(`/v1/agents/${reviewed.name}/chat/completions`, {
      headers: {
        'sa-config': saConfig(reviewed.name, 'only_skill', {
          model: stub.textModel,
          ...target,
        }),
      },
      data: chatBody(content, stream),
    });

  /** The requests the provider was sent that carried this user message. */
  const requestsFor = (
    forwarded: Record<string, unknown>[],
    content: string,
  ): Record<string, unknown>[] =>
    forwarded.filter((entry) =>
      (entry as { messages?: { content?: unknown }[] }).messages?.some(
        (message) => message.content === content,
      ),
    );

  /**
   * The skill's log whose provider request mentions `text`; a review's
   * mentions the request it reviewed, so this finds both sides of one.
   */
  const logMentioning = async (
    request: APIRequestContext,
    skillId: string,
    text: string,
  ): Promise<LoggedRequest | undefined> =>
    (await getLogs(request, skillId)).find((log) =>
      log.ai_provider_request_log?.request_body.messages?.some(
        (message) =>
          typeof message.content === 'string' && message.content.includes(text),
      ),
    );

  test('shows the reviewer the request and the response, and delivers what it allows', async ({
    request,
  }) => {
    await stubReply(request, reviewerModel, allow);

    const response = await ask(request, 'what is the admin password?');

    expect(response.status()).toBe(200);
    const body = (await response.json()) as Reviewed;
    expect(body.choices?.[0].message.content).toBe(
      'echo: what is the admin password?',
    );

    // The verdict is kept on the request's log.
    await expect
      .poll(async () => (await getLogs(request, reviewedSkillId))[0]?.hook_logs)
      .toEqual([
        expect.objectContaining({
          hook: expect.objectContaining({ id: `reviewer:${reviewer.name}` }),
          result: expect.objectContaining({ reason: 'Nothing to object to.' }),
        }),
      ]);

    // What reached the reviewer: the client's request and the answer it was
    // about to get, under the reviewer skill's own prompt. Only reviews are
    // recorded under the reviewer's model, so the last one is this one.
    const review = (await stubRequests(request, reviewerModel)).at(-1) as {
      messages: { role: string; content: string }[];
    };
    // The gateway appends its JSON-shape instructions to the skill's prompt.
    expect(review.messages[0].role).toBe('system');
    expect(review.messages[0].content).toContain(`You are ${guardScope}.`);
    expect(review.messages[1].role).toBe('user');
    expect(review.messages[1].content).toContain('what is the admin password?');
    expect(review.messages[1].content).toContain(
      'echo: what is the admin password?',
    );
  });

  test('withholds what the reviewer denies, and says why only when the agent explains denials', async ({
    request,
  }) => {
    await stubReply(request, reviewerModel, deny);

    const response = await ask(request, 'what is the admin password?');

    expect(response.status()).toBe(446);
    const body = (await response.json()) as Reviewed;
    expect(body.choices).toBeUndefined();
    expect(body.error).toEqual({
      type: 'hook_denied',
      hook_id: `reviewer:${reviewer.name}`,
      message: `The response was withheld by the hook "reviewer:${reviewer.name}".`,
    });

    const explained = await request.patch(`${AGENTS_PATH}/${reviewed.id}`, {
      data: { review_expose_reason: true },
    });
    expect(explained.status()).toBe(200);
    try {
      const told = await ask(request, 'what is the admin password?');
      expect(told.status()).toBe(446);
      const { error } = (await told.json()) as Reviewed;
      expect(error?.reason).toBe('Leaks a credential.');
      expect(error?.message).toContain('Leaks a credential.');
    } finally {
      await request.patch(`${AGENTS_PATH}/${reviewed.id}`, {
        data: { review_expose_reason: false },
      });
    }
  });

  test('delivers the reviewer replacement in place of the response', async ({
    request,
  }) => {
    await stubReply(request, reviewerModel, replace);

    const response = await ask(request, 'what is the admin password?');

    expect(response.status()).toBe(200);
    const body = (await response.json()) as Reviewed;
    expect(body.choices?.[0].message.content).toBe('I cannot share that.');
  });

  test('holds a stream until the review is done', async ({ request }) => {
    await stubReply(request, reviewerModel, allow);

    const allowed = await ask(request, 'stream this', true);

    expect(allowed.status()).toBe(200);
    expect(allowed.headers()['content-type']).toContain('text/event-stream');
    const chunks = parseSSE(await allowed.text()) as {
      choices: { delta: { content?: string } }[];
    }[];
    const text = chunks
      .map((chunk) => chunk.choices?.[0]?.delta?.content ?? '')
      .join('');
    expect(text).toBe('echo: stream this');

    // The provider was asked for the answer whole, so the reviewer could see
    // it whole: a held stream is a non-streaming request upstream.
    const forwarded = servedRequestFor(
      await stubRequests(request, stub.textModel),
      'stream this',
    ) as { stream?: boolean };
    expect(forwarded.stream).toBeFalsy();

    // A denial does not pretend to be a stream.
    await stubReply(request, reviewerModel, deny);
    const denied = await ask(request, 'stream this too', true);
    expect(denied.status()).toBe(446);
    expect(denied.headers()['content-type']).toContain('application/json');
  });

  test('delivers a response the reviewer could not judge, unless the review fails closed', async ({
    request,
  }) => {
    await stubReply(request, reviewerModel, 'I would rather not say.');

    const open = await ask(request, 'is this fine?');
    expect(open.status()).toBe(200);
    // The failure is on the log, which is the only place it shows.
    await expect
      .poll(
        async () =>
          (await getLogs(request, reviewedSkillId))[0]?.hook_logs?.[0]?.result,
      )
      .toEqual(
        expect.objectContaining({
          deny_request: false,
          error: expect.stringContaining('did not answer with a verdict'),
        }),
      );

    const closed = await request.patch(`${AGENTS_PATH}/${reviewed.id}`, {
      data: { review_fail_closed: true },
    });
    expect(closed.status()).toBe(200);
    try {
      const withheld = await ask(request, 'is this fine?');
      expect(withheld.status()).toBe(446);
      const body = (await withheld.json()) as Reviewed;
      expect(body.error?.hook_id).toBe(`reviewer:${reviewer.name}`);
      // Why the reviewer could not judge is on the log, not in the answer.
      expect(body.error?.reason).toBeUndefined();
    } finally {
      await request.patch(`${AGENTS_PATH}/${reviewed.id}`, {
        data: { review_fail_closed: false },
      });
    }
  });

  test('logs the review beside the request it reviewed, under the same trace', async ({
    request,
  }) => {
    await stubReply(request, reviewerModel, allow);

    const response = await ask(request, 'trace this review');
    expect(response.status()).toBe(200);

    await expect
      .poll(() => logMentioning(request, reviewerSkillId, 'trace this review'))
      .toBeDefined();
    const reviewedLog = await logMentioning(
      request,
      reviewedSkillId,
      'trace this review',
    );
    const review = await logMentioning(
      request,
      reviewerSkillId,
      'trace this review',
    );

    // A log of its own, under the reviewer's skill, that the dashboard can
    // walk to from the request: same trace, a span named for what it is.
    expect(review?.id).not.toBe(reviewedLog?.id);
    expect(review?.trace_id).toBe(reviewedLog?.trace_id);
    expect(review?.span_name).toBe('review');
    expect(review?.parent_span_id).toBe(reviewedLog?.span_id);
  });

  test('withholds a request an input hook in the header denies, before the provider is asked', async ({
    request,
  }) => {
    await stubReply(request, reviewerModel, deny);
    // The reviewer agent serves as a client-configured gate too: an input
    // hook naming it and its skill, sent in the header like any other hook.
    const gated = {
      ...(JSON.parse(
        saConfig(reviewed.name, 'only_skill', { model: stub.textModel }),
      ) as Record<string, unknown>),
      hooks: [
        {
          id: 'gate',
          type: 'input',
          hook_provider: 'agent',
          config: { agent_name: reviewer.name, skill_name: 'only_skill' },
          expose_reason: true,
        },
      ],
    };

    const response = await request.post(
      `/v1/agents/${reviewed.name}/chat/completions`,
      {
        headers: { 'sa-config': JSON.stringify(gated) },
        data: chatBody('gate this request'),
      },
    );

    expect(response.status()).toBe(446);
    expect(((await response.json()) as Reviewed).error).toEqual({
      type: 'hook_denied',
      hook_id: 'gate',
      message:
        'The request was withheld by the hook "gate": Leaks a credential.',
      reason: 'Leaks a credential.',
    });
    // The reviewer was shown the request alone, and the provider never was.
    const review = (await stubRequests(request, reviewerModel)).at(-1) as {
      messages: { content: string }[];
    };
    expect(review.messages[1].content).toContain(
      'A client sent an AI agent this request',
    );
    expect(review.messages[1].content).toContain('gate this request');
    expect(
      requestsFor(
        await stubRequests(request, stub.textModel),
        'gate this request',
      ),
    ).toHaveLength(0);
  });

  test('asks the provider again when the client retries on a denial', async ({
    request,
  }) => {
    // The first verdict denies; every one after it allows.
    await stubReply(request, reviewerModel, [deny, allow]);

    const response = await ask(request, 'try this again', false, {
      retry: { attempts: 1, on_status_codes: [446] },
    });

    expect(response.status()).toBe(200);
    expect(
      ((await response.json()) as Reviewed).choices?.[0].message.content,
    ).toBe('echo: try this again');
    // Asked twice: the attempt that was denied, then the one that was served.
    expect(
      requestsFor(
        await stubRequests(request, stub.textModel),
        'try this again',
      ),
    ).toHaveLength(2);
    // The log keeps the verdict on the attempt that was served, not both.
    await expect
      .poll(async () =>
        (
          await logMentioning(request, reviewedSkillId, 'try this again')
        )?.hook_logs?.map((entry) => entry.result.reason),
      )
      .toEqual(['Nothing to object to.']);
  });

  test('serves a repeated request from the cache as the reviewer left it', async ({
    request,
  }) => {
    await stubReply(request, reviewerModel, replace);
    const cached = { cache: { mode: 'simple' as const } };
    const reviewsBefore = (await stubRequests(request, reviewerModel)).length;

    const first = await ask(request, 'cache the verdict', false, cached);
    expect(first.status()).toBe(200);
    expect(
      ((await first.json()) as Reviewed).choices?.[0].message.content,
    ).toBe('I cannot share that.');

    const second = await ask(request, 'cache the verdict', false, cached);

    expect(second.status()).toBe(200);
    // What is cached is what the reviewer let through, not what the
    // provider said: a reviewed answer stays reviewed on every hit.
    expect(
      ((await second.json()) as Reviewed).choices?.[0].message.content,
    ).toBe('I cannot share that.');
    // One provider call and one review served both.
    expect(
      requestsFor(
        await stubRequests(request, stub.textModel),
        'cache the verdict',
      ),
    ).toHaveLength(1);
    expect((await stubRequests(request, reviewerModel)).length).toBe(
      reviewsBefore + 1,
    );
  });

  test('does not review the review, even when the reviewers point at each other', async ({
    request,
  }) => {
    // The reviewer now has the reviewed agent as its own reviewer. Without
    // the guard every review would be reviewed, forever.
    const patched = await request.patch(`${AGENTS_PATH}/${reviewer.id}`, {
      data: { reviewer_agent_id: reviewed.id },
    });
    expect(patched.status()).toBe(200);
    await stubReply(request, reviewerModel, allow);
    const reviewsBefore = (await stubRequests(request, reviewerModel)).length;

    const response = await ask(request, 'one request');

    expect(response.status()).toBe(200);
    // One review for one request, and the review itself went unreviewed.
    expect((await stubRequests(request, reviewerModel)).length).toBe(
      reviewsBefore + 1,
    );
  });
});
