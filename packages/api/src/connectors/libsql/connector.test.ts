import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AppContext } from '@api/types/hono';
import type { Client } from '@libsql/client';
import { ReasoningEffort } from '@shared/types/api/routes/shared/thinking';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createLibsqlClient, resetLibsqlClients } from './client';
import { libsqlLogsStorageConnector } from './logs';
import { migrateLibsql } from './migrate';
import { libsqlUserDataStorageConnector as store } from './user-data';

const logs = libsqlLogsStorageConnector;

/**
 * Backed by a temp file rather than `:memory:`.
 *
 * `client.transaction()` checks out a separate connection, and for an
 * in-memory database that means a separate, empty database — so
 * `updateArmAndIncrementCounters` would fail with "no such table". A file
 * database is also what the single-container deployment actually uses.
 */
const tempDirs: string[] = [];

const freshDatabase = async (): Promise<{ client: Client; c: AppContext }> => {
  resetLibsqlClients();
  const dir = mkdtempSync(join(tmpdir(), 'sa-libsql-'));
  tempDirs.push(dir);
  const url = `file:${join(dir, 'test.db')}`;

  const client = createLibsqlClient(url);
  await migrateLibsql(client);

  const c = {
    env: {
      LIBSQL_URL: url,
      AI_PROVIDER_API_KEY_ENCRYPTION_KEY: 'test-key-for-encryption-round-trip',
    },
  } as unknown as AppContext;
  return { client, c };
};

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const seedAgent = (c: AppContext) =>
  store.createAgent(c, {
    name: 'test-agent',
    description: 'x'.repeat(30),
    metadata: {},
    auto_create_skills: true,
    skill_match_threshold: 0.8,
    max_auto_created_skills: 10,
    review_fail_closed: false,
    review_expose_reason: false,
  });

const seedSkill = (c: AppContext, agentId: string) =>
  store.createSkill(c, {
    agent_id: agentId,
    name: 'test-skill',
    description: 'y'.repeat(30),
  } as Parameters<typeof store.createSkill>[1]);

const aiProviderRequestLog = {
  provider: 'openai',
  function_name: 'chat_complete',
  method: 'POST',
  request_url: 'https://api.openai.com/v1/chat/completions',
  status: 200,
  request_body: { model: 'gpt-5' },
  response_body: { id: 'chatcmpl-1' },
  raw_request_body: '{"model":"gpt-5"}',
  raw_response_body: '{"id":"chatcmpl-1"}',
  cache_mode: 'disabled',
  cache_status: 'MISS',
};

const logParams = (agentId: string, skillId: string, startTime = 1000) =>
  ({
    agent_id: agentId,
    skill_id: skillId,
    method: 'POST',
    endpoint: '/v1/chat/completions',
    function_name: 'chat_complete',
    status: 200,
    start_time: startTime,
    end_time: startTime + 50,
    duration: 50,
    base_sa_config: { agent_name: 'test-agent', skill_name: 'test-skill' },
    ai_provider: 'openai',
    model: 'gpt-5',
    ai_provider_request_log: aiProviderRequestLog,
    hook_logs: [],
    metadata: {},
    cache_status: 'MISS',
  }) as unknown as Parameters<typeof logs.createLog>[1];

/** `SkillOptimizationArmParams` requires the full normalised range set. */
const armParams = (modelId: string) => ({
  model_id: modelId,
  system_prompt: 'You are a helpful assistant.',
  temperature_min: 0,
  temperature_max: 1,
  top_p_min: 0,
  top_p_max: 1,
  top_k_min: 0,
  top_k_max: 1,
  frequency_penalty_min: 0,
  frequency_penalty_max: 1,
  presence_penalty_min: 0,
  presence_penalty_max: 1,
  thinking_min: 0,
  thinking_max: 1,
});

beforeEach(() => {
  resetLibsqlClients();
});

describe('agents, skills and JSON columns', () => {
  it('round-trips an agent, generating the id Postgres would default', async () => {
    const { c } = await freshDatabase();

    const created = await store.createAgent(c, {
      name: 'my-agent',
      description: 'd'.repeat(30),
      metadata: { team: 'core', tags: ['a', 'b'] },
      auto_create_skills: true,
      skill_match_threshold: 0.8,
      max_auto_created_skills: 10,
      review_fail_closed: false,
      review_expose_reason: false,
    });

    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(created.metadata).toEqual({ team: 'core', tags: ['a', 'b'] });

    const [fetched] = await store.getAgents(c, { id: created.id });
    expect(fetched).toEqual(created);
  });

  it('filters, limits and offsets like PostgREST', async () => {
    const { c } = await freshDatabase();
    for (const name of ['agent-a', 'agent-b', 'agent-c']) {
      await store.createAgent(c, {
        name,
        description: 'd'.repeat(30),
        metadata: {},
        auto_create_skills: true,
        skill_match_threshold: 0.8,
        max_auto_created_skills: 10,
        review_fail_closed: false,
        review_expose_reason: false,
      });
    }

    expect(await store.getAgents(c, { name: 'agent-b' })).toHaveLength(1);
    expect(await store.getAgents(c, { limit: 2 })).toHaveLength(2);
    // Offset without a limit is legal in PostgREST but not in raw SQLite.
    expect(await store.getAgents(c, { offset: 1 })).toHaveLength(2);
  });

  it('updates an agent and refreshes updated_at', async () => {
    const { c } = await freshDatabase();
    const agent = await seedAgent(c);

    const updated = await store.updateAgent(c, agent.id, {
      description: 'z'.repeat(30),
    });

    expect(updated.description).toBe('z'.repeat(30));
    // Would be the pre-trigger value if the update used RETURNING.
    expect(Date.parse(updated.updated_at)).toBeGreaterThanOrEqual(
      Date.parse(agent.updated_at),
    );
    expect(updated.updated_at).toMatch(/Z$/);
  });

  it('cascades a delete from agent to skill', async () => {
    const { c } = await freshDatabase();
    const agent = await seedAgent(c);
    await seedSkill(c, agent.id);

    await store.deleteAgent(c, agent.id);

    expect(await store.getSkills(c, {})).toHaveLength(0);
  });

  it('round-trips the boolean and array columns on a skill', async () => {
    const { c } = await freshDatabase();
    const agent = await seedAgent(c);
    const skill = await seedSkill(c, agent.id);

    // `optimize` is INTEGER 0/1 in SQLite but boolean in the schema.
    expect(skill.optimize).toBe(true);
    expect(skill.allowed_template_variables).toEqual([]);

    const updated = await store.updateSkill(c, skill.id, {
      optimize: false,
      allowed_template_variables: ['datetime', 'user'],
    } as Parameters<typeof store.updateSkill>[2]);

    expect(updated.optimize).toBe(false);
    expect(updated.allowed_template_variables).toEqual(['datetime', 'user']);
  });
});

