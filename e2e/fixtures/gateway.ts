import type { APIRequestContext } from '@playwright/test';

/**
 * The stub provider runs once for the whole suite, on its own origin, so every
 * helper here takes an absolute URL rather than relying on a project baseURL.
 */
export const STUB_URL = process.env.E2E_STUB_URL ?? 'http://127.0.0.1:3103';

export const CHAT_COMPLETIONS_PATH = '/v1/chat/completions';

/**
 * Model names are how the stub separates one test's traffic from another's.
 * The suite runs in parallel against a single stub process, so a shared name
 * would mean shared recorded requests and shared injected failures.
 */
export const uniqueModelName = (prefix: string): string => {
  const stamp = Date.now().toString(36);
  const salt = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${stamp}-${salt}`;
};

export interface TargetOptions {
  model: string;
  cache?: { mode: 'disabled' | 'simple' | 'semantic' };
  retry?: { attempts: number; on_status_codes?: number[] };
}

/**
 * Builds the `sa-config` header.
 *
 * The target names the provider and model directly rather than going through
 * `optimization: auto`, which keeps these tests about the gateway -- transform,
 * stream, cache, retry -- instead of about arm selection. `ollama` is the
 * provider being imitated because it is OpenAI-compatible, needs no API key,
 * and honours `custom_host`.
 */
export const saConfig = (
  agentName: string,
  skillName: string,
  target: TargetOptions,
): string =>
  JSON.stringify({
    agent_name: agentName,
    skill_name: skillName,
    targets: [
      {
        provider: 'ollama',
        custom_host: STUB_URL,
        ...target,
      },
    ],
  });

/**
 * OpenAI-compatible clients always send `model`, and the gateway requires it
 * even though it replaces the value with the one the target resolved to.
 */
export const chatBody = (content: string, stream = false) => ({
  model: 'ignored-by-the-gateway',
  messages: [{ role: 'user', content }],
  ...(stream ? { stream: true } : {}),
});

/** Request bodies the gateway forwarded to the provider, oldest first. */
export const stubRequests = async (
  request: APIRequestContext,
  model: string,
): Promise<Record<string, unknown>[]> => {
  const response = await request.get(
    `${STUB_URL}/__control/requests?model=${encodeURIComponent(model)}`,
  );
  const body = (await response.json()) as {
    requests: Record<string, unknown>[];
  };
  return body.requests;
};

/** Make the next `times` calls for this model fail with `status`. */
export const stubFail = async (
  request: APIRequestContext,
  model: string,
  times: number,
  status = 503,
): Promise<void> => {
  await request.post(`${STUB_URL}/__control/fail`, {
    data: { model, times, status },
  });
};

/**
 * Make structured-output replies for this model come back inside a markdown
 * fence -- what a provider does when `response_format` reached it as prompt
 * text rather than as an enforced schema.
 */
export const stubFence = async (
  request: APIRequestContext,
  model: string,
): Promise<void> => {
  await request.post(`${STUB_URL}/__control/fence`, { data: { model } });
};

/**
 * Make every reply for this model carry `content`, whatever the request asked
 * for -- how a test scripts a reviewer's verdict. A list is answered in
 * order, and its last entry is what every reply after it carries.
 */
export const stubReply = async (
  request: APIRequestContext,
  model: string,
  content: string | string[],
): Promise<void> => {
  await request.post(`${STUB_URL}/__control/reply`, {
    data: { model, content },
  });
};

export const stubReset = async (
  request: APIRequestContext,
  model: string,
): Promise<void> => {
  try {
    await request.post(`${STUB_URL}/__control/reset`, { data: { model } });
  } catch {
    // Ignored: teardown must not mask the assertion that actually failed.
  }
};

/** Collects the `data:` payloads from an SSE body, ignoring the [DONE] marker. */
export const parseSSE = (body: string): Record<string, unknown>[] =>
  body
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => line.slice('data: '.length).trim())
    .filter((payload) => payload && payload !== '[DONE]')
    .map((payload) => JSON.parse(payload) as Record<string, unknown>);
