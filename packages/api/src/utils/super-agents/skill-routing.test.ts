import type { UserDataStorageConnector } from '@api/types/connector';
import type { AppContext } from '@api/types/hono';
import { embedText, RequestEmbeddingError } from '@api/utils/embeddings';
import { resolveEmbeddingModelConfig } from '@api/utils/evaluation-model-resolver';
import { clearIntentEmbeddings } from '@api/utils/super-agents/intent-embeddings';
import { arbitrateSkillForRequest } from '@api/utils/super-agents/skill-arbiter';
import { createSkillForRequest } from '@api/utils/super-agents/skill-creation';
import {
  advanceCentroid,
  learnSkillIntent,
  resetSkillLearning,
  routeRequestToSkill,
  SkillRoutingError,
  seedText,
} from '@api/utils/super-agents/skill-routing';
import { FunctionName } from '@shared/types/api/request';
import type { SuperAgentsRequestData } from '@shared/types/api/request/body';
import type { Agent, Skill, SkillRouting } from '@shared/types/data';
import { AgentOptions } from '@shared/types/data/agent';
import { SystemSettingsOptions } from '@shared/types/data/system-settings';
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

vi.mock('@api/utils/embeddings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@api/utils/embeddings')>()),
  embedText: vi.fn(),
}));
vi.mock('@api/utils/evaluation-model-resolver', () => ({
  agentById: vi.fn().mockResolvedValue(null),
  resolveEmbeddingModelConfig: vi.fn(),
}));
vi.mock('@api/utils/super-agents/skill-creation', () => ({
  createSkillForRequest: vi.fn(),
}));
vi.mock('@api/utils/super-agents/skill-arbiter', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@api/utils/super-agents/skill-arbiter')
  >()),
  arbitrateSkillForRequest: vi.fn(),
}));

const c = {} as AppContext;
const MODEL_ID = 'embed-model';

/** An agent that keeps its skills as they are. */
const manual = {
  id: 'agent-1',
  name: 'helper',
  auto_create_skills: false,
  skill_match_threshold: 0.8,
  max_auto_created_skills: 10,
  options: AgentOptions.parse({}),
} as Agent;
/** An agent that grows skills as requests arrive. */
const growing = { ...manual, auto_create_skills: true } as Agent;

const skill = (
  id: string,
  name: string,
  total_requests = 0,
  auto_created = false,
): Skill =>
  ({
    id,
    name,
    description: `${name} does ${name} things`,
    total_requests,
    auto_created,
  }) as Skill;

const chat = (
  systemPrompt?: string,
  userMessage = 'hi',
): SuperAgentsRequestData =>
  ({
    functionName: FunctionName.CHAT_COMPLETE,
    requestBody: {
      messages: [
        ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
        { role: 'user', content: userMessage },
      ],
    },
  }) as unknown as SuperAgentsRequestData;

/** Embeds by keyword, so a prompt can be steered towards a skill. */
const embeddingFor = (text: string): number[] => [
  text.includes('translate') ? 1 : 0,
  text.includes('sql') ? 1 : 0,
  0.01,
];