describe('ai providers', () => {
  it('encrypts the api key at rest and decrypts on read', async () => {
    const { client, c } = await freshDatabase();

    const created = await store.createAIProvider(c, {
      ai_provider: 'openai',
      name: 'default',
      api_key: 'sk-secret-value',
      custom_fields: {},
    } as Parameters<typeof store.createAIProvider>[1]);

    expect(created.api_key).toBe('sk-secret-value');

    const raw = await client.execute('SELECT api_key FROM ai_providers');
    expect(String(raw.rows[0].api_key)).not.toContain('sk-secret-value');
    expect(String(raw.rows[0].api_key)).toMatch(
      /^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/,
    );

    const fetched = await store.getAIProviderAPIKeyById(c, created.id);
    expect(fetched?.api_key).toBe('sk-secret-value');
  });

  it('returns null for an unknown provider id', async () => {
    const { c } = await freshDatabase();
    expect(
      await store.getAIProviderAPIKeyById(
        c,
        '00000000-0000-4000-8000-00000000dead',
      ),
    ).toBeNull();
  });

  it('re-encrypts on update', async () => {
    const { c } = await freshDatabase();
    const created = await store.createAIProvider(c, {
      ai_provider: 'openai',
      name: 'default',
      api_key: 'sk-first',
      custom_fields: {},
    } as Parameters<typeof store.createAIProvider>[1]);

    const updated = await store.updateAIProvider(c, created.id, {
      api_key: 'sk-second',
    } as Parameters<typeof store.updateAIProvider>[2]);

    expect(updated.api_key).toBe('sk-second');
  });
});

describe('skill-model bridge', () => {
  const seedModel = async (c: AppContext, name: string) => {
    const provider = await store.createAIProvider(c, {
      ai_provider: 'openai',
      name: `provider-${name}`,
      api_key: null,
      custom_fields: {},
    } as Parameters<typeof store.createAIProvider>[1]);

    return store.createModel(c, {
      ai_provider_id: provider.id,
      model_name: name,
    } as Parameters<typeof store.createModel>[1]);
  };

  it('joins through the bridge in both directions', async () => {
    const { c } = await freshDatabase();
    const agent = await seedAgent(c);
    const skill = await seedSkill(c, agent.id);
    const model = await seedModel(c, 'gpt-5');

    await store.addModelsToSkill(c, skill.id, [model.id]);

    const models = await store.getSkillModels(c, skill.id);
    expect(models.map((m) => m.id)).toEqual([model.id]);

    const skills = await store.getSkillsByModelId(c, model.id);
    expect(skills.map((s) => s.id)).toEqual([skill.id]);
  });

  it('is idempotent when adding the same model twice', async () => {
    const { c } = await freshDatabase();
    const agent = await seedAgent(c);
    const skill = await seedSkill(c, agent.id);
    const model = await seedModel(c, 'gpt-5');

    await store.addModelsToSkill(c, skill.id, [model.id]);
    await store.addModelsToSkill(c, skill.id, [model.id]);

    expect(await store.getSkillModels(c, skill.id)).toHaveLength(1);
  });

  it('removes only the named models', async () => {
    const { c } = await freshDatabase();
    const agent = await seedAgent(c);
    const skill = await seedSkill(c, agent.id);
    const a = await seedModel(c, 'gpt-5');
    const b = await seedModel(c, 'claude-sonnet-5');

    await store.addModelsToSkill(c, skill.id, [a.id, b.id]);
    await store.removeModelsFromSkill(c, skill.id, [a.id]);

    expect((await store.getSkillModels(c, skill.id)).map((m) => m.id)).toEqual([
      b.id,
    ]);
  });

  it('tolerates an empty model list', async () => {
    const { c } = await freshDatabase();
    const agent = await seedAgent(c);
    const skill = await seedSkill(c, agent.id);

    await expect(
      store.addModelsToSkill(c, skill.id, []),
    ).resolves.toBeUndefined();
    await expect(
      store.removeModelsFromSkill(c, skill.id, []),
    ).resolves.toBeUndefined();
  });
});

