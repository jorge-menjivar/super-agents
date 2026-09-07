import type { HooksConnector } from '@api/types/connector';
import type { AppContext, AppEnv } from '@api/types/hono';
import { warn } from '@shared/console-logging';
import type { SuperAgentsRequestData } from '@shared/types/api/request/body';
import { FunctionName } from '@shared/types/api/request/function-name';
import type { SuperAgentsConfig } from '@shared/types/api/request/headers';
import type { SuperAgentsResponseBody } from '@shared/types/api/response/body';
import type { HookLog } from '@shared/types/data';
import { CacheStatus } from '@shared/types/middleware/cache';
import {
  type Hook,
  type HookInput,
  HookResult,
  HookType,
} from '@shared/types/middleware/hooks';
import type { MiddlewareHandler } from 'hono';
import type { Factory } from 'hono/factory';

/**
 * The result of a hook that could not run. Unless the hook fails closed it
 * denies nothing: the request is served as if the hook were absent, and the
 * failure travels with the hook log, which is the only place it can be seen
 * afterwards.
 */
const failedHookResult = (hook: Hook, error: string): HookResult => ({
  deny_request: hook.fail_closed,
  request_body_override: undefined,
  response_body_override: undefined,
  skipped: false,
  error,
});

/**
 * A provider can report a failure of its own -- a reviewer that answered with
 * no verdict -- without throwing; a hook that fails closed denies on that
 * too, so that the two kinds of failure read the same way.
 */
const closedOnFailure = (hook: Hook, result: HookResult): HookResult =>
  hook.fail_closed && result.error !== undefined
    ? { ...result, deny_request: true }
    : result;

async function executeHookByProvider(
  c: AppContext,
  hook: Hook,
  input: HookInput,
): Promise<HookResult> {
  const connector = c.get('hooks_connectors_map')[hook.hook_provider];
  if (!connector) {
    warn(
      `[HOOKS] Hook "${hook.id}" names the provider "${hook.hook_provider}", which this server does not implement`,
    );
    return failedHookResult(
      hook,
      `No hook provider named "${hook.hook_provider}" is available`,
    );
  }
  try {
    const result = await connector.executeHook(c, hook, input);
    return closedOnFailure(hook, {
      deny_request: result.deny_request,
      request_body_override: result.request_body_override,
      response_body_override: result.response_body_override,
      skipped: result.skipped,
      reason: result.reason,
      error: result.error,
    });
  } catch (err: unknown) {
    console.error(`Error executing hook "${hook.id}":`, err);
    return failedHookResult(
      hook,
      err instanceof Error ? err.message : String(err),
    );
  }
}

function shouldSkipHook(
  hook: Hook,
  fn: FunctionName,
  statusCode: number | null,
  isStreamingRequest: boolean,
  saResponseBody?:
    | SuperAgentsResponseBody
    | ReadableStream
    | FormData
    | ArrayBuffer,
): boolean {
  return (
    ![
      FunctionName.CHAT_COMPLETE,
      FunctionName.COMPLETE,
      FunctionName.EMBED,
    ].includes(fn) ||
    (fn === FunctionName.EMBED && hook.type !== HookType.INPUT_HOOK) ||
    (hook.type === HookType.OUTPUT_HOOK && statusCode !== 200) ||
    (hook.type === HookType.OUTPUT_HOOK &&
      isStreamingRequest &&
      !saResponseBody)
  );
}

async function executeHook(
  c: AppContext,
  hook: Hook,
  statusCode: number | null,
  isStreamingRequest: boolean,
  saRequestData: SuperAgentsRequestData,
  saResponseBody?: SuperAgentsResponseBody,
): Promise<{
  hookResult: HookResult;
  cacheStatus: CacheStatus;
}> {
  if (
    shouldSkipHook(
      hook,
      saRequestData.functionName,
      statusCode,
      isStreamingRequest,
      saResponseBody,
    )
  ) {
    const hookResult: HookResult = {
      deny_request: false,
      request_body_override: undefined,
      response_body_override: undefined,
      skipped: true,
    };
    return {
      hookResult,
      cacheStatus: CacheStatus.DISABLED,
    };
  }

  const saConfig = c.get('sa_config');

  let cacheStatus = CacheStatus.MISS;
  if (!saConfig.force_hook_refresh) {
    const getHookResponseFromCache = c.get('getHookResponseFromCache');

    const cacheResult = await getHookResponseFromCache(
      c,
      hook,
      saRequestData,
      saResponseBody,
    );

    if (cacheResult.status === CacheStatus.HIT) {
      return {
        hookResult: HookResult.parse(cacheResult.value),
        cacheStatus: cacheResult.status,
      };
    }

    cacheStatus = cacheResult.status;
  } else {
    cacheStatus = CacheStatus.REFRESH;
  }

  const result = await executeHookByProvider(c, hook, {
    requestData: saRequestData,
    responseBody: saResponseBody,
    statusCode,
  });

  return {
    hookResult: result,
    cacheStatus,
  };
}

function getHooksToExecute(
  config: SuperAgentsConfig,
  hookType: HookType,
): Hook[] {
  const hooksToExecute: Hook[] = [];
  hooksToExecute.push(...config.hooks.filter((h) => h.type === hookType));

  return hooksToExecute;
}

export async function executeHooks(
  c: AppContext,
  hookType: HookType,
  statusCode: number | null,
  isStreamingRequest: boolean,
  saRequestData: SuperAgentsRequestData,
  saResponseBody?: SuperAgentsResponseBody,
): Promise<HookLog[]> {
  const saConfig = c.get('sa_config');

  const hooksToExecute = getHooksToExecute(saConfig, hookType);

  if (hooksToExecute.length === 0) {
    return [];
  }

  try {
    const results = await Promise.all(
      hooksToExecute.map(async (hook) => {
        const startTime = Date.now();
        const { hookResult, cacheStatus } = await executeHook(
          c,
          hook,
          statusCode,
          isStreamingRequest,
          saRequestData,
          saResponseBody,
        );
        const endTime = Date.now();
        const duration = endTime - startTime;

        const hookLog: HookLog = {
          trace_id: saConfig.trace_id,
          hook: hook,
          result: hookResult,
          start_time: startTime,
          end_time: endTime,
          duration: duration,
          cache_status: cacheStatus,
        };

        const currentHookLogs = c.get('hook_logs') || [];
        c.set('hook_logs', [...currentHookLogs, hookLog]);

        return hookLog;
      }),
    );

    return results;
  } catch (err) {
    console.error(`Error executing hooks:`, err);
    return [];
  }
}

/**
 * Middleware to handle hooks.
 */
export const hooksMiddleware = (
  factory: Factory<AppEnv>,
  connectors: HooksConnector[],
): MiddlewareHandler =>
  factory.createMiddleware(async (c, next) => {
    const hookConnectorsMap: Record<string, HooksConnector> = {};

    for (const connector of connectors) {
      hookConnectorsMap[connector.name] = connector;
    }

    c.set('hooks_connectors_map', hookConnectorsMap);

    c.set('executeHooks', executeHooks);

    await next();
  });
