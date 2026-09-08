import {
  awaitingRealNaming,
  describeSkillForRequest,
  HEURISTIC_DESCRIPTION_PREFIX,
  heuristicSkillNaming,
  repairSkillNaming,
  slugifySkillName,
  uniqueSkillName,
} from '@api/optimization/utils/describe-skill';
import { createMockContext } from '@api/test-utils/mock-context';
import type { UserDataStorageConnector } from '@api/types/connector';
import { resolveRoleModel } from '@api/utils/evaluation-model-resolver';
import { ReasoningEffort } from '@shared/types/api/routes/shared/thinking';
import { AIProvider } from '@shared/types/constants';
import type { Agent, Skill } from '@shared/types/data';
import { SkillEventType } from '@shared/types/data/skill-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockParse = vi.fn();

vi.mock('openai', () => ({
  default: vi.fn(
    class {
      withOptions = () => ({ chat: { completions: { parse: mockParse } } });
    },
  ),
}));

vi.mock('@api/constants', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@api/constants')>()),
  getApiUrl: () => 'http://localhost:8787',
}));

vi.mock('@api/utils/evaluation-model-resolver', () => ({
  agentById: vi.fn().mockResolvedValue(null),
  resolveRoleModel: vi.fn(),
}));

vi.mock('@api/utils/sse-event-manager', () => ({ emitSSEEvent: vi.fn() }));

describe('slugifySkillName', () => {
  it('produces a name the skill schema accepts', () => {
    expect(slugifySkillName('Summarize Support Tickets!')).toBe(
      'summarize-support-tickets',
    );
    expect(slugifySkillName('  --Hello, World--  ')).toBe('hello-world');
  });

  it('caps the length without leaving a dangling hyphen', () => {
    const name = slugifySkillName(`${'a'.repeat(30)} ${'b'.repeat(30)}`);
    expect(name).toBe(`${'a'.repeat(30)}-${'b'.repeat(9)}`);
    expect(slugifySkillName(`${'a'.repeat(39)} b`)).toBe('a'.repeat(39));
  });

  it('falls back when nothing usable is left', () => {
    expect(slugifySkillName('!!')).toBe('skill');
    expect(slugifySkillName('')).toBe('skill');
  });
});

describe('uniqueSkillName', () => {
  it('keeps a free name and suffixes a taken one', () => {
    expect(uniqueSkillName('translate', [])).toBe('translate');
    expect(uniqueSkillName('translate', ['translate'])).toBe('translate-2');
    expect(uniqueSkillName('translate', ['translate', 'translate-2'])).toBe(
      'translate-3',
    );
  });

  it('keeps the suffixed name within the length cap', () => {
    const base = 'x'.repeat(40);
    expect(uniqueSkillName(base, [base])).toBe(`${'x'.repeat(38)}-2`);
  });
});

describe('heuristicSkillNaming', () => {
  it('names the skill after the first words of the instructions', () => {
    const naming = heuristicSkillNaming(
      'You are a restaurant concierge.\nBe brief.',
    );
    expect(naming.name).toBe('you-are-a-restaurant-concierge');
    expect(naming.description).toContain('You are a restaurant concierge.');
    expect(naming.description.length).toBeGreaterThanOrEqual(25);
  });

  it('quotes at most the start of a long prompt', () => {
    const naming = heuristicSkillNaming('a'.repeat(5000));
    expect(naming.description.length).toBeLessThan(600);
  });
});