/** The five plpgsql functions the API actually calls, reimplemented in TS. */
describe('atomic operations', () => {
  it('increments the skill request counter', async () => {
    const { c } = await freshDatabase();
    const agent = await seedAgent(c);
    const skill = await seedSkill(c, agent.id);

    expect(skill.total_requests).toBe(0);
    expect(
      (await store.incrementSkillTotalRequests(c, skill.id)).total_requests,
    ).toBe(1);
    expect(
      (await store.incrementSkillTotalRequests(c, skill.id)).total_requests,
    ).toBe(2);
  });

  it('increments both cluster counters together', async () => {
    const { c } = await freshDatabase();
    const agent = await seedAgent(c);
    const skill = await seedSkill(c, agent.id);
    const [cluster] = await store.createSkillOptimizationClusters(c, [
      {
        agent_id: agent.id,
        skill_id: skill.id,
        name: 'cluster-0',
        centroid: [0.1, 0.2],
      } as Parameters<typeof store.createSkillOptimizationClusters>[1][number],
    ]);

    // The centroid is a FLOAT[] in Postgres and JSON text here.
    expect(cluster.centroid).toEqual([0.1, 0.2]);

    const bumped = await store.incrementClusterCounters(c, cluster.id);
    expect(bumped.total_steps).toBe(1);
    expect(bumped.observability_total_requests).toBe(1);
  });

  it('acquires the reclustering lock only once while it is held', async () => {
    const { client, c } = await freshDatabase();
    const agent = await seedAgent(c);
    const skill = await seedSkill(c, agent.id);

    const first = await store.tryAcquireReclusteringLock(c, skill.id, 60_000);
    expect(first).not.toBeNull();
    expect(first?.last_clustering_at).not.toBeNull();

    // Still inside the threshold, so the second caller is turned away.
    const second = await store.tryAcquireReclusteringLock(c, skill.id, 60_000);
    expect(second).toBeNull();

    // Backdate the lock rather than passing a zero threshold: with zero, the
    // cutoff equals the timestamp just written and the comparison is strict,
    // so the outcome would depend on the clock ticking between the two calls.
    await client.execute({
      sql: 'UPDATE skills SET last_clustering_at = ? WHERE id = ?',
      args: ['2000-01-01T00:00:00.000Z', skill.id],
    });

    const third = await store.tryAcquireReclusteringLock(c, skill.id, 60_000);
    expect(third).not.toBeNull();
  });

  describe('updateArmAndIncrementCounters', () => {
    const setup = async () => {
      const { client, c } = await freshDatabase();
      const agent = await seedAgent(c);
      const skill = await seedSkill(c, agent.id);
      const provider = await store.createAIProvider(c, {
        ai_provider: 'openai',
        name: 'arm-provider',
        api_key: null,
        custom_fields: {},
      } as Parameters<typeof store.createAIProvider>[1]);
      const model = await store.createModel(c, {
        ai_provider_id: provider.id,
        model_name: 'gpt-5',
      } as Parameters<typeof store.createModel>[1]);
      const [cluster] = await store.createSkillOptimizationClusters(c, [
        {
          agent_id: agent.id,
          skill_id: skill.id,
          name: 'cluster-0',
          centroid: [0],
        } as Parameters<
          typeof store.createSkillOptimizationClusters
        >[1][number],
      ]);
      const [arm] = await store.createSkillOptimizationArms(c, [
        {
          agent_id: agent.id,
          skill_id: skill.id,
          cluster_id: cluster.id,
          name: 'arm-0',
          params: armParams(model.id),
        } as Parameters<typeof store.createSkillOptimizationArms>[1][number],
      ]);
      const [evaluation] = await store.createSkillOptimizationEvaluations(c, [
        {
          agent_id: agent.id,
          skill_id: skill.id,
          evaluation_method: 'task_completion',
          weight: 1,
          params: {},
        } as Parameters<
          typeof store.createSkillOptimizationEvaluations
        >[1][number],
      ]);
      return { client, c, agent, skill, cluster, arm, evaluation };
    };

    it('creates stats on first use and moves all three counters', async () => {
      const { c, arm, evaluation } = await setup();

      const result = await store.updateArmAndIncrementCounters(c, arm.id, [
        { evaluation_id: evaluation.id, score: 0.8 },
      ]);

      expect(result.cluster.total_steps).toBe(1);
      expect(result.cluster.observability_total_requests).toBe(1);
      expect(result.skill.total_requests).toBe(1);
      expect(result.arm.id).toBe(arm.id);

      const [stat] = await store.getSkillOptimizationArmStats(c, {
        arm_id: arm.id,
      });
      expect(stat.n).toBe(1);
      expect(stat.mean).toBeCloseTo(0.8, 10);
      expect(stat.total_reward).toBeCloseTo(0.8, 10);
      expect(stat.n2).toBeCloseTo(0.64, 10);
    });

    it('applies the incremental mean and n2 formulas across calls', async () => {
      const { c, arm, evaluation } = await setup();

      await store.updateArmAndIncrementCounters(c, arm.id, [
        { evaluation_id: evaluation.id, score: 1.0 },
      ]);
      await store.updateArmAndIncrementCounters(c, arm.id, [
        { evaluation_id: evaluation.id, score: 0.0 },
      ]);

      const [stat] = await store.getSkillOptimizationArmStats(c, {
        arm_id: arm.id,
      });
      expect(stat.n).toBe(2);
      expect(stat.total_reward).toBeCloseTo(1.0, 10);
      expect(stat.mean).toBeCloseTo(0.5, 10);
      // n2 accumulates squares: 1^2 + 0^2
      expect(stat.n2).toBeCloseTo(1.0, 10);
    });

    it('updates one stat row per evaluation but bumps counters once', async () => {
      const { c, agent, skill, arm, evaluation } = await setup();
      const [second] = await store.createSkillOptimizationEvaluations(c, [
        {
          agent_id: agent.id,
          skill_id: skill.id,
          evaluation_method: 'latency',
          weight: 1,
          params: {},
        } as Parameters<
          typeof store.createSkillOptimizationEvaluations
        >[1][number],
      ]);

      const result = await store.updateArmAndIncrementCounters(c, arm.id, [
        { evaluation_id: evaluation.id, score: 1.0 },
        { evaluation_id: second.id, score: 0.5 },
      ]);

      expect(result.cluster.total_steps).toBe(1);
      expect(result.skill.total_requests).toBe(1);
      expect(
        await store.getSkillOptimizationArmStats(c, { arm_id: arm.id }),
      ).toHaveLength(2);
    });

    it('rolls back completely when the arm does not exist', async () => {
      const { c, skill } = await setup();

      await expect(
        store.updateArmAndIncrementCounters(
          c,
          '00000000-0000-4000-8000-00000000dead',
          [{ evaluation_id: 'irrelevant', score: 1 }],
        ),
      ).rejects.toThrow(/not found/);

      const [unchanged] = await store.getSkills(c, { id: skill.id });
      expect(unchanged.total_requests).toBe(0);
    });
  });
});

