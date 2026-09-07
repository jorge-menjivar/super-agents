import type { AppContext } from '@api/types/hono';
import type {
  SuperAgentsRequestBody,
  SuperAgentsRequestData,
} from '@shared/types/api/request/body';
import type { SuperAgentsResponseBody } from '@shared/types/api/response/body';
import type { HookLog } from '@shared/types/data';

import {
  type HookDenialResponseBody,
  HookType,
} from '@shared/types/middleware/hooks';

/** The allowed response, with the verdicts beside it for the handler. */
function createHookResponse(
  baseResponse: Response,
  baseResponseBody: SuperAgentsResponseBody,
  hookLogs: HookLog[],
): Response {
  const responseBody = {
    hook_results: {
      input_hooks: hookLogs.filter((h) => h.hook.type === HookType.INPUT_HOOK),
      output_hooks: hookLogs.filter(
        (h) => h.hook.type === HookType.OUTPUT_HOOK,
      ),
    },
    ...baseResponseBody,
  };

  return new Response(JSON.stringify(responseBody), {
    status: baseResponse.status,
    statusText: baseResponse.statusText,
    headers: baseResponse.headers,
  });
}

/**
 * What a denial tells the client. The hook log stays on the log row -- it
 * names the reviewer and carries the reasons of every hook -- and the client
 * hears the denying hook's own only where that hook is set to
 * `expose_reason`: its reason, or the error that closed it.
 */
export function hookDenialBody(denial: HookLog): HookDenialResponseBody {
  const { hook, result } = denial;
  const subject = hook.type === HookType.INPUT_HOOK ? 'request' : 'response';
  const withheld = `The ${subject} was withheld by the hook "${hook.id}"`;
  const reason = hook.expose_reason
    ? (result.reason ?? result.error)
    : undefined;
  return {
    error: {
      message: reason ? `${withheld}: ${reason}` : `${withheld}.`,
      type: 'hook_denied',
      hook_id: hook.id,
      ...(reason ? { reason } : {}),
    },
  };
}

const denialResponse = (denial: HookLog): Response =>
  new Response(JSON.stringify(hookDenialBody(denial)), {
    status: 446,
    headers: { 'content-type': 'application/json' },
  });

function handleFailedOutputHook(
  response: Response,
  saResponseBody:
    | SuperAgentsResponseBody
    | ReadableStream
    | FormData
    | ArrayBuffer,
  denial: HookLog,
): Response {
  if (!saResponseBody) {
    return new Response(saResponseBody, {
      ...response,
      status: 246,
      statusText: 'Hooks failed',
      headers: response.headers,
    });
  }

  return denialResponse(denial);
}

export async function outputHookHandler(
  c: AppContext,
  saRequestData: SuperAgentsRequestData,
  response: Response,
  saResponseBody: SuperAgentsResponseBody,
  retryAttemptsMade: number,
): Promise<Response> {
  try {
    if (retryAttemptsMade > 0) {
      // Reset the output hook results
      const hookLogs = c.get('hook_logs');

      // Remove the output hook results
      const filteredHookLogs = hookLogs?.filter(
        (h) => h.hook.type !== HookType.OUTPUT_HOOK,
      );

      c.set('hook_logs', filteredHookLogs);
    }

    const executeHooks = c.get('executeHooks');

    const hookLogs = await executeHooks(
      c,
      HookType.OUTPUT_HOOK,
      response.status,
      false,
      saRequestData,
      saResponseBody,
    );

    // The hooks ran side by side on the provider's answer; a denial from any
    // of them wins, and otherwise the last rewrite does.
    let reviewedResponseBody = saResponseBody;
    for (const hookLog of hookLogs) {
      if (hookLog.result.deny_request) {
        return handleFailedOutputHook(response, saResponseBody, hookLog);
      }
      if (hookLog.result.response_body_override) {
        reviewedResponseBody = hookLog.result.response_body_override;
      }
    }

    return createHookResponse(response, reviewedResponseBody, hookLogs);
  } catch (err) {
    console.error(err);
    return response;
  }
}

export async function inputHookHandler(
  c: AppContext,
  saRequestData: SuperAgentsRequestData,
): Promise<{
  errorResponse?: Response;
  transformedSuperAgentsBody?: SuperAgentsRequestBody;
}> {
  try {
    const executeHooks = c.get('executeHooks');

    const hookLogs = await executeHooks(
      c,
      HookType.INPUT_HOOK,
      null,
      false,
      saRequestData,
    );

    let latestTransformedSuperAgentsBody:
      | SuperAgentsRequestBody
      | ReadableStream
      | ArrayBuffer
      | FormData
      | null = null;

    for (const hookLog of hookLogs) {
      if (hookLog.result.deny_request) {
        return {
          errorResponse: denialResponse(hookLog),
          transformedSuperAgentsBody: saRequestData.requestBody,
        };
      }
      if (hookLog.result.request_body_override) {
        latestTransformedSuperAgentsBody = hookLog.result.request_body_override;
      }
    }
    if (latestTransformedSuperAgentsBody) {
      return {
        transformedSuperAgentsBody: latestTransformedSuperAgentsBody,
      };
    }
  } catch (err) {
    console.error(err);
    return {};
  }

  return {};
}