describe('describeSkillForRequest', () => {
  const c = createMockContext();
  const connector = {} as UserDataStorageConnector;
  const agent = {
    id: 'agent-1',
    name: 'helper',
    description: 'Helps guests of the restaurant with anything they need.',
  } as Agent;
  const intent = 'You are a restaurant concierge.\n\nTools: book_table';

  /** What the model answered, in the shape the OpenAI client hands back. */
  const modelSays = (parsed: unknown) =>
    mockParse.mockResolvedValue({ choices: [{ message: { parsed } }] });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveRoleModel).mockResolvedValue({
      model: 'gpt-5-mini',
      provider: AIProvider.OPENAI,
      apiKey: 'sk-test',
    });
  });

  it('takes the name and description the model gives', async () => {
    modelSays({
      name: 'Restaurant Concierge!',
      description: 'Books tables and answers questions about the restaurant.',
    });

    const naming = await describeSkillForRequest(c, connector, agent, intent, [
      'translate',
    ]);

    expect(naming).toEqual({
      name: 'restaurant-concierge',
      description: 'Books tables and answers questions about the restaurant.',
    });
    // The intent and the names to avoid both reach the model.
    const request = mockParse.mock.calls[0][0] as {
      messages: { role: string; content: string }[];
    };
    expect(request.messages[1].content).toContain('book_table');
    expect(request.messages[1].content).toContain('translate');
  });

  it("sends the naming call's reasoning effort", async () => {
    // Naming happens on the request path, so the setting is what keeps the
    // model from thinking its way past the caller's patience.
    vi.mocked(resolveRoleModel).mockResolvedValue({
      model: 'gpt-5-mini',
      provider: AIProvider.OPENAI,
      apiKey: 'sk-test',
      reasoningEffort: ReasoningEffort.NONE,
    });
    modelSays({ name: 'concierge', description: 'Books tables.' });

    await describeSkillForRequest(c, connector, agent, intent, []);

    expect(mockParse.mock.calls[0][0]).toMatchObject({
      reasoning_effort: 'none',
    });
  });

  it('sends none when the role leaves the model to its default', async () => {
    modelSays({ name: 'concierge', description: 'Books tables.' });

    await describeSkillForRequest(c, connector, agent, intent, []);

    expect(mockParse.mock.calls[0][0]).not.toHaveProperty('reasoning_effort');
  });

  it('names the skill from the request when no model is configured', async () => {
    vi.mocked(resolveRoleModel).mockResolvedValue(null);

    const naming = await describeSkillForRequest(
      c,
      connector,
      agent,
      intent,
      [],
    );

    expect(naming).toEqual(heuristicSkillNaming(intent));
    expect(mockParse).not.toHaveBeenCalled();
  });

  it('falls back when the answer does not fit', async () => {
    modelSays({ title: 'not the schema' });

    const naming = await describeSkillForRequest(
      c,
      connector,
      agent,
      intent,
      [],
    );

    expect(naming).toEqual(heuristicSkillNaming(intent));
  });

  it('falls back when the model call fails', async () => {
    mockParse.mockRejectedValue(new Error('provider down'));

    const naming = await describeSkillForRequest(
      c,
      connector,
      agent,
      intent,
      [],
    );

    expect(naming).toEqual(heuristicSkillNaming(intent));
  });

  it('keeps a usable name but replaces a description too short to store', async () => {
    // `SkillCreateParams` insists on 25 characters.
    modelSays({ name: 'concierge', description: 'Books tables.' });

    const naming = await describeSkillForRequest(
      c,
      connector,
      agent,
      intent,
      [],
    );

    expect(naming.name).toBe('concierge');
    expect(naming.description).toBe(heuristicSkillNaming(intent).description);
  });

  it('replaces a name with nothing usable in it', async () => {
    modelSays({
      name: '???',
      description: 'Books tables and answers questions about the restaurant.',
    });

    const naming = await describeSkillForRequest(
      c,
      connector,
      agent,
      intent,
      [],
    );

    expect(naming.name).toBe(heuristicSkillNaming(intent).name);
  });
});