describe('agent models and routing settings', () => {
  const seedModel = async (c: AppContext, name: string) => {
    const provider = await store.createAIProvider(c, {
      ai_provider: 'openai',
      name: `provider-${name}`,
      api_key: null,
      custom_fields: {},
    } as Parameters<typeof store.createAIProvider>[1]);

    return store.createModel(c, {
      ai_provider_id: provider.id,
      model_name: name,
    } as Parameters<typeof store.createModel>[1]);
  };

  it('round-trips the routing settings as booleans and numbers', async () => {
    const { c } = await freshDatabase();

    const agent = await store.createAgent(c, {
      name: 'growing',
      description: 'x'.repeat(30),
      metadata: {},
      auto_create_skills: false,
      skill_match_threshold: 0.65,
      max_auto_created_skills: 3,
      review_fail_closed: false,
      review_expose_reason: false,
    });
    expect(agent.auto_create_skills).toBe(false);
    expect(agent.skill_match_threshold).toBe(0.65);
    expect(agent.max_auto_created_skills).toBe(3);
    // Unset overrides come back as null, never undefined.
    expect(agent.skill_arbiter_model_id).toBeNull();
    expect(agent.skill_arbiter_timeout_ms).toBeNull();

    const updated = await store.updateAgent(c, agent.id, {
      auto_create_skills: true,
      max_auto_created_skills: 5,
      review_fail_closed: false,
      review_expose_reason: false,
      skill_arbiter_timeout_ms: 30_000,
    });
    expect(updated.auto_create_skills).toBe(true);
    expect(updated.max_auto_created_skills).toBe(5);
    expect(updated.skill_arbiter_timeout_ms).toBe(30_000);
    expect(updated.description).toBe(agent.description);

    const cleared = await store.updateAgent(c, agent.id, {
      skill_arbiter_timeout_ms: null,
    });
    expect(cleared.skill_arbiter_timeout_ms).toBeNull();
  });

  it('keeps an agent reviewer, refuses the agent itself, and forgets a deleted one', async () => {
    const { c } = await freshDatabase();
    const reviewed = await store.createAgent(c, {
      name: 'reviewed',
      description: 'x'.repeat(30),
      metadata: {},
      auto_create_skills: true,
      skill_match_threshold: 0.8,
      max_auto_created_skills: 10,
      review_fail_closed: false,
      review_expose_reason: false,
    });
    const guard = await store.createAgent(c, {
      name: 'guard',
      description: 'x'.repeat(30),
      metadata: {},
      auto_create_skills: true,
      skill_match_threshold: 0.8,
      max_auto_created_skills: 10,
      review_fail_closed: false,
      review_expose_reason: false,
    });
    expect(reviewed.reviewer_agent_id).toBeNull();
    expect(reviewed.review_fail_closed).toBe(false);

    const updated = await store.updateAgent(c, reviewed.id, {
      reviewer_agent_id: guard.id,
      review_fail_closed: true,
    });
    expect(updated.reviewer_agent_id).toBe(guard.id);
    // Stored as 0/1, read back as a boolean.
    expect(updated.review_fail_closed).toBe(true);

    await expect(
      store.updateAgent(c, reviewed.id, { reviewer_agent_id: reviewed.id }),
    ).rejects.toThrow(/CHECK constraint failed/);

    // ON DELETE SET NULL: the reviews stop; the agent stays.
    await store.deleteAgent(c, guard.id);
    const [after] = await store.getAgents(c, { id: reviewed.id });
    expect(after.reviewer_agent_id).toBeNull();
  });

  it('keeps the seed prompt and the auto-created flag on a skill', async () => {
    const { c } = await freshDatabase();
    const agent = await seedAgent(c);

    const skill = await store.createSkill(c, {
      agent_id: agent.id,
      name: 'made-by-the-gateway',
      description: 'y'.repeat(30),
      auto_created: true,
      seed_system_prompt: 'You are terse.',
    } as Parameters<typeof store.createSkill>[1]);
    expect(skill.auto_created).toBe(true);
    expect(skill.seed_system_prompt).toBe('You are terse.');

    const [byHand] = await store.getSkills(c, {
      id: (await seedSkill(c, agent.id)).id,
    });
    expect(byHand.auto_created).toBe(false);
    expect(byHand.seed_system_prompt).toBeNull();
  });

  it('joins the agent bridge like the skill one', async () => {
    const { c } = await freshDatabase();
    const agent = await seedAgent(c);
    const first = await seedModel(c, 'first');
    const second = await seedModel(c, 'second');

    await store.addModelsToAgent(c, agent.id, [first.id, second.id]);
    // Idempotent, like the skill bridge.
    await store.addModelsToAgent(c, agent.id, [first.id]);

    const models = await store.getAgentModels(c, agent.id);
    expect(models.map((model) => model.model_name).sort()).toEqual([
      'first',
      'second',
    ]);

    await store.removeModelsFromAgent(c, agent.id, [first.id]);
    expect(
      (await store.getAgentModels(c, agent.id)).map((m) => m.model_name),
    ).toEqual(['second']);

    await store.deleteAgent(c, agent.id);
    expect(await store.getAgentModels(c, agent.id)).toEqual([]);
  });
});

