import type { UserDataStorageConnector } from '@api/types/connector';
import type { AppContext } from '@api/types/hono';
import {
  agentTypeChangeProblem,
  agentTypeFor,
  requestTypeProblem,
  servingModelsProblem,
} from '@api/utils/super-agents/agent-type';
import { FunctionName } from '@shared/types/api/request/function-name';
import { describe, expect, it, vi } from 'vitest';

const c = {} as AppContext;
const helper = { id: 'agent-1', name: 'helper', agent_type: 'text' as const };
const guard = { id: 'agent-2', name: 'guard', agent_type: 'decision' as const };

describe('agentTypeFor', () => {
  it('sends what writes to LLM agents and System One to decision agents', () => {
    for (const fn of [
      FunctionName.CHAT_COMPLETE,
      FunctionName.STREAM_CHAT_COMPLETE,
      FunctionName.COMPLETE,
      FunctionName.STREAM_COMPLETE,
      FunctionName.CREATE_MODEL_RESPONSE,
    ]) {
      expect(agentTypeFor(fn)).toBe('text');
    }
    expect(agentTypeFor(FunctionName.SYSTEM_ONE)).toBe('decision');
  });

  // An embedding sent with a target of its own reaches no serving model.
  it('says nothing about the rest', () => {
    expect(agentTypeFor(FunctionName.EMBED)).toBeNull();
  });
});

describe('requestTypeProblem', () => {
  it('lets each agent answer what its models can', () => {
    expect(requestTypeProblem(helper, FunctionName.CHAT_COMPLETE)).toBeNull();
    expect(requestTypeProblem(guard, FunctionName.SYSTEM_ONE)).toBeNull();
    expect(requestTypeProblem(guard, FunctionName.EMBED)).toBeNull();
  });

  it('points a chat request at a decision agent to System One', () => {
    expect(requestTypeProblem(guard, FunctionName.CHAT_COMPLETE)).toBe(
      'Agent "guard" is a decision agent; ask it through /v1/systemone.',
    );
  });

  it('turns a System One request away from an LLM agent', () => {
    expect(requestTypeProblem(helper, FunctionName.SYSTEM_ONE)).toBe(
      'Agent "helper" is an LLM agent, and System One requests are for decision agents.',
    );
  });
});

describe('servingModelsProblem', () => {
  const connector = (models: Record<string, unknown>) =>
    ({
      getModels: vi.fn(async (_c, { id }: { id: string }) =>
        models[id] ? [models[id]] : [],
      ),
    }) as unknown as UserDataStorageConnector;
  const store = connector({
    gpt: { id: 'gpt', model_name: 'gpt-5', model_type: 'text' },
    jev: { id: 'jev', model_name: 'jev-latest', model_type: 'decision' },
  });

  it('takes models of the agent type', async () => {
    expect(await servingModelsProblem(c, store, helper, ['gpt'])).toBeNull();
    expect(await servingModelsProblem(c, store, guard, ['jev'])).toBeNull();
  });

  it('names the model of the wrong type', async () => {
    expect(await servingModelsProblem(c, store, helper, ['gpt', 'jev'])).toBe(
      '"jev-latest" is a decision model, and agent "helper" is an LLM agent, served by text models.',
    );
  });

  it('names a model that does not exist', async () => {
    expect(await servingModelsProblem(c, store, guard, ['nope'])).toBe(
      'Model nope does not exist.',
    );
  });
});

describe('agentTypeChangeProblem', () => {
  const connector = (
    ownModels: unknown[],
    skillModels: Record<string, unknown[]>,
  ) =>
    ({
      getAgentModels: vi.fn().mockResolvedValue(ownModels),
      getSkills: vi
        .fn()
        .mockResolvedValue(Object.keys(skillModels).map((id) => ({ id }))),
      getSkillModels: vi.fn(async (_c, id: string) => skillModels[id]),
    }) as unknown as UserDataStorageConnector;

  it('lets an agent without models change type', async () => {
    expect(
      await agentTypeChangeProblem(
        c,
        connector([], { s1: [] }),
        helper,
        'decision',
      ),
    ).toBeNull();
  });

  it('has nothing to say when the type is not changing', async () => {
    const store = connector([{ id: 'gpt' }], {});
    expect(await agentTypeChangeProblem(c, store, helper, 'text')).toBeNull();
    expect(
      await agentTypeChangeProblem(c, store, helper, undefined),
    ).toBeNull();
    expect(store.getAgentModels).not.toHaveBeenCalled();
  });

  it('keeps the type of an agent with default models', async () => {
    expect(
      await agentTypeChangeProblem(
        c,
        connector([{ id: 'gpt' }], {}),
        helper,
        'decision',
      ),
    ).toBe('An agent with default models keeps its type; remove them first.');
  });

  it('keeps the type of an agent whose skills have models', async () => {
    expect(
      await agentTypeChangeProblem(
        c,
        connector([], { s1: [], s2: [{ id: 'gpt' }] }),
        helper,
        'decision',
      ),
    ).toBe(
      'An agent whose skills have models keeps its type; remove them first.',
    );
  });
});
