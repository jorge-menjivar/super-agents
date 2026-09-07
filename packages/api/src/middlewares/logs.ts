import { autoClusterSkill } from '@api/middlewares/optimizer/clusters';
import {
  addSkillOptimizationEvaluationRun,
  checkAndRegenerateEvaluationsEarly,
} from '@api/middlewares/optimizer/evaluations';
import { updatePulledArm } from '@api/middlewares/optimizer/hyperparameters';
import { autoGenerateSystemPromptsForSkill } from '@api/middlewares/optimizer/system-prompt';
import type {
  EvaluationMethodConnector,
  LogsStorageConnector,
  UserDataStorageConnector,
} from '@api/types/connector';
import type { AppContext, AppEnv } from '@api/types/hono';
import type { HttpMethod } from '@api/types/http';
import {
  runEvaluationsForLog,
  shouldTriggerRealtimeEvaluation,
} from '@api/utils/realtime-evaluations';
import { emitSSEEvent } from '@api/utils/sse-event-manager';
import type { SkillRoutingDecision } from '@api/utils/super-agents/skill-routing';
import { error, warn } from '@shared/console-logging';
import type { FunctionName } from '@shared/types/api/request';
import {
  NonPrivateSuperAgentsConfig,
  type SuperAgentsConfig,
} from '@shared/types/api/request/headers';
import type {
  ServedConfiguration,
  SkillOptimizationArm,
  SkillOptimizationEvaluationResult,
} from '@shared/types/data';
import type { Agent } from '@shared/types/data/agent';
import {
  type AIProviderRequestLog,
  type HookLog,
  isCompletedLog,
  type LogCreateParams,
  type LogMessage,
  type LogResponseBodyError,
  type LogStartParams,
  type LogsClient,
} from '@shared/types/data/log';
import type { Skill } from '@shared/types/data/skill';
import type { EvaluationMethodName } from '@shared/types/evaluations';
import { extractSystemPrompt } from '@shared/utils/system-prompt';
import { stripAgentSkillPath } from '@shared/utils/url';
import type { MiddlewareHandler } from 'hono';
import { getRuntimeKey } from 'hono/adapter';
import type { Factory } from 'hono/factory';
import { z } from 'zod';

let logId = 0;
const MAX_RESPONSE_LENGTH = 100000;

/** Enough for the gateway's own error bodies, which are a JSON message. */
const MAX_ERROR_LENGTH = 2000;

/**
 * Bounds the stored response body, replacing an oversized one with a
 * truncation note carrying its head. Measured on the response body *alone*:
 * the rest of the row -- a large request body, the embedding's floats -- must
 * not cost the response its shape, because the realtime evaluations parse
 * `response_body`, and a replaced one fails every evaluation that reads it.
 */
export function truncateOversizedResponseBody(
  aiProviderLog: AIProviderRequestLog,
): void {
  const responseBodyString = JSON.stringify(aiProviderLog.response_body);
  if (
    typeof responseBodyString === 'string' &&
    responseBodyString.length > MAX_RESPONSE_LENGTH
  ) {
    const truncated: LogResponseBodyError = {
      message:
        'The response was too large to be processed. It has been truncated.',
      response: `${responseBodyString.substring(0, MAX_RESPONSE_LENGTH)}...`,
    };
    aiProviderLog.response_body = truncated;
  }
}

// Map to store all connected log clients
const logsClients: Map<string, LogsClient> = new Map();

const addLogsClient = (clientId: string, client: LogsClient): void => {
  logsClients.set(clientId, client);
};

const removeLogsClient = (clientId: string): void => {
  logsClients.delete(clientId);
};