describe('skill routing', () => {
  const seedEmbeddingModel = async (c: AppContext) => {
    const provider = await store.createAIProvider(c, {
      ai_provider: 'openai',
      name: 'provider-embed',
      api_key: null,
      custom_fields: {},
    } as Parameters<typeof store.createAIProvider>[1]);

    return store.createModel(c, {
      ai_provider_id: provider.id,
      model_name: 'embed',
      model_type: 'embed',
      embedding_dimensions: 3,
    } as Parameters<typeof store.createModel>[1]);
  };

  it('upserts on the skill and reads the centroid back as numbers', async () => {
    const { c } = await freshDatabase();
    const agent = await seedAgent(c);
    const skill = await seedSkill(c, agent.id);
    const model = await seedEmbeddingModel(c);

    const seeded = await store.upsertSkillRouting(c, {
      skill_id: skill.id,
      agent_id: agent.id,
      centroid: [1, 0, 0],
      conversation_centroid: null,
      embedding_model_id: model.id,
      sample_count: 1,
      conversation_sample_count: 0,
    });
    expect(seeded.centroid).toEqual([1, 0, 0]);
    expect(seeded.conversation_centroid).toBeNull();
    expect(seeded.sample_count).toBe(1);
    expect(seeded.conversation_sample_count).toBe(0);

    const advanced = await store.upsertSkillRouting(c, {
      skill_id: skill.id,
      agent_id: agent.id,
      centroid: [0.5, 0.5, 0],
      conversation_centroid: [0, 1, 0],
      embedding_model_id: model.id,
      sample_count: 2,
      conversation_sample_count: 1,
    });
    expect(advanced.centroid).toEqual([0.5, 0.5, 0]);
    expect(advanced.conversation_centroid).toEqual([0, 1, 0]);
    expect(advanced.sample_count).toBe(2);
    expect(advanced.conversation_sample_count).toBe(1);
    expect(advanced.created_at).toBe(seeded.created_at);

    expect(await store.getSkillRoutings(c, { agent_id: agent.id })).toEqual([
      advanced,
    ]);
  });

  it('goes with its skill', async () => {
    const { c } = await freshDatabase();
    const agent = await seedAgent(c);
    const skill = await seedSkill(c, agent.id);
    const model = await seedEmbeddingModel(c);

    await store.upsertSkillRouting(c, {
      skill_id: skill.id,
      agent_id: agent.id,
      centroid: [1, 0, 0],
      conversation_centroid: null,
      embedding_model_id: model.id,
      sample_count: 1,
      conversation_sample_count: 0,
    });
    await store.deleteSkill(c, skill.id);

    expect(await store.getSkillRoutings(c, { agent_id: agent.id })).toEqual([]);
  });
});

describe('skill creation lease', () => {
  const at = (offsetMs: number) =>
    new Date(Date.parse('2026-08-29T10:00:00.000Z') + offsetMs).toISOString();

  it('is claimed by one of two claimants, then by the next once released', async () => {
    const { c } = await freshDatabase();
    const agent = await seedAgent(c);

    expect(
      await store.claimSkillCreationLease(c, agent.id, 'a', at(0), at(45_000)),
    ).toBe(true);
    expect(
      await store.claimSkillCreationLease(
        c,
        agent.id,
        'b',
        at(100),
        at(45_100),
      ),
    ).toBe(false);

    await store.releaseSkillCreationLease(c, agent.id, 'a');

    expect(
      await store.claimSkillCreationLease(
        c,
        agent.id,
        'b',
        at(200),
        at(45_200),
      ),
    ).toBe(true);
  });

  it('counts a lease past its time as free', async () => {
    const { c } = await freshDatabase();
    const agent = await seedAgent(c);
    await store.claimSkillCreationLease(c, agent.id, 'a', at(0), at(45_000));

    expect(
      await store.claimSkillCreationLease(
        c,
        agent.id,
        'b',
        at(45_001),
        at(90_001),
      ),
    ).toBe(true);
  });

  it('is only released by its holder', async () => {
    const { c } = await freshDatabase();
    const agent = await seedAgent(c);
    await store.claimSkillCreationLease(c, agent.id, 'a', at(0), at(45_000));

    // A claimant whose lease expired, releasing late, must not free the new one.
    await store.releaseSkillCreationLease(c, agent.id, 'stale');

    expect(
      await store.claimSkillCreationLease(
        c,
        agent.id,
        'b',
        at(100),
        at(45_100),
      ),
    ).toBe(false);
  });

  it('goes with its agent', async () => {
    const { c, client } = await freshDatabase();
    const agent = await seedAgent(c);
    await store.claimSkillCreationLease(c, agent.id, 'a', at(0), at(45_000));

    await store.deleteAgent(c, agent.id);

    const rows = await client.execute(
      'SELECT agent_id FROM skill_creation_leases',
    );
    expect(rows.rows).toHaveLength(0);
  });
});