describe('repairSkillNaming', () => {
  const c = createMockContext();

  /** A skill that was created while system settings had no models. */
  const brokenSkill = (overrides: Partial<Skill> = {}): Skill =>
    ({
      id: 'skill-1',
      agent_id: 'agent-1',
      name: 'you-are-a-restaurant-concierge',
      auto_created: true,
      description: `${HEURISTIC_DESCRIPTION_PREFIX} You are a restaurant concierge.`,
      seed_system_prompt: 'You are a restaurant concierge.',
      ...overrides,
    }) as Skill;

  const repairConnector = (siblings: string[] = ['translate']) =>
    ({
      getSkills: vi.fn().mockResolvedValue(
        [...siblings, 'you-are-a-restaurant-concierge'].map((name) => ({
          name,
        })),
      ),
      updateSkill: vi.fn().mockResolvedValue(undefined),
      createSkillEvent: vi.fn().mockResolvedValue(undefined),
    }) as unknown as UserDataStorageConnector;

  const modelSays = (parsed: unknown) =>
    mockParse.mockResolvedValue({ choices: [{ message: { parsed } }] });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveRoleModel).mockResolvedValue({
      model: 'gpt-5-mini',
      provider: AIProvider.OPENAI,
      apiKey: 'sk-test',
    });
  });

  it('renames a skill stuck with its fallback naming', async () => {
    const connector = repairConnector();
    modelSays({
      name: 'restaurant-concierge',
      description: 'Books tables and answers questions about the restaurant.',
    });

    const naming = await repairSkillNaming(
      c,
      connector,
      brokenSkill(),
      'Helps guests of the restaurant.',
      'User: a table for two\n\nAssistant: Booked.',
    );

    expect(naming).toEqual({
      name: 'restaurant-concierge',
      description: 'Books tables and answers questions about the restaurant.',
    });
    expect(connector.updateSkill).toHaveBeenCalledWith(c, 'skill-1', {
      name: 'restaurant-concierge',
      description: 'Books tables and answers questions about the restaurant.',
    });
    expect(connector.createSkillEvent).toHaveBeenCalledWith(
      c,
      expect.objectContaining({
        skill_id: 'skill-1',
        event_type: SkillEventType.DESCRIPTION_UPDATED,
        metadata: expect.objectContaining({
          previous_name: 'you-are-a-restaurant-concierge',
        }),
      }),
    );
    // The describer saw the seed prompt and the real example.
    const request = mockParse.mock.calls[0][0] as {
      messages: { content: string }[];
    };
    expect(request.messages[1].content).toContain(
      'You are a restaurant concierge.',
    );
    expect(request.messages[1].content).toContain('a table for two');
  });

  it('suffixes a name a sibling already has', async () => {
    const connector = repairConnector(['restaurant-concierge']);
    modelSays({
      name: 'restaurant-concierge',
      description: 'Books tables and answers questions about the restaurant.',
    });

    const naming = await repairSkillNaming(
      c,
      connector,
      brokenSkill(),
      'Helps guests of the restaurant.',
    );

    expect(naming?.name).toBe('restaurant-concierge-2');
  });

  it('keeps the fallback when the describer falls back again', async () => {
    vi.mocked(resolveRoleModel).mockResolvedValue(null);
    const connector = repairConnector();

    const naming = await repairSkillNaming(
      c,
      connector,
      brokenSkill(),
      'Helps guests of the restaurant.',
    );

    expect(naming).toBeNull();
    expect(connector.updateSkill).not.toHaveBeenCalled();
  });

  it('leaves a skill with real naming alone', async () => {
    const connector = repairConnector();

    const naming = await repairSkillNaming(
      c,
      connector,
      brokenSkill({ description: 'Books tables for restaurant guests.' }),
      'Helps guests of the restaurant.',
    );

    expect(naming).toBeNull();
    expect(mockParse).not.toHaveBeenCalled();
    expect(vi.mocked(connector.getSkills)).not.toHaveBeenCalled();
  });

  it('leaves a skill with no seed prompt alone', async () => {
    const connector = repairConnector();

    expect(
      await repairSkillNaming(
        c,
        connector,
        brokenSkill({ seed_system_prompt: null }),
        'Helps guests of the restaurant.',
      ),
    ).toBeNull();
    expect(mockParse).not.toHaveBeenCalled();
  });

  it('answers null when the rename cannot be written', async () => {
    const connector = repairConnector();
    vi.mocked(connector.updateSkill).mockRejectedValue(new Error('storage'));
    modelSays({
      name: 'restaurant-concierge',
      description: 'Books tables and answers questions about the restaurant.',
    });

    await expect(
      repairSkillNaming(
        c,
        connector,
        brokenSkill(),
        'Helps guests of the restaurant.',
      ),
    ).resolves.toBeNull();
  });
});

describe('awaitingRealNaming', () => {
  it('flags only auto-created skills still carrying the fallback', () => {
    const description = `${HEURISTIC_DESCRIPTION_PREFIX} You translate.`;
    expect(awaitingRealNaming({ auto_created: true, description })).toBe(true);
    expect(awaitingRealNaming({ auto_created: false, description })).toBe(
      false,
    );
    expect(
      awaitingRealNaming({
        auto_created: true,
        description: 'Translates whatever the user sends.',
      }),
    ).toBe(false);
  });
});
