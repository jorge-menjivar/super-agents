import {
  type AIProvider,
  DECISION_PROVIDER_MODELS,
  PrettyAIProvider,
} from '@shared/types/constants';
import type { FlattenedModel } from '@shared/types/models-dev';
import {
  flattenModelsDevResponse,
  parseModelsDevResponse,
} from '@shared/types/models-dev';
import { useQuery } from '@tanstack/react-query';
import { mapAIProviderToModelsDev } from '@web/utils/models-dev-mapping';

const MODELS_DEV_API_URL = '/v1/super-agents/models-dev';

/**
 * Fetch models from models.dev API via our proxy endpoint
 */
const fetchModelsDev = async (): Promise<FlattenedModel[]> => {
  try {
    const response = await fetch(MODELS_DEV_API_URL, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
      credentials: 'include', // Include cookies for authentication if needed
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      console.error(
        `[models-dev] Failed to fetch: ${response.status} ${errorText}`,
      );
      throw new Error(
        `Failed to fetch models from models.dev: ${response.status} ${errorText}`,
      );
    }

    const data = await response.json();
    let parsed: ReturnType<typeof parseModelsDevResponse>;
    try {
      parsed = parseModelsDevResponse(data);
    } catch (parseError) {
      console.error('[models-dev] Zod validation error:', parseError);
      if (parseError instanceof Error) {
        throw new Error(
          `Failed to parse models.dev response: ${parseError.message}`,
        );
      }
      throw new Error('Failed to parse models.dev response: Unknown error');
    }
    const flattened = flattenModelsDevResponse(parsed);
    return flattened;
  } catch (error) {
    console.error('[models-dev] Error fetching models:', error);
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Unknown error while fetching models from models.dev');
  }
};

/**
 * Filter models by provider ID (models.dev provider identifier)
 */
export const filterModelsByProvider = (
  models: FlattenedModel[],
  providerId: string | null,
): FlattenedModel[] => {
  if (providerId === null) {
    return models;
  }

  return models.filter((item) => item.providerId === providerId);
};

/**
 * Filter models by query string (fuzzy match on model ID and name)
 */
export const filterModelsByQuery = (
  models: FlattenedModel[],
  query: string,
): FlattenedModel[] => {
  if (query.trim() === '') {
    return models;
  }

  const lowerQuery = query.toLowerCase().trim();

  return models.filter((item) => {
    const modelId = (item.model.id ?? '').toLowerCase();
    const modelName = item.model.name?.toLowerCase() ?? '';

    return modelId.includes(lowerQuery) || modelName.includes(lowerQuery);
  });
};

/**
 * React hook to fetch and cache models from models.dev
 * Returns all models, loading state, and error state
 */
export const useModelsDev = () => {
  const query = useQuery({
    queryKey: ['models-dev'],
    queryFn: fetchModelsDev,
    staleTime: 24 * 60 * 60 * 1000, // 24 hours
    gcTime: 7 * 24 * 60 * 60 * 1000, // 7 days
    retry: 2,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
  });

  // Log errors for debugging
  if (query.error) {
    console.error('[models-dev] Query error:', query.error);
  }

  return query;
};

/**
 * A decision provider's known models, shaped as models.dev entries. models.dev
 * lists no decision models, and a provider it has no entry for would
 * otherwise be offered every model it does list.
 */
const decisionModelsOf = (provider: AIProvider): FlattenedModel[] | null => {
  const ids = DECISION_PROVIDER_MODELS[provider];
  return ids
    ? ids.map((id) => ({
        model: { id, name: id },
        providerId: provider,
        providerName: PrettyAIProvider[provider],
      }))
    : null;
};

/**
 * React hook to get filtered models by AI provider
 * Maps internal AIProvider enum to models.dev provider ID and filters
 */
export const useModelsDevByProvider = (
  provider: AIProvider | null | undefined,
) => {
  const { data, isLoading, error } = useModelsDev();
  const allModels: FlattenedModel[] = data ?? [];

  const decisionModels = provider ? decisionModelsOf(provider) : null;
  if (decisionModels) {
    return { models: decisionModels, isLoading: false, error: null };
  }

  const filteredModels = provider
    ? filterModelsByProvider(allModels, mapAIProviderToModelsDev(provider))
    : allModels;

  return {
    models: filteredModels,
    isLoading,
    error,
  };
};

/**
 * React hook to get filtered models by AI provider and query string
 */
export const useModelsDevFiltered = (
  provider: AIProvider | null | undefined,
  query: string,
) => {
  const { models, isLoading, error } = useModelsDevByProvider(provider);

  const filteredModels = filterModelsByQuery(models, query);

  return {
    models: filteredModels,
    isLoading,
    error,
  };
};