describe('logs', () => {
  it('round-trips a log through the eval-scores view', async () => {
    const { c } = await freshDatabase();
    const agent = await seedAgent(c);
    const skill = await seedSkill(c, agent.id);

    const created = await logs.createLog(c, logParams(agent.id, skill.id));
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);

    const [fetched] = await logs.getLogs(c, { id: created.id });
    expect(fetched.model).toBe('gpt-5');
    expect(fetched.base_sa_config).toEqual({
      agent_name: 'test-agent',
      skill_name: 'test-skill',
    });
  });

  it('keeps the caller system prompt beside the provider-bound body', async () => {
    const { c } = await freshDatabase();
    const agent = await seedAgent(c);
    const skill = await seedSkill(c, agent.id);

    const created = await logs.createLog(c, {
      ...logParams(agent.id, skill.id),
      original_system_prompt: 'You are a terse assistant.',
    });
    const bare = await logs.createLog(c, logParams(agent.id, skill.id));

    const [fetched] = await logs.getLogs(c, { id: created.id });
    expect(fetched.original_system_prompt).toBe('You are a terse assistant.');

    // A log without one must come back as null, not undefined.
    const [fetchedBare] = await logs.getLogs(c, { id: bare.id });
    expect(fetchedBare.original_system_prompt).toBeNull();
  });

  it('filters by the configuration that served the request', async () => {
    const { c } = await freshDatabase();
    const agent = await seedAgent(c);
    const skill = await seedSkill(c, agent.id);
    const armId = '11111111-1111-4111-8111-111111111111';

    // No `arm_id` column: the arm is matched inside the metadata, where the
    // gateway records it.
    const served = await logs.createLog(c, {
      ...logParams(agent.id, skill.id),
      metadata: { served_configuration: { id: armId, name: '7' } },
    } as Parameters<typeof logs.createLog>[1]);
    await logs.createLog(c, logParams(agent.id, skill.id));

    const matched = await logs.getLogs(c, { arm_id: armId });
    expect(matched.map((l) => l.id)).toEqual([served.id]);

    const other = await logs.getLogs(c, {
      arm_id: '22222222-2222-4222-8222-222222222222',
    });
    expect(other).toEqual([]);
  });

  it('orders newest first and honours the time range', async () => {
    const { c } = await freshDatabase();
    const agent = await seedAgent(c);
    const skill = await seedSkill(c, agent.id);

    await logs.createLog(c, logParams(agent.id, skill.id, 1000));
    await logs.createLog(c, logParams(agent.id, skill.id, 3000));
    await logs.createLog(c, logParams(agent.id, skill.id, 2000));

    const all = await logs.getLogs(c, {});
    expect(all.map((l) => l.start_time)).toEqual([3000, 2000, 1000]);

    // Postgres combines these into one `and=(gte,lte)` filter.
    const ranged = await logs.getLogs(c, { after: 1500, before: 2500 });
    expect(ranged.map((l) => l.start_time)).toEqual([2000]);
  });

  it('finds the logs on either side of one by time', async () => {
    const { c } = await freshDatabase();
    const agent = await seedAgent(c);
    const skill = await seedSkill(c, agent.id);

    await logs.createLog(c, logParams(agent.id, skill.id, 1000));
    await logs.createLog(c, logParams(agent.id, skill.id, 2000));
    await logs.createLog(c, logParams(agent.id, skill.id, 3000));

    // How the dashboard steps between logs: the nearest log after one is
    // the first oldest-first, the nearest before it the first newest-first.
    const [newer] = await logs.getLogs(c, {
      after: 2001,
      order: 'asc',
      limit: 1,
    });
    const [older] = await logs.getLogs(c, { before: 1999, limit: 1 });
    expect(newer.start_time).toBe(3000);
    expect(older.start_time).toBe(1000);
  });

  it('filters on the trace, which is the session of a client that names one', async () => {
    const { c } = await freshDatabase();
    const agent = await seedAgent(c);
    const skill = await seedSkill(c, agent.id);

    await logs.createLog(c, {
      ...logParams(agent.id, skill.id, 1000),
      trace_id: 'ses_1',
    });
    await logs.createLog(c, {
      ...logParams(agent.id, skill.id, 2000),
      trace_id: 'ses_2',
    });
    await logs.createLog(c, {
      ...logParams(agent.id, skill.id, 3000),
      trace_id: 'ses_1',
    });

    const session = await logs.getLogs(c, { trace_id: 'ses_1', order: 'asc' });
    expect(session.map((l) => l.start_time)).toEqual([1000, 3000]);
  });

  it('lists the logs that have no evaluation run yet', async () => {
    const { c } = await freshDatabase();
    const agent = await seedAgent(c);
    const skill = await seedSkill(c, agent.id);

    const judged = await logs.createLog(c, logParams(agent.id, skill.id, 1000));
    const skipped = await logs.createLog(
      c,
      logParams(agent.id, skill.id, 2000),
    );
    await store.createSkillOptimizationEvaluationRun(c, {
      agent_id: agent.id,
      skill_id: skill.id,
      cluster_id: null,
      log_id: judged.id,
      results: [],
    });

    const backlog = await logs.getLogs(c, {
      skill_id: skill.id,
      unjudged: true,
    });
    expect(backlog.map((l) => l.id)).toEqual([skipped.id]);
  });

  it('filters on embeddings being present', async () => {
    const { c } = await freshDatabase();
    const agent = await seedAgent(c);
    const skill = await seedSkill(c, agent.id);

    await logs.createLog(c, logParams(agent.id, skill.id, 1000));
    await logs.createLog(c, {
      ...logParams(agent.id, skill.id, 2000),
      embedding: [0.1, 0.2, 0.3],
    } as Parameters<typeof logs.createLog>[1]);

    const withEmbedding = await logs.getLogs(c, { embedding_not_null: true });
    expect(withEmbedding).toHaveLength(1);
    expect(withEmbedding[0].embedding).toEqual([0.1, 0.2, 0.3]);
  });

  it('deletes a log', async () => {
    const { c } = await freshDatabase();
    const agent = await seedAgent(c);
    const skill = await seedSkill(c, agent.id);
    const created = await logs.createLog(c, logParams(agent.id, skill.id));

    await logs.deleteLog(c, created.id);
    expect(await logs.getLogs(c, {})).toHaveLength(0);
  });
});

