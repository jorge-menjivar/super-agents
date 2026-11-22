import { createMockContext } from '@api/test-utils/mock-context';
import type { UserDataStorageConnector } from '@api/types/connector';
import { resolveRoleModel } from '@api/utils/evaluation-model-resolver';
import {
  clearCompactedPrompts,
  compactSystemPrompt,
} from '@api/utils/super-agents/intent-compaction';
import { ReasoningEffort } from '@shared/types/api/routes/shared/thinking';
import { AIProvider } from '@shared/types/constants';
import type { Agent, SystemSettings } from '@shared/types/data';
import { AgentOptions } from '@shared/types/data/agent';
import { SystemSettingsOptions } from '@shared/types/data/system-settings';
import { SYSTEM_PROMPT_BUDGET } from '@shared/utils/request-intent';
import OpenAI from 'openai';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A system prompt too long to embed whole is compacted by a model, once per
 * distinct prompt, and truncation is the fallback whenever the model cannot
 * be asked -- routing must go on either way.
 */

const mockCreate = vi.fn();

vi.mock('openai', () => ({
  default: vi.fn(
    class {
      withOptions = () => ({ chat: { completions: { create: mockCreate } } });
    },
  ),
}));

vi.mock('@api/constants', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@api/constants')>()),
  getApiUrl: () => 'http://localhost:8787',
}));

vi.mock('@api/utils/evaluation-model-resolver', () => ({
  resolveRoleModel: vi.fn(),
}));

const settings = {
  intent_compaction_model_id: null,
  system_prompt_reflection_model_id: 'reflection-model',
  options: SystemSettingsOptions.parse({
    intent_compaction: { timeout_ms: 90_000 },
  }),
} as SystemSettings;
const connector = {
  getSystemSettings: vi.fn().mockResolvedValue(settings),
} as unknown as UserDataStorageConnector;
const agent = {
  id: 'agent-1',
  name: 'helper',
  intent_compaction_model_id: null,
  options: AgentOptions.parse({}),
} as Agent;
const longPrompt = `You are a coding CLI. ${'x'.repeat(9000)}`;

describe('compactSystemPrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearCompactedPrompts();
    vi.mocked(resolveRoleModel).mockResolvedValue({
      model: 'reflect-model',
      provider: AIProvider.OPENAI,
      apiKey: 'key',
      timeoutMs: 90_000,
    } as never);
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'A coding CLI for the blog.' } }],
    });
  });

  it('compacts a prompt once and reuses the summary', async () => {
    const c = createMockContext();
    const first = await compactSystemPrompt(c, connector, agent, longPrompt);
    const second = await compactSystemPrompt(c, connector, agent, longPrompt);

    expect(first).toBe('A coding CLI for the blog.');
    expect(second).toBe(first);
    expect(mockCreate).toHaveBeenCalledTimes(1);
    // Deterministic, so the identity embedding stays put across restarts.
    expect(mockCreate.mock.calls[0][0].temperature).toBe(0);
    expect(JSON.stringify(mockCreate.mock.calls[0])).toContain(
      'You are a coding CLI.',
    );
  });

  it('caps what the model may write, so no model holds up routing for long', async () => {
    await compactSystemPrompt(
      createMockContext(),
      connector,
      agent,
      longPrompt,
    );

    const body = mockCreate.mock.calls[0][0];
    expect(body.max_completion_tokens).toBe(2000);
    // OpenAI's reasoning models refuse `max_tokens`.
    expect(body).not.toHaveProperty('max_tokens');
  });

  it('asks for a short summary without naming a count to check it against', async () => {
    await compactSystemPrompt(
      createMockContext(),
      connector,
      agent,
      longPrompt,
    );

    // A thinking model told "at most N characters" counts its summary out
    // letter by letter; the cut to the budget enforces the length instead.
    const instruction = mockCreate.mock.calls[0][0].messages[0].content;
    expect(instruction).toContain('short summary');
    expect(instruction).not.toMatch(/\d/);
  });

  it('falls back to the head of the prompt, saying why, when thinking spent the whole budget', async () => {
    const warning = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: '' }, finish_reason: 'length' }],
    });

    const fallback = await compactSystemPrompt(
      createMockContext(),
      connector,
      agent,
      longPrompt,
    );

    expect(fallback).toBe(longPrompt.slice(0, SYSTEM_PROMPT_BUDGET));
    expect(JSON.stringify(warning.mock.calls)).toContain(
      "lower intent compaction's reasoning effort",
    );
    warning.mockRestore();
  });

  it('keeps a summary the cap cut short', async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: { content: 'A coding CLI that edits files and' },
          finish_reason: 'length',
        },
      ],
    });

    const summary = await compactSystemPrompt(
      createMockContext(),
      connector,
      agent,
      longPrompt,
    );

    expect(summary).toBe('A coding CLI that edits files and');
  });

  it('sends the reasoning effort the resolver settled on', async () => {
    vi.mocked(resolveRoleModel).mockResolvedValue({
      model: 'reflect-model',
      provider: AIProvider.OPENAI,
      apiKey: 'key',
      timeoutMs: 90_000,
      reasoningEffort: ReasoningEffort.NONE,
    } as never);

    await compactSystemPrompt(
      createMockContext(),
      connector,
      agent,
      longPrompt,
    );

    // Summarising is transcription rather than deliberation, and a request
    // carrying the prompt waits for it.
    expect(mockCreate.mock.calls[0][0]).toMatchObject({
      reasoning_effort: 'none',
    });
  });

  it('sends none when nothing named an effort', async () => {
    await compactSystemPrompt(
      createMockContext(),
      connector,
      agent,
      longPrompt,
    );

    expect(mockCreate.mock.calls[0][0]).not.toHaveProperty('reasoning_effort');
  });

  it('waits as long as the resolved timeout allows, and asks for this agent', async () => {
    await compactSystemPrompt(
      createMockContext(),
      connector,
      agent,
      longPrompt,
    );

    // The prompts that need compacting are long, so the wait is a setting
    // rather than a constant -- a slow model would otherwise never finish.
    expect(vi.mocked(OpenAI).mock.calls[0][0]).toMatchObject({
      timeout: 90_000,
    });
    expect(vi.mocked(resolveRoleModel)).toHaveBeenCalledWith(
      expect.anything(),
      'intent_compaction',
      connector,
      agent,
    );
  });

  it('falls back to the head of the prompt when the model fails, and retries next time', async () => {
    const c = createMockContext();
    mockCreate.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));

    const fallback = await compactSystemPrompt(c, connector, agent, longPrompt);
    expect(fallback).toBe(longPrompt.slice(0, SYSTEM_PROMPT_BUDGET));

    // The failure was not kept: the next request asks again.
    const retried = await compactSystemPrompt(c, connector, agent, longPrompt);
    expect(retried).toBe('A coding CLI for the blog.');
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it('falls back when no model is configured', async () => {
    vi.mocked(resolveRoleModel).mockResolvedValue(null);

    const fallback = await compactSystemPrompt(
      createMockContext(),
      connector,
      agent,
      longPrompt,
    );

    expect(fallback).toBe(longPrompt.slice(0, SYSTEM_PROMPT_BUDGET));
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('bounds even a rambling summary to the embedding budget', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'y'.repeat(9000) } }],
    });

    const summary = await compactSystemPrompt(
      createMockContext(),
      connector,
      agent,
      longPrompt,
    );

    expect(summary).toHaveLength(SYSTEM_PROMPT_BUDGET);
  });
});
