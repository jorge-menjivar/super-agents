import {
  generateReflectiveSystemPromptForSkill,
  generateSeedSystemPromptForSkill,
  generateSeedSystemPromptWithContext,
} from '@api/optimization/utils/system-prompt';
import { createMockContext } from '@api/test-utils/mock-context';
import type { UserDataStorageConnector } from '@api/types/connector';
import {
  agentById,
  resolveRoleModel,
} from '@api/utils/evaluation-model-resolver';
import { ReasoningEffort } from '@shared/types/api/routes/shared/thinking';
import { AIProvider } from '@shared/types/constants';
import type { Agent, Skill } from '@shared/types/data';
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
  resolveRoleModel: vi.fn(async () => ({
    model: 'gpt-5-mini',
    provider: AIProvider.OPENAI,
    apiKey: 'sk-test',
  })),
}));

const c = createMockContext();
const connector = {} as UserDataStorageConnector;

/** The message the model was asked with. */
const askedWith = (): string =>
  (mockParse.mock.calls[0][0] as { messages: { content: string }[] })
    .messages[1].content;

/** What the model was told it is, in the system message. */
const toldItIs = (): string =>
  (mockParse.mock.calls[0][0] as { messages: { content: string }[] })
    .messages[0].content;

describe('generateSeedSystemPromptWithContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockParse.mockResolvedValue({
      choices: [{ message: { parsed: { system_prompt: 'Improved prompt' } } }],
    });
  });

  it('hands the model the seed prompt to improve on', async () => {
    // A skill the gateway created keeps its caller's prompt; regeneration
    // is asked to build on it rather than write another from the description.
    const result = await generateSeedSystemPromptWithContext(
      c,
      'An agent for restaurants.',
      'Books tables.',
      ['User: a table for two\nAssistant: Booked.'],
      connector,
      undefined,
      undefined,
      'You are the concierge. Always confirm the time.',
    );

    expect(result).toBe('Improved prompt');
    const message = askedWith();
    expect(message).toContain(
      'You are the concierge. Always confirm the time.',
    );
    expect(message).toContain('improve on it rather than replacing it');
    expect(message).toContain('Books tables.');
  });

  it('says nothing about a seed prompt when there is none', async () => {
    await generateSeedSystemPromptWithContext(
      c,
      'An agent for restaurants.',
      'Books tables.',
      ['User: a table for two\nAssistant: Booked.'],
      connector,
    );

    expect(askedWith()).not.toContain("developer's own system prompt");
  });

  it("sends the reflection role's reasoning effort", async () => {
    // Writing a prompt is the internal call where thinking tends to pay for
    // itself, so this role's setting has to reach the request. It travels
    // separately from the model here -- the client is built in one function
    // and the request in another -- which is where it would go missing.
    vi.mocked(resolveRoleModel).mockResolvedValueOnce({
      model: 'gpt-5-mini',
      provider: AIProvider.OPENAI,
      apiKey: 'sk-test',
      reasoningEffort: ReasoningEffort.HIGH,
    });

    await generateSeedSystemPromptWithContext(
      c,
      'An agent for restaurants.',
      'Books tables.',
      [],
      connector,
    );

    expect(mockParse.mock.calls[0][0]).toMatchObject({
      reasoning_effort: 'high',
    });
  });

  it('sends none when the role leaves the model to its default', async () => {
    await generateSeedSystemPromptWithContext(
      c,
      'An agent for restaurants.',
      'Books tables.',
      [],
      connector,
    );

    expect(mockParse.mock.calls[0][0]).not.toHaveProperty('reasoning_effort');
  });
});

/**
 * A decision skill's system prompt is a policy put ahead of each question a
 * decision model answers with probabilities. Written as a chat prompt, it is
 * a persona and an output format for a model with no use for either, so the
 * writers are told what they are writing.
 */
describe('writing for a decision agent', () => {
  const decisionAgent = {
    id: 'agent-1',
    agent_type: 'decision',
    description: "Reviews the coder's replies.",
  } as Agent;
  const textAgent = { ...decisionAgent, agent_type: 'text' } as Agent;
  const decisionExample =
    '## State\nTry the third window.\n\n## Answers\n- withhold: P(yes) = 0.40';

  beforeEach(() => {
    vi.clearAllMocks();
    mockParse.mockResolvedValue({
      choices: [{ message: { parsed: { system_prompt: 'A policy' } } }],
    });
  });

  it('seeds a policy from the first requests, with no response format', async () => {
    await generateSeedSystemPromptWithContext(
      c,
      decisionAgent.description,
      'Withholds replies that help someone into a home.',
      [decisionExample],
      connector,
      { type: 'json_schema' },
      undefined,
      '',
      decisionAgent,
    );

    const message = askedWith();
    expect(toldItIs()).toContain('policies decision models answer under');
    expect(message).toContain("What you write is the skill's policy");
    expect(message).toContain('placed ahead of every question');
    expect(message).toContain(decisionExample);
    expect(message).not.toContain('JSON schema');
  });

  it('seeds a policy from the description alone', async () => {
    vi.mocked(agentById).mockResolvedValueOnce(decisionAgent);

    await generateSeedSystemPromptForSkill(
      c,
      { agent_id: 'agent-1', description: 'Withholds replies.' } as Skill,
      connector,
    );

    expect(askedWith()).toContain('write the policy its decision model');
    expect(askedWith()).toContain('Withholds replies.');
  });

  it('reflects on a policy, starting from none', async () => {
    await generateReflectiveSystemPromptForSkill(
      c,
      '',
      [decisionExample],
      [decisionExample],
      decisionAgent.description,
      'Withholds replies.',
      [],
      connector,
      decisionAgent,
    );

    const message = askedWith();
    expect(toldItIs()).toContain('refining the policies decision models');
    expect(message).toContain('# Current Policy');
    expect(message).toContain('(none yet');
    expect(message).toContain('Settles** each case the failures got wrong');
  });

  it('writes a chat prompt for an LLM agent, as before', async () => {
    await generateReflectiveSystemPromptForSkill(
      c,
      'You are a concierge.',
      ['User: hi\nAssistant: Hello.'],
      ['User: hi\nAssistant: Go away.'],
      textAgent.description,
      'Greets guests.',
      [],
      connector,
      textAgent,
    );

    expect(askedWith()).toContain('# Current System Prompt');
    expect(askedWith()).not.toContain('policy');
  });
});