const broadcastLog = async (log: string): Promise<void> => {
  const message: LogMessage = {
    data: log,
    event: 'log',
    id: String(logId++),
  };

  const deadClients: string[] = [];

  // Run all sends in parallel
  await Promise.all(
    Array.from(logsClients.entries()).map(async ([id, client]) => {
      try {
        await Promise.race([
          client.sendLog(message),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Send timeout')), 1000),
          ),
        ]);
      } catch (error: unknown) {
        if (error instanceof Error) {
          console.error(`Failed to send log to client ${id}:`, error.message);
        } else {
          console.error(`Failed to send log to client ${id}:`, error);
        }
        deadClients.push(id);
      }
    }),
  );

  // Remove dead clients after iteration
  deadClients.forEach((id: string) => {
    removeLogsClient(id);
  });
};

/**
 * Parse accumulated SSE stream chunks and reconstruct the response body
 */
function parseStreamChunksToResponseBody(
  accumulatedChunks: string,
  functionName?: string,
): {
  response_body: Record<string, unknown>;
  raw_response_body: string;
} {
  const lines = accumulatedChunks.split('\n');
  let accumulatedContent = '';
  let id = '';
  let model = '';
  let created = 0;
  const toolCalls: Array<{
    id: string;
    type: string;
    function: { name: string; arguments: string };
  }> = [];
  let currentToolCall: {
    index: number;
    id: string;
    type: string;
    function: { name: string; arguments: string };
  } | null = null;

  // Track Responses API function calls by output_index
  const responsesAPIFunctionCalls = new Map<
    number,
    {
      type: 'function_call';
      id: string;
      call_id: string;
      name: string;
      arguments: string;
      status: string;
    }
  >();

  for (const line of lines) {
    if (!line.startsWith('data: ')) continue;

    const data = line.slice(6).trim();
    if (data === '[DONE]') continue;

    try {
      const chunk = JSON.parse(data);
      if (!id && chunk.id) id = chunk.id;
      if (!model && chunk.model) model = chunk.model;
      if (!created && chunk.created) created = chunk.created;

      // Handle Responses API format (response.output_text.delta)
      if (chunk.type === 'response.output_text.delta' && chunk.delta) {
        accumulatedContent += chunk.delta;
      }
      // Handle Responses API function_call item added
      else if (
        chunk.type === 'response.output_item.added' &&
        chunk.item?.type === 'function_call'
      ) {
        responsesAPIFunctionCalls.set(chunk.output_index, {
          type: 'function_call',
          id: chunk.item.id || '',
          call_id: chunk.item.call_id || '',
          name: chunk.item.name || '',
          arguments: chunk.item.arguments || '',
          status: chunk.item.status || 'in_progress',
        });
      }
      // Handle Responses API function_call arguments delta
      else if (chunk.type === 'response.function_call_arguments.delta') {
        const funcCall = responsesAPIFunctionCalls.get(chunk.output_index);
        if (funcCall && chunk.delta) {
          funcCall.arguments += chunk.delta;
        }
      }
      // Handle Responses API function_call arguments done
      else if (chunk.type === 'response.function_call_arguments.done') {
        const funcCall = responsesAPIFunctionCalls.get(chunk.output_index);
        if (funcCall && chunk.arguments) {
          funcCall.arguments = chunk.arguments;
        }
      }
      // Handle Responses API function_call item done
      else if (
        chunk.type === 'response.output_item.done' &&
        chunk.item?.type === 'function_call'
      ) {
        const funcCall = responsesAPIFunctionCalls.get(chunk.output_index);
        if (funcCall) {
          funcCall.status = chunk.item.status || 'completed';
          if (chunk.item.id) funcCall.id = chunk.item.id;
          if (chunk.item.call_id) funcCall.call_id = chunk.item.call_id;
          if (chunk.item.name) funcCall.name = chunk.item.name;
          if (chunk.item.arguments) funcCall.arguments = chunk.item.arguments;
        }
      }
      // Extract response ID from Responses API completed event
      else if (chunk.type === 'response.completed' && chunk.response) {
        if (!id && chunk.response.id) id = chunk.response.id;
        if (!model && chunk.response.model) model = chunk.response.model;
        if (!created && chunk.response.created_at)
          created = chunk.response.created_at;
      }
      // Handle Chat Completions format
      else if (chunk.choices?.[0]?.delta) {
        const delta = chunk.choices[0].delta;

        // Accumulate content
        if (delta.content) {
          accumulatedContent += delta.content;
        }

        // Accumulate tool calls
        if (delta.tool_calls) {
          for (const toolCallDelta of delta.tool_calls) {
            if (toolCallDelta.index !== undefined) {
              if (
                !currentToolCall ||
                currentToolCall.index !== toolCallDelta.index
              ) {
                if (currentToolCall) {
                  toolCalls.push({
                    id: currentToolCall.id,
                    type: currentToolCall.type,
                    function: currentToolCall.function,
                  });
                }
                currentToolCall = {
                  index: toolCallDelta.index,
                  id: toolCallDelta.id || '',
                  type: toolCallDelta.type || 'function',
                  function: { name: '', arguments: '' },
                };
              }

              if (toolCallDelta.id) currentToolCall.id = toolCallDelta.id;
              if (toolCallDelta.type) currentToolCall.type = toolCallDelta.type;
              if (toolCallDelta.function?.name) {
                currentToolCall.function.name += toolCallDelta.function.name;
              }
              if (toolCallDelta.function?.arguments) {
                currentToolCall.function.arguments +=
                  toolCallDelta.function.arguments;
              }
            }
          }
        }
      }
    } catch {
      // Skip malformed chunks
    }
  }

  // Add the last tool call if any
  if (currentToolCall) {
    toolCalls.push({
      id: currentToolCall.id,
      type: currentToolCall.type,
      function: currentToolCall.function,
    });
  }

  let response_body: Record<string, unknown>;

  // Construct response body in the appropriate format
  if (functionName === 'create_model_response') {
    // Responses API format
    // Build output array with all items (messages and function_calls)
    const outputItems: Record<string, unknown>[] = [];

    // Add message item if there's content
    if (accumulatedContent) {
      outputItems.push({
        id: `msg-${Date.now()}`,
        type: 'message',
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: accumulatedContent,
            annotations: [],
          },
        ],
        status: 'completed',
      });
    }

    // Add function_call items from the map (sorted by output_index)
    const sortedFunctionCalls = Array.from(
      responsesAPIFunctionCalls.entries(),
    ).sort(([a], [b]) => a - b);
    for (const [, funcCall] of sortedFunctionCalls) {
      outputItems.push({
        type: funcCall.type,
        id: funcCall.id,
        call_id: funcCall.call_id,
        name: funcCall.name,
        arguments: funcCall.arguments,
        status: funcCall.status,
      });
    }

    response_body = {
      id: id || `resp-${Date.now()}`,
      object: 'response',
      created_at: created || Math.floor(Date.now() / 1000),
      model: model || 'unknown',
      status: 'completed',
      output: outputItems,
      // Required nullable fields
      error: null,
      incomplete_details: null,
      instructions: null,
      metadata: null,
      output_text: accumulatedContent || null,
      parallel_tool_calls: null,
      previous_response_id: null,
      reasoning: null,
      temperature: null,
      text: null,
      tool_choice: null,
      tools: [],
      usage: null,
      user: null,
    };
  } else {
    // Chat Completion format (default)
    response_body = {
      id: id || `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      created: created || Math.floor(Date.now() / 1000),
      model: model || 'unknown',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: accumulatedContent || null,
            ...(toolCalls.length > 0 && { tool_calls: toolCalls }),
          },
          finish_reason: 'stop',
        },
      ],
    };
  }

  return {
    response_body,
    raw_response_body: JSON.stringify(response_body),
  };
}

interface ProcessLogsParams {
  c: AppContext;
  url: URL;
  status: number;
  method: HttpMethod;
  functionName: FunctionName;
  saConfig: SuperAgentsConfig;
  agent: Agent;
  skill: Skill;
  startTime: number;
  endTime: number;
  firstTokenTime?: number;
  aiProviderLog: AIProviderRequestLog;
  embedding: number[] | null;
  originalSystemPrompt: string | null;
  hookLogs: HookLog[];
  logsStorageConnector: LogsStorageConnector;
  userDataStorageConnector: UserDataStorageConnector;
  evaluationConnectorsMap?: Partial<
    Record<EvaluationMethodName, EvaluationMethodConnector>
  >;
  pulledArm?: SkillOptimizationArm;
  skillRouting?: SkillRoutingDecision;
}

async function processLogs({
  c,
  url,
  status,
  method,
  functionName,
  saConfig,
  agent,
  skill,
  startTime,
  endTime,
  firstTokenTime,
  aiProviderLog,
  embedding,
  originalSystemPrompt,
  hookLogs,
  logsStorageConnector,
  userDataStorageConnector,
  evaluationConnectorsMap,
  pulledArm,
  skillRouting,
}: ProcessLogsParams): Promise<{
  evaluationResults: SkillOptimizationEvaluationResult[];
  logId: string | null;
  evaluationsPromise?: Promise<SkillOptimizationEvaluationResult[]>;
}> {
  const duration = endTime - startTime;

  const baseSuperAgentsConfig = NonPrivateSuperAgentsConfig.parse(saConfig);

  if (!('model' in aiProviderLog.request_body)) {
    error('No model found in request body');
    return { evaluationResults: [], logId: null };
  }

  const createParams: LogCreateParams = {
    // Completes the row opened when the request arrived, rather than adding
    // a second one for the same request.
    id: c.get('log_request_id'),
    agent_id: agent.id,
    skill_id: skill.id,
    cluster_id: pulledArm?.cluster_id,
    start_time: startTime,
    first_token_time: firstTokenTime,
    end_time: endTime,
    duration: duration,
    trace_id: saConfig.trace_id,
    status: status,
    method: method,
    model: (aiProviderLog.request_body.model as string | undefined) || '',
    metadata: {
      // How the skill was chosen, when the caller named only the agent.
      ...(skillRouting ? { skill_routing: skillRouting } : {}),
      // Which of the partition's configurations served the request. The row
      // keeps `cluster_id`, which names the partition but not the arm, and
      // the prompt that reached the provider is the arm's template rendered,
      // so it cannot be matched back to one afterwards.
      ...(pulledArm
        ? {
            served_configuration: {
              id: pulledArm.id,
              name: pulledArm.name,
            } satisfies ServedConfiguration,
          }
        : {}),
    },
    hook_logs: hookLogs,
    function_name: functionName,
    ai_provider_request_log: aiProviderLog,
    embedding: embedding ?? undefined,
    original_system_prompt: originalSystemPrompt ?? undefined,
    endpoint: url.pathname,
    base_sa_config: baseSuperAgentsConfig,
    ai_provider: aiProviderLog.provider,
    cache_status: aiProviderLog.cache_status,
    parent_span_id: saConfig.parent_span_id,
    span_id: saConfig.span_id,
    span_name: saConfig.span_name,
    app_id: saConfig.app_id,
    external_user_id:
      (aiProviderLog.request_body.user as string | null) || undefined,
    external_user_human_name: saConfig.user_human_name || undefined,
    user_metadata: undefined,
  };

  truncateOversizedResponseBody(createParams.ai_provider_request_log);

  await broadcastLog(JSON.stringify(createParams));

  // Store the log in the configured logs storage connector
  try {
    const insertedLog = await logsStorageConnector.createLog(c, createParams);

    // Emit SSE event for real-time log updates with full log data
    emitSSEEvent('log:created', {
      log: insertedLog,
    });

    // Trigger evaluations asynchronously (non-blocking) if conditions are met
    if (
      shouldTriggerRealtimeEvaluation(status, url) &&
      userDataStorageConnector &&
      evaluationConnectorsMap
    ) {
      // Run evaluations in the background without blocking log creation
      const evaluationsPromise: Promise<SkillOptimizationEvaluationResult[]> =
        Promise.resolve(
          userDataStorageConnector.getSkillOptimizationEvaluations(c, {
            agent_id: skill.agent_id,
            skill_id: skill.id,
          }),
        )
          .then((evaluations) => {
            // `insertedLog` closes a finished request, so it always is one --
            // the narrowing is for the type, not for a case that can happen.
            if (evaluations.length > 0 && isCompletedLog(insertedLog)) {
              return runEvaluationsForLog(
                c,
                insertedLog,
                evaluations,
                evaluationConnectorsMap,
                userDataStorageConnector,
              );
            }
            return [];
          })
          .catch((e: unknown) => {
            error('Error running evaluations for log', e);
            return [];
          });

      // Return promise for background processing
      return {
        evaluationResults: [],
        logId: insertedLog.id,
        evaluationsPromise,
      };
    }

    return { evaluationResults: [], logId: insertedLog.id };
  } catch (e) {
    error('Error creating log', e);
  }
  return { evaluationResults: [], logId: null };
}

const shouldLogRequest = (url: URL): boolean => {
  // Only log requests to the Super Agents API
  if (!url.pathname.startsWith('/v1/')) {
    return false;
  }

  // Don't log requests to the Super Agents app APIs
  if (url.pathname.startsWith('/v1/super-agents')) {
    return false;
  }

  return true;
};

/**
 * Closes the row opened at arrival for a request that failed before a
 * provider answered.
 *
 * The status is the one the caller was given, and the message is read off the
 * response body when the gateway wrote one -- an unknown agent, a skill that
 * does not exist, a provider that could not be reached. Only a row that is
 * still open is touched, which is what makes this safe to call as a backstop
 * on a path that may already have completed the row.
 */
/**
 * The message inside a gateway error body, when it is one -- `{"error":
 * "..."}` from the middlewares, `{"error":{"message":"..."}}` from the
 * provider path -- and otherwise the body itself, cut to size. It is what
 * the dashboard shows beside a failed row.
 */
const errorMessageFrom = (body: string): string => {
  const fallback = body.slice(0, MAX_ERROR_LENGTH);
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return fallback;
  }
  if (!parsed || typeof parsed !== 'object' || !('error' in parsed)) {
    return fallback;
  }
  const { error: found } = parsed as { error: unknown };
  if (typeof found === 'string') {
    return found.slice(0, MAX_ERROR_LENGTH);
  }
  if (
    found &&
    typeof found === 'object' &&
    'message' in found &&
    typeof found.message === 'string'
  ) {
    return found.message.slice(0, MAX_ERROR_LENGTH);
  }
  return fallback;
};

const closeFailedRequest = async (
  c: AppContext,
  requestId: string,
  startTime: number,
  reason?: string,
  status?: number,
): Promise<void> => {
  try {
    const endTime = Date.now();
    const responseStatus = status ?? c.res.status;

    let message = reason;
    if (!message) {
      // The gateway answers an error as JSON; anything else is not worth
      // storing, and neither is a body large enough to matter.
      message = await c.res
        .clone()
        .text()
        .then(errorMessageFrom)
        .catch(() => undefined);
    }

    await c.get('logs_storage_connector').failLog(c, {
      id: requestId,
      status: responseStatus,
      end_time: endTime,
      duration: endTime - startTime,
      error: message || `The request failed with status ${responseStatus}.`,
    });

    emitSSEEvent('log:request-settled', { log_id: requestId });
  } catch (e) {
    warn('[Logs] Could not record a failed request:', e);
  }
};

/**
 * Announce a request that is on its way to a provider, so the dashboard can
 * show it as a pending row while it runs.
 *
 * Called from the agent-and-skill middleware twice: as soon as the agent is
 * known, with no skill yet, and again once routing has picked one. The row
 * is upserted, so the second call fills the skill in. Announcing before
 * routing is what keeps its dead time -- embedding the request, compacting
 * its prompt, the arbiter -- out of the wait for the row to appear, which is
 * the row's whole purpose. This middleware's own pre-handler section cannot
 * do it: it runs before the agent has been resolved.
 */
/**
 * The config as the arriving row records it. `skill_name` is optional here,
 * unlike in `NonPrivateSuperAgentsConfig`: before routing there is none, and
 * the completion write records the config with the skill routing chose.
 */
const ArrivingSuperAgentsConfig = NonPrivateSuperAgentsConfig.extend({
  skill_name: z.string().optional(),
});

export const markRequestStarted = (c: AppContext): void => {
  // Nothing about a row that exists to be looked at is worth failing a
  // request over, and this runs on every request the gateway serves.
  try {
    const requestId = c.get('log_request_id');
    if (!requestId) {
      return;
    }

    const url = new URL(stripAgentSkillPath(c.req.url));
    if (!shouldLogRequest(url)) {
      return;
    }

    const saRequestData = c.get('sa_request_data');
    if (!saRequestData) {
      return;
    }

    const requestBody = (saRequestData as { requestBody?: unknown })
      .requestBody;
    const model =
      requestBody &&
      typeof requestBody === 'object' &&
      'model' in requestBody &&
      typeof requestBody.model === 'string'
        ? requestBody.model
        : undefined;

    // The pre-processed config, not `sa_config`: that one is injected by a
    // middleware that runs *after* the skill resolves, so at this point it
    // does not exist yet. Parsing through `NonPrivateSuperAgentsConfig`
    // strips the targets, which carry the caller's provider keys.
    const saConfig = c.get('sa_config') ?? c.get('sa_config_pre_processed');
    const startParams: LogStartParams = {
      id: requestId,
      agent_id: c.get('agent').id,
      // Unset until routing has picked one; the second call fills it in.
      skill_id: (c.get('skill') as Skill | undefined)?.id ?? null,
      method: saRequestData.method,
      endpoint: url.pathname,
      function_name: saRequestData.functionName,
      start_time: c.get('log_start_time') ?? Date.now(),
      base_sa_config: ArrivingSuperAgentsConfig.parse(saConfig),
      model,
      trace_id: saConfig.trace_id ?? undefined,
    };

    // Not awaited: a request must not wait on a write that exists so someone
    // can watch it. The completion write is an upsert, so whichever of the
    // two lands first, the row ends up right.
    void c
      .get('logs_storage_connector')
      .startLog(c, startParams)
      ?.then(() => {
        emitSSEEvent('log:request-started', {
          log_id: requestId,
          agent_id: startParams.agent_id,
          skill_id: startParams.skill_id,
        });
      })
      .catch((e: unknown) => {
        warn('[Logs] Could not open the row for a request:', e);
      });
  } catch (e) {
    warn('[Logs] Could not open the row for a request:', e);
  }
};

async function processLogsAndOptimizeSkill(
  processLogsParams: ProcessLogsParams,
) {
  const { evaluationResults, logId, evaluationsPromise } =
    await processLogs(processLogsParams);

  // If we pulled an arm, handle arm updates and optimization
  if (processLogsParams.pulledArm) {
    // If evaluations are running in the background, wait for them and update the arm
    if (evaluationsPromise && logId) {
      evaluationsPromise
        .then(async (results) => {
          if (results.length > 0 && processLogsParams.pulledArm) {
            // Update arm stats with real scores
            await updatePulledArm(
              processLogsParams.c,
              processLogsParams.userDataStorageConnector,
              processLogsParams.pulledArm,
              results,
            );
            await addSkillOptimizationEvaluationRun(
              processLogsParams.c,
              processLogsParams.userDataStorageConnector,
              processLogsParams.pulledArm,
              logId,
              results,
            );
          }
        })
        .catch((e: unknown) => {
          error('Error updating arm with evaluation results', e);
          // Still emit SSE event so client knows a request was processed
          if (processLogsParams.pulledArm) {
            emitSSEEvent('skill-optimization:arm-updated', {
              armId: processLogsParams.pulledArm.id,
              skillId: processLogsParams.pulledArm.skill_id,
              clusterId: processLogsParams.pulledArm.cluster_id,
            });
          }
        });
    } else if (evaluationResults.length > 0 && logId) {
      // We have synchronous evaluation results - update arm stats with real scores
      await updatePulledArm(
        processLogsParams.c,
        processLogsParams.userDataStorageConnector,
        processLogsParams.pulledArm,
        evaluationResults,
      );
      await addSkillOptimizationEvaluationRun(
        processLogsParams.c,
        processLogsParams.userDataStorageConnector,
        processLogsParams.pulledArm,
        logId,
        evaluationResults,
      );
    } else {
      // No evaluation results (evaluations failed or not configured)
      // Still emit SSE event so client knows a request was processed
      emitSSEEvent('skill-optimization:arm-updated', {
        armId: processLogsParams.pulledArm.id,
        skillId: processLogsParams.pulledArm.skill_id,
        clusterId: processLogsParams.pulledArm.cluster_id,
      });
    }

    // Check if we should regenerate evaluations early (after first 5 requests)
    if (processLogsParams.evaluationConnectorsMap) {
      await checkAndRegenerateEvaluationsEarly(
        processLogsParams.c,
        processLogsParams.functionName,
        processLogsParams.userDataStorageConnector,
        processLogsParams.logsStorageConnector,
        processLogsParams.skill,
        processLogsParams.agent.description,
        processLogsParams.evaluationConnectorsMap,
      );
    }
    await autoClusterSkill(
      processLogsParams.c,
      processLogsParams.functionName,
      processLogsParams.userDataStorageConnector,
      processLogsParams.logsStorageConnector,
      processLogsParams.skill,
    );
    await autoGenerateSystemPromptsForSkill(
      processLogsParams.c,
      processLogsParams.functionName,
      processLogsParams.userDataStorageConnector,
      processLogsParams.logsStorageConnector,
      processLogsParams.skill,
    );
  }
}

export const logsMiddleware = (
  factory: Factory<AppEnv>,
  resolve: (c: AppContext) => LogsStorageConnector,
): MiddlewareHandler =>
  factory.createMiddleware(async (c, next) => {
    c.set('logs_storage_connector', resolve(c));
    c.set('addLogsClient', addLogsClient);
    c.set('removeLogsClient', removeLogsClient);

    // Read the caller's system prompt before the handler runs. The body that
    // reaches the provider carries the pulled arm's prompt instead, and that is
    // the one `ai_provider_request_log` records.
    const originalSystemPrompt = extractSystemPrompt(c.get('sa_request_data'));

    const startTime = Date.now();
    // Assigned here so it exists before anything downstream can open the
    // request's row; opening it waits until the skill is known. It becomes
    // the log's id, which is what lets the completion write finish this row
    // rather than adding a second one.
    const requestId = crypto.randomUUID();
    c.set('log_request_id', requestId);
    c.set('log_start_time', startTime);

    await next();

    // Path-scoped requests are logged under their canonical endpoint so that
    // they group with requests that named the agent and skill in the header.
    const url = new URL(stripAgentSkillPath(c.req.url));

    if (!shouldLogRequest(url)) {
      // No row was opened for it either: this is the same check.
      return;
    }

    const aiProviderLog = c.get('ai_provider_log');

    // Log produced when calling the AI provider
    if (!aiProviderLog) {
      // No provider was reached -- an unknown agent or skill, a routing
      // error, a provider that could not be connected to. Before the row was
      // opened at arrival this left no trace at all, which made exactly the
      // failures worth seeing the ones that could not be seen.
      void closeFailedRequest(c, requestId, startTime);
      return;
    }

    // For streaming requests, wait for the stream to complete before logging
    const streamEndPromise = c.get('stream_end_promise') as
      | Promise<void>
      | undefined;

    const processLogsAsync = async () => {
      // Wait for stream to end if it's a streaming request
      if (streamEndPromise) {
        await streamEndPromise;
      }

      // A stream's provider log was written before the stream ended; when
      // the provider finished answering is known only now.
      if (aiProviderLog.end_time === undefined) {
        aiProviderLog.end_time = c.get('provider_end_time');
      }

      // For streaming requests, parse accumulated chunks and update the log
      const accumulatedChunks = c.get('accumulated_stream_chunks') as
        | string
        | undefined;
      const saRequestData = c.get('sa_request_data');
      if (accumulatedChunks && aiProviderLog && saRequestData) {
        // Validate size to prevent processing extremely large accumulated chunks
        const chunkSize = new TextEncoder().encode(accumulatedChunks).length;
        const MAX_CHUNK_SIZE = 10 * 1024 * 1024; // 10 MB

        if (chunkSize > MAX_CHUNK_SIZE) {
          warn(
            '[Logs Middleware] Accumulated chunks exceed safe processing size, truncating',
            {
              size: chunkSize,
              maxSize: MAX_CHUNK_SIZE,
              functionName: saRequestData.functionName,
            },
          );
          // Keep the log with placeholders rather than trying to parse
          aiProviderLog.response_body = null;
          aiProviderLog.raw_response_body = `[Truncated: Response too large (${chunkSize} bytes)]`;
        } else {
          try {
            const { response_body, raw_response_body } =
              parseStreamChunksToResponseBody(
                accumulatedChunks,
                saRequestData.functionName,
              );
            aiProviderLog.response_body = response_body;
            aiProviderLog.raw_response_body = raw_response_body;
          } catch (e) {
            error('Failed to parse stream chunks', e);
            // Keep the null/empty values if parsing fails
          }
        }
      }

      // Logs produced by the hooks middleware
      const hookLogs = c.get('hook_logs') || [];
      const pulledArm = c.get('pulled_arm');

      // Use stream_end_time if available (for streaming requests), otherwise use current time
      const endTime =
        (c.get('stream_end_time') as number | undefined) || Date.now();

      // Validate that we don't save incomplete logs for successful requests
      if (aiProviderLog && c.res.status >= 200 && c.res.status < 300) {
        const hasEmptyResponseBody =
          aiProviderLog.response_body === null ||
          (typeof aiProviderLog.response_body === 'object' &&
            Object.keys(aiProviderLog.response_body).length === 0);
        const hasEmptyRawResponseBody =
          !aiProviderLog.raw_response_body ||
          aiProviderLog.raw_response_body.trim() === '';

        if (hasEmptyResponseBody || hasEmptyRawResponseBody) {
          error(
            '[Logs] Skipping log creation - successful request but missing response body',
            {
              status: c.res.status,
              hasEmptyResponseBody,
              hasEmptyRawResponseBody,
              functionName: saRequestData.functionName,
            },
          );
          // Recorded as a failure rather than dropped: a response that
          // arrived empty is a fault worth seeing, and the row is already
          // open.
          void closeFailedRequest(
            c,
            requestId,
            startTime,
            'The provider returned a successful status with an empty body.',
            c.res.status,
          );
          return;
        }
      }

      const processLogsParams: ProcessLogsParams = {
        c,
        url,
        status: c.res.status,
        method: saRequestData.method,
        functionName: saRequestData.functionName,
        saConfig: c.get('sa_config'),
        agent: c.get('agent'),
        skill: c.get('skill'),
        startTime,
        endTime,
        firstTokenTime: c.get('first_token_time'),
        aiProviderLog,
        embedding: c.get('embedding'),
        originalSystemPrompt,
        hookLogs,
        logsStorageConnector: c.get('logs_storage_connector'),
        userDataStorageConnector: c.get('user_data_storage_connector'),
        evaluationConnectorsMap: c.get('evaluation_connectors_map'),
        pulledArm,
        skillRouting: c.get('skill_routing'),
      };

      await processLogsAndOptimizeSkill(processLogsParams);
    };

    // A backstop, not the normal path: if the stream rejects, or logging
    // throws before the row is completed, it would otherwise stay pending
    // forever. `closeFailedRequest` only touches a row that is still open,
    // so a request that was logged successfully is left alone.
    const processed = processLogsAsync().catch((e: unknown) => {
      error('[Logs] Could not process the logs for a request:', e);
      return closeFailedRequest(
        c,
        requestId,
        startTime,
        e instanceof Error ? e.message : String(e),
      );
    });

    if (getRuntimeKey() === 'workerd') {
      c.executionCtx.waitUntil(processed);
    }
  });
