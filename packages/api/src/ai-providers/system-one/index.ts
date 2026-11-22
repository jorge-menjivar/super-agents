import {
  generateErrorResponse,
  generateInvalidProviderResponseError,
} from '@api/utils/ai-provider';
import type {
  AIProviderFunctionConfig,
  ResponseTransformFunction,
} from '@shared/types/ai-providers/config';
import type { ErrorResponseBody } from '@shared/types/api/response/body';
import { SystemOneResponseBody } from '@shared/types/api/routes/system-one-api';
import type { AIProvider } from '@shared/types/constants';

/**
 * The System One API, as every decision-model vendor serves it.
 *
 * Jev (TypeSafe AI) and Drex (Nace.AI) take the same request at the same path
 * and answer in the same shape, so the gateway forwards a System One request
 * as it came and returns the answer as it went -- stamped with the provider
 * that gave it. Only their errors differ, and `systemOneErrorResponseTransform`
 * reads both.
 */

/**
 * The request as the caller sent it, images included in the form the gateway
 * takes them -- named `assets`, which is Jev's. A provider that names its
 * images otherwise overrides `assets`, `state` and `questions` (see `nace`).
 */
export function systemOneRequestConfig(
  defaultModel?: string,
): AIProviderFunctionConfig {
  return {
    model: {
      param: 'model',
      ...(defaultModel ? { required: true, default: defaultModel } : {}),
    },
    state: { param: 'state', required: true },
    questions: { param: 'questions', required: true },
    assets: { param: 'assets' },
  };
}

/** Whether a System One request shows the model any image. */
export function hasImages(requestBody: unknown): boolean {
  const assets = (requestBody as { assets?: Record<string, unknown> } | null)
    ?.assets;
  return !!assets && Object.keys(assets).length > 0;
}

/** What one of a FastAPI validation error's items says, as Jev sends them. */
function describeValidationIssue(issue: unknown): string {
  if (!issue || typeof issue !== 'object') {
    return String(issue);
  }
  const { loc, msg } = issue as { loc?: unknown; msg?: unknown };
  const where = Array.isArray(loc) ? loc.join('.') : undefined;
  const what = typeof msg === 'string' ? msg : JSON.stringify(issue);
  return where ? `${where}: ${what}` : what;
}

/**
 * The vendor's error as the gateway reports errors. Drex answers
 * `{error: {type, message, issues}}`; Jev, a FastAPI service, answers
 * `{detail}`, where the detail is a message, an object, or -- on a 422 -- a
 * list of `{loc, msg}` validation issues.
 *
 * An error that is not JSON at all -- a self-hosted Drex saying "model not
 * loaded", or the proxy in front of it -- reaches here as the text the
 * response handler wraps in `{"html-message": text}`, and that text is the
 * only account of what went wrong.
 */
export function systemOneErrorResponseTransform(
  body: Record<string, unknown>,
  status: number,
  provider: AIProvider,
): ErrorResponseBody {
  let message: string | undefined;
  let type: string | undefined;

  const {
    error,
    detail,
    'html-message': text,
  } = body as { error?: unknown; detail?: unknown; 'html-message'?: unknown };

  if (typeof error === 'string') {
    message = error;
  } else if (error && typeof error === 'object') {
    const drex = error as {
      type?: unknown;
      message?: unknown;
      issues?: unknown;
    };
    type = typeof drex.type === 'string' ? drex.type : undefined;
    message = typeof drex.message === 'string' ? drex.message : undefined;
    if (Array.isArray(drex.issues) && drex.issues.length > 0) {
      const issues = drex.issues
        .map((issue) => {
          const { path, message: said } = (issue ?? {}) as {
            path?: unknown;
            message?: unknown;
          };
          const where = Array.isArray(path) ? path.join('.') : path;
          return where ? `${where}: ${String(said)}` : String(said);
        })
        .join('; ');
      message = message ? `${message} (${issues})` : issues;
    }
  } else if (typeof detail === 'string') {
    message = detail;
  } else if (Array.isArray(detail)) {
    message = detail.map(describeValidationIssue).join('; ');
  } else if (detail !== undefined) {
    message = JSON.stringify(detail);
  } else if (typeof text === 'string') {
    message = text.trim();
  }

  return generateErrorResponse(
    {
      message: message || `Request failed with status ${status}`,
      type,
      param: undefined,
      code: status.toString(),
    },
    provider,
  );
}

/** The answer as it came, stamped with the provider that gave it. */
export function systemOneResponseTransform(
  provider: AIProvider,
): ResponseTransformFunction {
  return (aiProviderResponseBody, aiProviderResponseStatus) => {
    if (aiProviderResponseStatus !== 200) {
      return systemOneErrorResponseTransform(
        aiProviderResponseBody,
        aiProviderResponseStatus,
        provider,
      );
    }

    const parsed = SystemOneResponseBody.safeParse(aiProviderResponseBody);
    if (!parsed.success) {
      return generateInvalidProviderResponseError(
        aiProviderResponseBody,
        provider,
      );
    }
    return { ...parsed.data, provider };
  };
}
