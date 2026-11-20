import { drexImages, withImageOrdinals } from '@api/ai-providers/nace/images';
import {
  systemOneRequestConfig,
  systemOneResponseTransform,
} from '@api/ai-providers/system-one';
import type {
  AIProviderConfig,
  InternalProviderAPIConfig,
} from '@shared/types/ai-providers/config';
import { FunctionName } from '@shared/types/api/request';
import type {
  ChatCompletionParameterTransformFunction,
  ParameterValueTypes,
} from '@shared/types/api/response/body';
import type { SystemOneRequestBody } from '@shared/types/api/routes/system-one-api';
import { AIProvider } from '@shared/types/constants';
import { z } from 'zod';

/**
 * Where a self-hosted Drex answers. Drex's weights are published, and its own
 * servers -- Kapitsa, and the llama.cpp and Ollama forks -- serve the same
 * `/v1/systemone` the hosted API does, without a key.
 */
export const NaceCustomFieldsSchema = z.object({
  custom_host: z
    .string()
    .optional()
    .describe('Base URL of a self-hosted Drex, e.g. http://localhost:8000'),
});

/**
 * Nace.AI, which serves Drex: a decision model on the System One API, hosted
 * at https://console.nace.ai with `nace_sk_` keys, or self-hosted on the same
 * route. Its API reference is
 * https://console.nace.ai/docs/drex/api-reference/systemone.
 *
 * The gateway uses a custom host in place of `getBaseURL` when one is set.
 */
export const naceAPIConfig: InternalProviderAPIConfig = {
  getBaseURL: () => 'https://console.nace.ai',
  headers: ({ saTarget }) => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    // A self-hosted server has no key to check, and the hosted API answers
    // a missing one with its own 401.
    if (saTarget.api_key) {
      headers.Authorization = `Bearer ${saTarget.api_key}`;
    }
    return headers;
  },
  getEndpoint: ({ saRequestData }) =>
    saRequestData.functionName === FunctionName.SYSTEM_ONE
      ? '/v1/systemone'
      : '',
  customFieldsSchema: NaceCustomFieldsSchema,
  isAPIKeyRequired: false,
};

/**
 * A parameter transform over the System One body. The provider config types
 * every transform by the chat API's body, as for every other provider.
 */
const fromBody =
  (
    pick: (body: SystemOneRequestBody) => unknown,
  ): ChatCompletionParameterTransformFunction =>
  (params) =>
    pick(params as unknown as SystemOneRequestBody) as ParameterValueTypes;

export const naceConfig: AIProviderConfig = {
  api: naceAPIConfig,
  [FunctionName.SYSTEM_ONE]: {
    // Drex's `model` is optional, and served as `drex-latest` when left out.
    ...systemOneRequestConfig(),
    // Drex numbers its images: each reference becomes "Image N".
    state: {
      param: 'state',
      required: true,
      transform: fromBody((body) => withImageOrdinals(body.state, body.assets)),
    },
    questions: {
      param: 'questions',
      required: true,
      transform: fromBody((body) =>
        withImageOrdinals(body.questions, body.assets),
      ),
    },
    assets: {
      param: 'images',
      transform: fromBody((body) => drexImages(body.assets)),
    },
  },
  responseTransforms: {
    [FunctionName.SYSTEM_ONE]: systemOneResponseTransform(AIProvider.NACE),
  },
};
