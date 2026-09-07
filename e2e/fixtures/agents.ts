import type { APIRequestContext } from '@playwright/test';

export const AGENTS_PATH = '/v1/super-agents/agents';

/** The API rejects a description shorter than 25 characters. */
export const SAMPLE_DESCRIPTION =
  'An agent created by the end-to-end suite to exercise the storage path.';

/**
 * Agent names are unique across the deployment and the suite runs in parallel,
 * so every test coins its own rather than sharing a fixture row. Restricted to
 * the character class the API enforces: lowercase letters, digits, `_` and `-`.
 */
export const uniqueAgentName = (prefix: string): string => {
  const stamp = Date.now().toString(36);
  const salt = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${stamp}_${salt}`;
};

export interface Agent {
  id: string;
  name: string;
  description: string;
  metadata: Record<string, unknown>;
  auto_create_skills: boolean;
  skill_match_threshold: number;
  max_auto_created_skills: number;
  reviewer_agent_id: string | null;
  review_fail_closed: boolean;
  review_expose_reason: boolean;
  created_at: string;
  updated_at: string;
}

export const createAgent = async (
  request: APIRequestContext,
  name: string,
  description: string = SAMPLE_DESCRIPTION,
  overrides: Record<string, unknown> = {},
): Promise<Agent> => {
  const response = await request.post(AGENTS_PATH, {
    data: { name, description, ...overrides },
  });

  if (response.status() !== 201) {
    throw new Error(
      `Failed to create agent "${name}": ${response.status()} ${await response.text()}`,
    );
  }

  return response.json() as Promise<Agent>;
};

/**
 * Best-effort teardown. Swallows failures because it runs in `finally` blocks,
 * where throwing would replace the real assertion error with a cleanup one.
 */
export const deleteAgent = async (
  request: APIRequestContext,
  id: string,
): Promise<void> => {
  try {
    await request.delete(`${AGENTS_PATH}/${id}`);
  } catch {
    // Ignored: the test's own result is what matters.
  }
};

/** The agent's default models: what a skill the gateway creates for it starts with. */
export const addModelsToAgent = async (
  request: APIRequestContext,
  agentId: string,
  modelIds: string[],
): Promise<void> => {
  const response = await request.post(`${AGENTS_PATH}/${agentId}/models`, {
    data: { modelIds },
  });
  if (response.status() !== 201) {
    throw new Error(
      `POST ${AGENTS_PATH}/${agentId}/models -> ${response.status()} ${await response.text()}`,
    );
  }
};

/** A skill's routing row: how the router sees the skill. */
export interface SkillRouting {
  skill_id: string;
  agent_id: string;
  centroid: number[];
  embedding_model_id: string;
  sample_count: number;
  created_at: string;
  updated_at: string;
}

/** The routing rows of the agent's skills, one per skill the router has met. */
export const getSkillRoutings = async (
  request: APIRequestContext,
  agentId: string,
): Promise<SkillRouting[]> => {
  const response = await request.get(
    `${AGENTS_PATH}/${agentId}/skill-routings`,
  );
  if (response.status() !== 200) {
    throw new Error(
      `GET ${AGENTS_PATH}/${agentId}/skill-routings -> ${response.status()} ${await response.text()}`,
    );
  }
  return response.json() as Promise<SkillRouting[]>;
};
