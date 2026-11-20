import type { APIRequestContext } from '@playwright/test';
import { recordModel, recordProvider } from './cleanup';
import { STUB_URL, uniqueModelName } from './gateway';

const PROVIDERS_PATH = '/v1/super-agents/ai-providers';
const MODELS_PATH = '/v1/super-agents/models';

export const SYSTEM_ONE_PATH = '/v1/systemone';

/** A System One answer, as much of it as these specs read. */
export interface SystemOneAnswerBody {
  model: string;
  provider?: string;
  answers: Record<string, { type: string; noul?: number; choice?: string }>;
  usage?: { input_tokens: number; output_tokens: number };
}

/**
 * A decision model served by the stub, the way a self-hosted Drex is: the
 * `nace` provider with a custom host and no key. Its name is unique, which is
 * how the stub keeps this caller's traffic apart.
 */
export const createDecisionModel = async (
  request: APIRequestContext,
  scope: string,
): Promise<{ id: string; name: string }> => {
  const provider = await request.post(PROVIDERS_PATH, {
    data: {
      ai_provider: 'nace',
      name: uniqueModelName(`${scope}-provider`),
      custom_fields: { custom_host: STUB_URL },
    },
  });
  if (provider.status() !== 201) {
    throw new Error(
      `POST ${PROVIDERS_PATH} -> ${provider.status()} ${await provider.text()}`,
    );
  }
  const { id: providerId } = (await provider.json()) as { id: string };
  recordProvider(providerId);

  const name = uniqueModelName(`${scope}-drex`);
  const model = await request.post(MODELS_PATH, {
    data: {
      ai_provider_id: providerId,
      model_name: name,
      model_type: 'decision',
    },
  });
  if (model.status() !== 201) {
    throw new Error(
      `POST ${MODELS_PATH} -> ${model.status()} ${await model.text()}`,
    );
  }
  const { id } = (await model.json()) as { id: string };
  recordModel(id);
  return { id, name };
};