describe('system settings', () => {
  it('reads the singleton seeded by migration 0003', async () => {
    const { c } = await freshDatabase();

    const settings = await store.getSystemSettings(c);
    expect(settings.id).toBeTruthy();
    // An empty options document reads as every default.
    expect(settings.options.developer_mode).toBe(false);
    expect(settings.options.judge).toEqual({
      timeout_ms: 60_000,
      max_tokens: 4_000,
      reasoning_effort: null,
    });
  });

  it('updates the singleton without needing its id', async () => {
    const { c } = await freshDatabase();

    const updated = await store.updateSystemSettings(c, {
      options: { developer_mode: true },
    });

    expect(updated.options.developer_mode).toBe(true);
    expect((await store.getSystemSettings(c)).options.developer_mode).toBe(
      true,
    );
  });

  it('merges an options patch over what is stored', async () => {
    const { c } = await freshDatabase();

    await store.updateSystemSettings(c, {
      options: { judge: { timeout_ms: 90_000 } },
    });
    const updated = await store.updateSystemSettings(c, {
      options: { judge: { max_tokens: 16_000 }, developer_mode: true },
    });

    // The earlier timeout survives a patch that names only the budget, and
    // the roles the patch never mentioned keep their defaults.
    expect(updated.options.judge).toEqual({
      timeout_ms: 90_000,
      max_tokens: 16_000,
      reasoning_effort: null,
    });
    expect(updated.options.developer_mode).toBe(true);
    expect(updated.options.embedding.timeout_ms).toBe(30_000);

    // Null is a value here -- it clears the effort -- not an omission.
    await store.updateSystemSettings(c, {
      options: { judge: { reasoning_effort: ReasoningEffort.NONE } },
    });
    const cleared = await store.updateSystemSettings(c, {
      options: { judge: { reasoning_effort: null } },
    });
    expect(cleared.options.judge.reasoning_effort).toBeNull();
    expect(cleared.options.judge.max_tokens).toBe(16_000);
  });
});

describe('skill events', () => {
  it('stores metadata as JSON and reads it back', async () => {
    const { c } = await freshDatabase();
    const agent = await seedAgent(c);
    const skill = await seedSkill(c, agent.id);

    const event = await store.createSkillEvent(c, {
      agent_id: agent.id,
      skill_id: skill.id,
      event_type: 'model_added',
      metadata: { model_name: 'gpt-5' },
    } as Parameters<typeof store.createSkillEvent>[1]);

    expect(event.metadata).toEqual({ model_name: 'gpt-5' });

    const [fetched] = await store.getSkillEvents(c, { skill_id: skill.id });
    expect(fetched.event_type).toBe('model_added');
  });
});

describe('evaluations', () => {
  it('throws when updating an evaluation that does not exist', async () => {
    const { c } = await freshDatabase();

    await expect(
      store.updateSkillOptimizationEvaluation(
        c,
        '00000000-0000-4000-8000-00000000dead',
        { weight: 2 } as Parameters<
          typeof store.updateSkillOptimizationEvaluation
        >[2],
      ),
    ).rejects.toThrow('Evaluation not found');
  });
});

/**
 * The TypeScript replacement for `get_evaluation_scores_by_time_bucket`.
 * Bucketing and weighting are the parts most likely to drift from the plpgsql,
 * so they are checked against hand-computed values.
 */