const routing = (
  skillId: string,
  centroid: number[],
  overrides: Partial<SkillRouting> = {},
): SkillRouting => ({
  skill_id: skillId,
  agent_id: manual.id,
  centroid,
  conversation_centroid: null,
  embedding_model_id: MODEL_ID,
  sample_count: 1,
  conversation_sample_count: 0,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

interface RoutingConnector {
  getSkills: Mock;
  getSkillRoutings: Mock;
  upsertSkillRouting: Mock;
  getSystemSettings: Mock;
  claimSkillCreationLease: Mock;
  releaseSkillCreationLease: Mock;
}

/** Remembers the routing rows it is given, as storage would. */
const routingConnector = (): RoutingConnector => {
  const stored = new Map<string, SkillRouting>();
  return {
    getSkills: vi.fn(),
    getSkillRoutings: vi
      .fn()
      .mockImplementation((_c, params: { skill_id?: string }) =>
        Promise.resolve(
          [...stored.values()].filter(
            (row) => !params.skill_id || row.skill_id === params.skill_id,
          ),
        ),
      ),
    upsertSkillRouting: vi.fn().mockImplementation((_c, params) => {
      const row = routing(params.skill_id, params.centroid, params);
      stored.set(params.skill_id, row);
      return Promise.resolve(row);
    }),
    getSystemSettings: vi.fn().mockResolvedValue({
      embedding_model_id: MODEL_ID,
      skill_arbiter_model_id: null,
      intent_compaction_model_id: null,
      options: SystemSettingsOptions.parse({
        intent_compaction: { timeout_ms: 15_000 },
      }),
    }),
    claimSkillCreationLease: vi.fn().mockResolvedValue(true),
    releaseSkillCreationLease: vi.fn(),
  };
};

describe('routeRequestToSkill', () => {
  let connector: RoutingConnector;
  const created = skill('s-new', 'created');

  const route = (agent: Agent, saRequestData = chat('You translate text.')) =>
    routeRequestToSkill(
      c,
      connector as unknown as UserDataStorageConnector,
      agent,
      saRequestData,
    );

  beforeEach(() => {
    vi.clearAllMocks();
    clearIntentEmbeddings();
    connector = routingConnector();
    vi.mocked(resolveEmbeddingModelConfig).mockResolvedValue({
      modelId: MODEL_ID,
      dimensions: 3,
    } as never);
    vi.mocked(embedText).mockImplementation(async (_c, _connector, text) => ({
      embedding: embeddingFor(text),
      modelId: MODEL_ID,
    }));
    vi.mocked(createSkillForRequest).mockResolvedValue(created);
    vi.mocked(arbitrateSkillForRequest).mockResolvedValue({ kind: 'new' });
  });

  describe('an agent that keeps its skills', () => {
    it('refuses an agent without skills', async () => {
      connector.getSkills.mockResolvedValue([]);

      await expect(route(manual)).rejects.toMatchObject({
        name: 'SkillRoutingError',
        status: 404,
      });
      expect(embedText).not.toHaveBeenCalled();
      expect(createSkillForRequest).not.toHaveBeenCalled();
    });

    it('uses the only skill without embedding anything', async () => {
      const only = skill('s1', 'translate');
      connector.getSkills.mockResolvedValue([only]);

      const result = await route(manual);

      expect(result.skill).toBe(only);
      expect(result.decision).toEqual({
        method: 'only_skill',
        similarity: null,
        threshold: null,
        candidates: 1,
        identity_similarity: null,
        conversation_similarity: null,
      });
      expect(resolveEmbeddingModelConfig).not.toHaveBeenCalled();
      expect(embedText).not.toHaveBeenCalled();
    });

    it('needs an embedding model to choose between several skills', async () => {
      connector.getSkills.mockResolvedValue([
        skill('s1', 'translate'),
        skill('s2', 'sql'),
      ]);
      vi.mocked(resolveEmbeddingModelConfig).mockResolvedValue(null);

      const error = await route(manual).catch((e) => e);
      expect(error).toBeInstanceOf(SkillRoutingError);
      expect(error.status).toBe(422);
      expect(error.message).toContain('embedding model');
    });

    it('seeds unseen skills from their descriptions and routes to the closest', async () => {
      const translate = skill('s1', 'translate');
      const sql = skill('s2', 'sql');
      connector.getSkills.mockResolvedValue([translate, sql]);

      const result = await route(manual, chat('You translate text.'));

      expect(result.skill).toBe(translate);
      expect(result.decision.method).toBe('embedding');
      expect(result.decision.candidates).toBe(2);
      expect(result.decision.similarity).toBeCloseTo(1, 3);
      expect(result.decision.identity_similarity).toBeCloseTo(1, 3);
      // Nothing had met a conversation yet, so identity alone decided.
      expect(result.decision.conversation_similarity).toBeNull();
      // The threshold is not consulted when nothing would be created.
      expect(result.decision.threshold).toBeNull();

      // Two seeds, then the winner absorbing the request.
      expect(connector.upsertSkillRouting).toHaveBeenCalledTimes(3);
      expect(connector.upsertSkillRouting).toHaveBeenCalledWith(
        c,
        expect.objectContaining({
          skill_id: 's1',
          centroid: [1, 0, 0.01],
          conversation_centroid: null,
          embedding_model_id: MODEL_ID,
          sample_count: 1,
          conversation_sample_count: 0,
        }),
      );
      expect(connector.upsertSkillRouting).toHaveBeenCalledWith(
        c,
        expect.objectContaining({
          skill_id: 's2',
          centroid: [0, 1, 0.01],
          sample_count: 1,
        }),
      );
      // The absorb takes the identity into the main centroid and starts the
      // conversation centroid from the conversation.
      expect(connector.upsertSkillRouting).toHaveBeenLastCalledWith(
        c,
        expect.objectContaining({
          skill_id: 's1',
          sample_count: 2,
          conversation_centroid: [0, 0, 0.01],
          conversation_sample_count: 1,
        }),
      );
    });

    it('routes by the prompt rather than by skill order', async () => {
      connector.getSkills.mockResolvedValue([
        skill('s1', 'translate'),
        skill('s2', 'sql'),
      ]);

      const result = await route(
        manual,
        chat('Write the sql for this report.'),
      );

      expect(result.skill.id).toBe('s2');
    });

    it('weighs the conversation against its own centroid', async () => {
      // Two skills that look identical by identity; only their conversation
      // history separates them, and the request's conversation decides.
      connector.getSkills.mockResolvedValue([
        skill('s1', 'translate'),
        skill('s2', 'translate-formal'),
      ]);
      connector.getSkillRoutings.mockResolvedValue([
        routing('s1', [1, 0, 0.01], {
          conversation_centroid: [1, 0, 0.01],
          conversation_sample_count: 3,
        }),
        routing('s2', [1, 0, 0.01], {
          conversation_centroid: [0, 1, 0.01],
          conversation_sample_count: 3,
        }),
      ]);

      const result = await route(
        manual,
        chat('You translate text.', 'make this sql formal'),
      );

      expect(result.skill.id).toBe('s2');
      expect(result.decision.identity_similarity).toBeCloseTo(1, 3);
      expect(result.decision.conversation_similarity).toBeCloseTo(1, 3);
    });

    it('takes an intent in once, and embeds it once', async () => {
      connector.getSkills.mockResolvedValue([
        skill('s1', 'translate'),
        skill('s2', 'sql'),
      ]);

      await route(manual, chat('You translate text.'));
      const writes = connector.upsertSkillRouting.mock.calls.length;
      const embeddings = vi.mocked(embedText).mock.calls.length;

      const again = await route(manual, chat('You translate text.'));

      expect(again.skill.id).toBe('s1');
      expect(connector.upsertSkillRouting).toHaveBeenCalledTimes(writes);
      expect(embedText).toHaveBeenCalledTimes(embeddings);
    });

    it('reuses stored centroids and re-seeds rows from another model', async () => {
      connector.getSkills.mockResolvedValue([
        skill('s1', 'translate'),
        skill('s2', 'sql'),
      ]);
      connector.getSkillRoutings.mockResolvedValue([
        routing('s1', [1, 0, 0.01], { sample_count: 5 }),
        routing('s2', [0, 1, 0.01], { embedding_model_id: 'old-model' }),
      ]);

      const result = await route(manual, chat('You translate text.'));

      expect(result.skill.id).toBe('s1');
      // The sql seed, then the request's two halves; translate was known.
      const embedded = vi.mocked(embedText).mock.calls.map((call) => call[2]);
      expect(embedded).toEqual([
        'sql: sql does sql things',
        'You translate text.',
        'User: hi',
      ]);
      expect(connector.upsertSkillRouting).toHaveBeenLastCalledWith(
        c,
        expect.objectContaining({
          skill_id: 's1',
          sample_count: 6,
          conversation_sample_count: 1,
        }),
      );
    });

    it('serves the most used skill when the request cannot be embedded', async () => {
      const busy = skill('s2', 'sql', 40);
      connector.getSkills.mockResolvedValue([
        skill('s1', 'translate', 3),
        busy,
      ]);
      vi.mocked(embedText).mockRejectedValue(
        new RequestEmbeddingError('provider down'),
      );

      const result = await route(manual, chat('You translate text.'));

      expect(result.skill).toBe(busy);
      expect(result.decision.method).toBe('most_used');
    });

    it('serves the most used skill when the request has no intent', async () => {
      const busy = skill('s1', 'translate', 9);
      connector.getSkills.mockResolvedValue([busy, skill('s2', 'sql', 2)]);

      const result = await route(manual, {
        functionName: FunctionName.EMBED,
        requestBody: { input: 'x' },
      } as unknown as SuperAgentsRequestData);

      expect(result.skill).toBe(busy);
      expect(result.decision.method).toBe('most_used');
      expect(embedText).not.toHaveBeenCalled();
    });
  });

  describe('an agent that creates skills', () => {
    it('creates the first skill from the first request, without arbitration', async () => {
      connector.getSkills.mockResolvedValue([]);
      const saRequestData = chat('You translate text.');

      const result = await route(growing, saRequestData);

      expect(result.skill).toBe(created);
      expect(result.decision).toEqual({
        method: 'created',
        similarity: null,
        threshold: 0.8,
        candidates: 0,
        identity_similarity: null,
        conversation_similarity: null,
      });
      expect(arbitrateSkillForRequest).not.toHaveBeenCalled();
      expect(createSkillForRequest).toHaveBeenCalledWith(
        c,
        connector,
        growing,
        saRequestData,
        'You translate text.\n\nUser: hi',
        expect.objectContaining({
          modelId: MODEL_ID,
          identity: expect.objectContaining({ embedding: [1, 0, 0.01] }),
          conversation: expect.objectContaining({ embedding: [0, 0, 0.01] }),
        }),
        [],
      );
      // Under the agent's lease, which is given back afterwards.
      expect(connector.claimSkillCreationLease).toHaveBeenCalledWith(
        c,
        growing.id,
        expect.any(String),
        expect.any(String),
        expect.any(String),
      );
      expect(connector.releaseSkillCreationLease).toHaveBeenCalledWith(
        c,
        growing.id,
        connector.claimSkillCreationLease.mock.calls[0][2],
      );
    });

    it('holds the lease long enough for the arbiter to answer', async () => {
      connector.getSkills.mockResolvedValue([skill('s1', 'translate')]);
      // The agent's own arbiter timeout wins over the system's 15 seconds.
      const patient = {
        ...growing,
        options: AgentOptions.parse({ skill_arbiter: { timeout_ms: 30_000 } }),
      } as Agent;

      await route(patient, chat('Draw a picture of a cat.'));

      // Creation's own budget, plus one arbiter attempt and its retry.
      const [, , , now, until] = connector.claimSkillCreationLease.mock
        .calls[0] as string[];
      expect(Date.parse(until) - Date.parse(now)).toBe(45_000 + 2 * 30_000);
    });

    it('takes the skill another request created while it waited for the lease', async () => {
      const translate = skill('s1', 'translate');
      connector.getSkills
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([translate]);
      connector.getSkillRoutings.mockResolvedValue([
        routing('s1', [1, 0, 0.01]),
      ]);

      const result = await route(growing, chat('You translate text.'));

      expect(result.skill).toBe(translate);
      expect(result.decision.method).toBe('embedding');
      expect(result.decision.similarity).toBeCloseTo(1, 3);
      expect(createSkillForRequest).not.toHaveBeenCalled();
      expect(connector.releaseSkillCreationLease).toHaveBeenCalledTimes(1);
    });

    it('gives the lease back when creating fails', async () => {
      connector.getSkills.mockResolvedValue([]);
      vi.mocked(createSkillForRequest).mockRejectedValue(new Error('storage'));

      await expect(route(growing)).rejects.toThrow('storage');
      expect(connector.releaseSkillCreationLease).toHaveBeenCalledTimes(1);
    });

    it('still creates the first skill when the request cannot be embedded', async () => {
      connector.getSkills.mockResolvedValue([]);
      vi.mocked(embedText).mockRejectedValue(
        new RequestEmbeddingError('provider down'),
      );

      const result = await route(growing);

      expect(result.decision.method).toBe('created');
      expect(createSkillForRequest).toHaveBeenCalledWith(
        c,
        connector,
        growing,
        expect.anything(),
        'You translate text.\n\nUser: hi',
        null,
        [],
      );
    });

    it('files a request with no intent under a default skill', async () => {
      connector.getSkills.mockResolvedValue([]);

      await route(growing, {
        functionName: FunctionName.EMBED,
        requestBody: { input: 'x' },
      } as unknown as SuperAgentsRequestData);

      expect(createSkillForRequest).toHaveBeenCalledWith(
        c,
        connector,
        growing,
        expect.anything(),
        expect.stringContaining('no instructions'),
        null,
        [],
      );
    });

    it('compares even a single skill, since the request may not belong to it', async () => {
      const translate = skill('s1', 'translate');
      connector.getSkills.mockResolvedValue([translate]);

      const result = await route(growing, chat('You translate text.'));

      expect(result.skill).toBe(translate);
      expect(result.decision.method).toBe('embedding');
      expect(result.decision.threshold).toBe(0.8);
      expect(createSkillForRequest).not.toHaveBeenCalled();
    });

    it('falls back to the only skill when there is no embedding model', async () => {
      const only = skill('s1', 'translate');
      connector.getSkills.mockResolvedValue([only]);
      vi.mocked(resolveEmbeddingModelConfig).mockResolvedValue(null);

      const result = await route(growing);

      expect(result.skill).toBe(only);
      expect(result.decision.method).toBe('only_skill');
    });

    it('creates a skill for a request the arbiter calls a new job', async () => {
      const translate = skill('s1', 'translate');
      const sql = skill('s2', 'sql');
      connector.getSkills.mockResolvedValue([translate, sql]);
      const saRequestData = chat('Draw a picture of a cat.');

      const result = await route(growing, saRequestData);

      expect(result.skill).toBe(created);
      expect(result.decision.method).toBe('created');
      expect(result.decision.similarity).toBeLessThan(0.8);
      expect(arbitrateSkillForRequest).toHaveBeenCalledWith(
        c,
        connector,
        growing,
        [translate, sql],
        expect.objectContaining({ systemPrompt: 'Draw a picture of a cat.' }),
        // The system settings, read once and handed on.
        expect.objectContaining({
          options: expect.objectContaining({
            skill_arbiter: { timeout_ms: 15_000, reasoning_effort: null },
          }),
        }),
      );
      expect(createSkillForRequest).toHaveBeenCalledWith(
        c,
        connector,
        growing,
        expect.anything(),
        'Draw a picture of a cat.\n\nUser: hi',
        expect.objectContaining({
          identity: expect.objectContaining({ embedding: [0, 0, 0.01] }),
        }),
        [translate, sql],
      );
      // The existing centroids are left alone; the new skill seeds its own.
      expect(connector.upsertSkillRouting).toHaveBeenCalledTimes(2);
      // The second look, under the lease, found the same skills and reused
      // every embedding.
      expect(connector.getSkills).toHaveBeenCalledTimes(2);
      expect(embedText).toHaveBeenCalledTimes(4);
    });

    it('routes to the skill the arbiter chooses, and teaches its centroids', async () => {
      const translate = skill('s1', 'translate');
      const sql = skill('s2', 'sql');
      connector.getSkills.mockResolvedValue([translate, sql]);
      vi.mocked(arbitrateSkillForRequest).mockResolvedValue({
        kind: 'existing',
        skill: sql,
      });

      const result = await route(growing, chat('Draw a picture of a cat.'));

      expect(result.skill).toBe(sql);
      expect(result.decision.method).toBe('arbitrated');
      expect(result.decision.similarity).toBeLessThan(0.8);
      expect(result.decision.threshold).toBe(0.8);
      expect(createSkillForRequest).not.toHaveBeenCalled();
      // The verdict teaches the router: the next such request routes by
      // embedding alone.
      expect(connector.upsertSkillRouting).toHaveBeenLastCalledWith(
        c,
        expect.objectContaining({
          skill_id: 's2',
          sample_count: 2,
          conversation_centroid: [0, 0, 0.01],
          conversation_sample_count: 1,
        }),
      );
    });

    it('routes to the closest skill when the arbiter cannot be asked', async () => {
      const translate = skill('s1', 'translate');
      const sql = skill('s2', 'sql');
      connector.getSkills.mockResolvedValue([translate, sql]);
      vi.mocked(arbitrateSkillForRequest).mockResolvedValue({
        kind: 'unavailable',
      });

      const result = await route(
        growing,
        chat('Translate a picture of a cat.'),
      );

      expect(result.skill.id).toBe('s1');
      expect(result.decision.method).toBe('embedding');
      expect(createSkillForRequest).not.toHaveBeenCalled();
      // Unconfirmed, so nothing is absorbed: only the two seeds were written.
      expect(connector.upsertSkillRouting).toHaveBeenCalledTimes(2);
    });

    it('routes to the closest skill once the agent is at its cap', async () => {
      const capped = { ...growing, max_auto_created_skills: 1 } as Agent;
      const translate = skill('s1', 'translate', 0, true);
      connector.getSkills.mockResolvedValue([translate, skill('s2', 'sql')]);

      const result = await route(capped, chat('Draw a picture of a cat.'));

      expect(createSkillForRequest).not.toHaveBeenCalled();
      expect(arbitrateSkillForRequest).not.toHaveBeenCalled();
      expect(result.decision.method).toBe('embedding');
      expect(['s1', 's2']).toContain(result.skill.id);
    });

    it('refuses an agent without skills once it is at its cap', async () => {
      const capped = { ...growing, max_auto_created_skills: 0 } as Agent;
      connector.getSkills.mockResolvedValue([]);

      await expect(route(capped)).rejects.toMatchObject({ status: 404 });
    });
  });
});

describe('learnSkillIntent', () => {
  let connector: RoutingConnector;
  const translate = skill('s1', 'translate');

  const learn = (
    saRequestData = chat('You translate text.'),
    target: Skill = translate,
  ) =>
    learnSkillIntent(
      c,
      connector as unknown as UserDataStorageConnector,
      manual,
      target,
      saRequestData,
    );

  beforeEach(() => {
    vi.clearAllMocks();
    clearIntentEmbeddings();
    resetSkillLearning();
    connector = routingConnector();
    vi.mocked(resolveEmbeddingModelConfig).mockResolvedValue({
      modelId: MODEL_ID,
      dimensions: 3,
    } as never);
    vi.mocked(embedText).mockImplementation(async (_c, _connector, text) => ({
      embedding: embeddingFor(text),
      modelId: MODEL_ID,
    }));
  });

  it('starts a skill with no centroids from the request itself', async () => {
    await learn();

    expect(connector.upsertSkillRouting).toHaveBeenCalledWith(c, {
      skill_id: 's1',
      agent_id: manual.id,
      centroid: [1, 0, 0.01],
      conversation_centroid: [0, 0, 0.01],
      embedding_model_id: MODEL_ID,
      sample_count: 1,
      conversation_sample_count: 1,
    });
  });

  it('moves existing centroids towards the request', async () => {
    connector.getSkillRoutings.mockResolvedValue([
      routing('s1', [0, 1, 0.01], {
        sample_count: 1,
        conversation_centroid: [1, 0, 0.01],
        conversation_sample_count: 1,
      }),
    ]);

    await learn();

    expect(connector.getSkillRoutings).toHaveBeenCalledWith(c, {
      skill_id: 's1',
    });
    expect(connector.upsertSkillRouting).toHaveBeenCalledWith(
      c,
      expect.objectContaining({
        skill_id: 's1',
        centroid: [0.5, 0.5, 0.01],
        sample_count: 2,
        conversation_centroid: [0.5, 0, 0.01],
        conversation_sample_count: 2,
      }),
    );
  });

  it('starts over from a centroid another model computed', async () => {
    connector.getSkillRoutings.mockResolvedValue([
      routing('s1', [0, 1, 0.01], { embedding_model_id: 'old-model' }),
    ]);

    await learn();

    expect(connector.upsertSkillRouting).toHaveBeenCalledWith(
      c,
      expect.objectContaining({ centroid: [1, 0, 0.01], sample_count: 1 }),
    );
  });

  it('takes each intent in once', async () => {
    await learn();
    resetSkillLearning();
    await learn();

    expect(embedText).toHaveBeenCalledTimes(2);
    expect(connector.upsertSkillRouting).toHaveBeenCalledTimes(1);
  });

  it('learns from a skill at most once an interval', async () => {
    vi.useFakeTimers();
    try {
      await learn();
      await learn(chat('Write the sql.'));
      expect(embedText).toHaveBeenCalledTimes(2);

      vi.advanceTimersByTime(60_000);
      await learn(chat('Write the sql.'));
      expect(embedText).toHaveBeenCalledTimes(3);

      // Another skill has its own clock.
      await learn(chat('Write the sql.'), skill('s2', 'sql'));
      expect(embedText).toHaveBeenCalledTimes(3);
      expect(connector.upsertSkillRouting).toHaveBeenLastCalledWith(
        c,
        expect.objectContaining({ skill_id: 's2' }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('does nothing for a request with no intent', async () => {
    await learn({
      functionName: FunctionName.EMBED,
      requestBody: { input: 'x' },
    } as unknown as SuperAgentsRequestData);

    expect(connector.getSystemSettings).not.toHaveBeenCalled();
    expect(embedText).not.toHaveBeenCalled();
  });

  it('does nothing, quietly, without an embedding model', async () => {
    connector.getSystemSettings.mockResolvedValue({ embedding_model_id: null });

    await learn();

    expect(resolveEmbeddingModelConfig).not.toHaveBeenCalled();
    expect(connector.upsertSkillRouting).not.toHaveBeenCalled();
  });

  it('swallows an embedding failure', async () => {
    vi.mocked(embedText).mockRejectedValue(
      new RequestEmbeddingError('provider down'),
    );

    await expect(learn()).resolves.toBeUndefined();
    expect(connector.upsertSkillRouting).not.toHaveBeenCalled();
  });

  it('lets other failures propagate', async () => {
    connector.getSkillRoutings.mockRejectedValue(new Error('storage'));

    await expect(learn()).rejects.toThrow('storage');
  });
});

describe('advanceCentroid', () => {
  it('moves the mean by one sample', () => {
    expect(advanceCentroid([0, 0], [1, 1], 1)).toEqual([0.5, 0.5]);
    expect(advanceCentroid([0.5, 0.5], [1, 1], 2)[0]).toBeCloseTo(2 / 3);
  });

  it('stops settling past the cap', () => {
    expect(advanceCentroid([0], [1], 100_000)[0]).toBeCloseTo(1 / 101);
  });
});

describe('seedText', () => {
  it('starts a skill the gateway created from the prompt that created it', () => {
    expect(
      seedText({
        ...skill('s1', 'concierge'),
        seed_system_prompt: 'You are a restaurant concierge.',
      }),
    ).toBe('You are a restaurant concierge.');
  });

  it('starts any other skill from its description', () => {
    expect(seedText(skill('s1', 'concierge'))).toBe(
      'concierge: concierge does concierge things',
    );
    expect(
      seedText({ ...skill('s1', 'concierge'), seed_system_prompt: '' }),
    ).toBe('concierge: concierge does concierge things');
  });
});
