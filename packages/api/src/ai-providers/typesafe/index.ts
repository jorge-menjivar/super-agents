import {
  hasImages,
  systemOneRequestConfig,
  systemOneResponseTransform,
} from '@api/ai-providers/system-one';
import type {
  AIProviderConfig,
  InternalProviderAPIConfig,
} from '@shared/types/ai-providers/config';
import { FunctionName } from '@shared/types/api/request';
import { AIProvider } from '@shared/types/constants';

/**
 * TypeSafe AI, which serves Jev: a hosted decision model on the System One
 * API. Its API reference is https://docs.typesafe.ai/api.
 */
export const typesafeAPIConfig: InternalProviderAPIConfig = {
  getBaseURL: () => 'https://api.typesafe.ai',
  headers: ({ saTarget, saRequestData }) => ({
    Authorization: `Bearer ${saTarget.api_key}`,
    'Content-Type': 'application/json',
    // Images are not on by default: a request carrying any says so, or is
    // refused with "Images are not turned on".
    ...(hasImages(saRequestData.requestBody)
      ? { 'TypeSafe-Danger-Zone-Images': 'true' }
      : {}),
  }),
  getEndpoint: ({ saRequestData }) =>
    saRequestData.functionName === FunctionName.SYSTEM_ONE
      ? '/v1/systemone'
      : '',
};

export const typesafeConfig: AIProviderConfig = {
  api: typesafeAPIConfig,
  // TypeSafe requires a model; `jev-latest` is the one its own examples use.
  [FunctionName.SYSTEM_ONE]: systemOneRequestConfig('jev-latest'),
  responseTransforms: {
    [FunctionName.SYSTEM_ONE]: systemOneResponseTransform(AIProvider.TYPESAFE),
  },
};