describe('getEvaluationScoresByTimeBucket', () => {
  const setup = async () => {
    const { client, c } = await freshDatabase();
    const agent = await seedAgent(c);
    const skill = await seedSkill(c, agent.id);

    const evaluations = await store.createSkillOptimizationEvaluations(c, [
      {
        agent_id: agent.id,
        skill_id: skill.id,
        evaluation_method: 'task_completion',
        weight: 3,
        params: {},
      } as Parameters<
        typeof store.createSkillOptimizationEvaluations
      >[1][number],
    ]);
    const [latency] = await store.createSkillOptimizationEvaluations(c, [
      {
        agent_id: agent.id,
        skill_id: skill.id,
        evaluation_method: 'latency',
        weight: 1,
        params: {},
      } as Parameters<
        typeof store.createSkillOptimizationEvaluations
      >[1][number],
    ]);

    const log = await logs.createLog(c, logParams(agent.id, skill.id));

    /** Insert a run at an explicit time; `created_at` otherwise defaults to now. */
    const addRun = async (
      createdAt: string,
      results: Array<{ evaluation_id: string; score: number }>,
    ) => {
      await client.execute({
        sql: `INSERT INTO skill_optimization_evaluation_runs
                (id, agent_id, skill_id, log_id, results, created_at)
              VALUES (?, ?, ?, ?, ?, ?)`,
        args: [
          crypto.randomUUID(),
          agent.id,
          skill.id,
          log.id,
          JSON.stringify(results),
          createdAt,
        ],
      });
    };

    return {
      c,
      agent,
      skill,
      taskCompletion: evaluations[0],
      latency,
      addRun,
    };
  };

  const range = {
    start_time: '2026-01-01T00:00:00.000Z',
    end_time: '2026-01-02T00:00:00.000Z',
  };

  it('groups runs into fixed buckets aligned to the epoch', async () => {
    const { c, taskCompletion, addRun } = await setup();

    await addRun('2026-01-01T00:05:00.000Z', [
      { evaluation_id: taskCompletion.id, score: 1.0 },
    ]);
    await addRun('2026-01-01T00:25:00.000Z', [
      { evaluation_id: taskCompletion.id, score: 0.0 },
    ]);
    await addRun('2026-01-01T01:10:00.000Z', [
      { evaluation_id: taskCompletion.id, score: 0.5 },
    ]);

    const result = await store.getEvaluationScoresByTimeBucket(c, {
      ...range,
      interval_minutes: 60,
    });

    expect(result).toHaveLength(2);
    expect(result[0].time_bucket).toBe('2026-01-01T00:00:00.000Z');
    expect(result[0].count).toBe(2);
    // Mean of 1.0 and 0.0 within the bucket.
    expect(result[0].avg_score).toBeCloseTo(0.5, 10);
    expect(result[1].time_bucket).toBe('2026-01-01T01:00:00.000Z');
    expect(result[1].count).toBe(1);
    expect(result[1].avg_score).toBeCloseTo(0.5, 10);
  });

  it('honours the interval', async () => {
    const { c, taskCompletion, addRun } = await setup();

    await addRun('2026-01-01T00:05:00.000Z', [
      { evaluation_id: taskCompletion.id, score: 1.0 },
    ]);
    await addRun('2026-01-01T00:25:00.000Z', [
      { evaluation_id: taskCompletion.id, score: 0.0 },
    ]);

    const hourly = await store.getEvaluationScoresByTimeBucket(c, {
      ...range,
      interval_minutes: 60,
    });
    expect(hourly).toHaveLength(1);

    // At 15 minutes the same two runs land in different buckets.
    const quarterly = await store.getEvaluationScoresByTimeBucket(c, {
      ...range,
      interval_minutes: 15,
    });
    expect(quarterly).toHaveLength(2);
    expect(quarterly.map((r) => r.time_bucket)).toEqual([
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T00:15:00.000Z',
    ]);
  });

  it('weights the average by the current evaluation weights', async () => {
    const { c, taskCompletion, latency, addRun } = await setup();

    await addRun('2026-01-01T00:05:00.000Z', [
      { evaluation_id: taskCompletion.id, score: 1.0 },
      { evaluation_id: latency.id, score: 0.0 },
    ]);

    const result = await store.getEvaluationScoresByTimeBucket(c, {
      ...range,
      interval_minutes: 60,
    });

    // (1.0 * 3 + 0.0 * 1) / 4
    expect(result[0].avg_score).toBeCloseTo(0.75, 10);
    expect(result[0].scores_by_evaluation).toEqual({
      task_completion: 1.0,
      latency: 0.0,
    });
  });

  it('reflects a weight change retroactively', async () => {
    const { c, taskCompletion, latency, addRun } = await setup();

    await addRun('2026-01-01T00:05:00.000Z', [
      { evaluation_id: taskCompletion.id, score: 1.0 },
      { evaluation_id: latency.id, score: 0.0 },
    ]);

    // The function recomputes from current weights rather than reusing the
    // weighted average stored on the run.
    await store.updateSkillOptimizationEvaluation(c, taskCompletion.id, {
      weight: 1,
    } as Parameters<typeof store.updateSkillOptimizationEvaluation>[2]);

    const result = await store.getEvaluationScoresByTimeBucket(c, {
      ...range,
      interval_minutes: 60,
    });

    expect(result[0].avg_score).toBeCloseTo(0.5, 10);
  });

  it('excludes runs outside the range and filters by skill', async () => {
    const { c, skill, taskCompletion, addRun } = await setup();

    await addRun('2025-12-31T23:00:00.000Z', [
      { evaluation_id: taskCompletion.id, score: 1.0 },
    ]);
    await addRun('2026-01-01T00:05:00.000Z', [
      { evaluation_id: taskCompletion.id, score: 0.5 },
    ]);

    const result = await store.getEvaluationScoresByTimeBucket(c, {
      ...range,
      interval_minutes: 60,
      skill_id: skill.id,
    });

    expect(result).toHaveLength(1);
    expect(result[0].avg_score).toBeCloseTo(0.5, 10);

    expect(
      await store.getEvaluationScoresByTimeBucket(c, {
        ...range,
        interval_minutes: 60,
        skill_id: '00000000-0000-4000-8000-00000000dead',
      }),
    ).toEqual([]);
  });

  it('returns an empty series when nothing is in range', async () => {
    const { c } = await setup();

    expect(
      await store.getEvaluationScoresByTimeBucket(c, {
        ...range,
        interval_minutes: 60,
      }),
    ).toEqual([]);
  });
});
