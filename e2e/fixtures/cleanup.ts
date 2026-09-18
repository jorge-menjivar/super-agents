import type { APIRequestContext } from '@playwright/test';

const AGENTS_PATH = '/v1/super-agents/agents';
const PROVIDERS_PATH = '/v1/super-agents/ai-providers';
const MODELS_PATH = '/v1/super-agents/models';
const SETTINGS_PATH = '/v1/super-agents/system-settings';

/**
 * What this worker has made, and what it found before changing it.
 *
 * Specs undo their own where it is natural to, and should: a test that leaves
 * its rows behind is also a test whose next assertion reads a fuller database
 * than it meant to. This is the backstop -- a spec that forgets, a row made
 * in a `beforeAll`, a test that failed before reaching its `finally` -- and
 * the one place that cannot be forgotten, because everything the suite makes
 * comes through these fixtures.
 *
 * It matters more than tidiness. The suite is pointed at a server, not at a
 * database, and `reuseExistingServer` means the server on the port is not
 * always the throwaway one the config would have started.
 *
 * What it deliberately leaves alone is the deployment's own: the
 * `super-agents` agent and its internal skills, which the server creates for
 * itself and whose prompts have evolved, and the logs the gateway wrote for
 * the internal calls the tests provoked. Those are records of work that
 * really happened, not rows the suite made.
 */
const agents = new Set<string>();
const providers = new Set<string>();
const models = new Set<string>();

/**
 * The model-id columns of the singleton settings row as they were before this
 * worker touched them. Captured once, by whatever first changes them.
 *
 * The singleton is the sharpest edge here: the internal skills resolve
 * through it, so a run that leaves the stub's models in it leaves the
 * deployment judging, embedding and reflecting through a provider that is no
 * longer listening -- silently, because every one of those callers swallows
 * its error.
 */
const SETTINGS_MODEL_COLUMNS = [
  'judge_model_id',
  'embedding_model_id',
  'system_prompt_reflection_model_id',
  'evaluation_generation_model_id',
  'skill_arbiter_model_id',
  'intent_compaction_model_id',
] as const;

let settingsBefore: Record<string, unknown> | undefined;

export const recordAgent = (id: string): void => {
  agents.add(id);
};
export const forgetAgent = (id: string): void => {
  agents.delete(id);
};
export const recordProvider = (id: string): void => {
  providers.add(id);
};
export const recordModel = (id: string): void => {
  models.add(id);
};

/**
 * Reads the settings row, once per worker, before anything changes it.
 * Whatever is about to write the model ids calls this first.
 */
export const rememberSystemSettings = async (
  request: APIRequestContext,
): Promise<void> => {
  if (settingsBefore !== undefined) return;
  const response = await request.get(SETTINGS_PATH);
  if (!response.ok()) return;
  const settings = (await response.json()) as Record<string, unknown>;
  settingsBefore = Object.fromEntries(
    SETTINGS_MODEL_COLUMNS.map((column) => [column, settings[column] ?? null]),
  );
};

const remove = async (
  request: APIRequestContext,
  path: string,
): Promise<boolean> => {
  try {
    const response = await request.delete(path);
    return response.ok();
  } catch {
    // Best effort: the run's result is what matters, and the next one coins
    // new names rather than colliding with what is left.
    return false;
  }
};

export interface CleanUpSummary {
  agents: number;
  models: number;
  providers: number;
  settingsRestored: boolean;
}

/**
 * Puts back everything this worker changed.
 *
 * Order matters. The settings row is restored first, because a model it still
 * points at cannot be deleted -- those columns are `ON DELETE RESTRICT`.
 * Agents go next, which cascades to their skills, logs, evaluation runs and
 * feedback; then the models, then the providers they hang off.
 */
export const cleanUp = async (
  request: APIRequestContext,
): Promise<CleanUpSummary> => {
  const summary: CleanUpSummary = {
    agents: 0,
    models: 0,
    providers: 0,
    settingsRestored: false,
  };

  if (settingsBefore !== undefined) {
    try {
      const response = await request.patch(SETTINGS_PATH, {
        data: settingsBefore,
      });
      summary.settingsRestored = response.ok();
    } catch {
      // Reported by the counts rather than thrown: a teardown that fails the
      // run would hide whatever the run was actually about.
    }
    settingsBefore = undefined;
  }

  for (const [ids, path, counted] of [
    [agents, AGENTS_PATH, 'agents'],
    [models, MODELS_PATH, 'models'],
    [providers, PROVIDERS_PATH, 'providers'],
  ] as const) {
    const remaining = [...ids];
    ids.clear();
    const removed = await Promise.all(
      remaining.map((id) => remove(request, `${path}/${id}`)),
    );
    summary[counted] = removed.filter(Boolean).length;
  }

  return summary;
};
