import { providerConfigs } from '@api/ai-providers';
import { GatewayError } from '@api/errors/gateway';
import { HttpError } from '@api/errors/http';
import { RouterError } from '@api/errors/router';
import { responseHandler } from '@api/handlers/response-handler';
import { retryRequest } from '@api/handlers/retry-handler';
import { ConditionalRouter } from '@api/services/conditional-router';
import transformToProviderRequest from '@api/services/transform-to-provider-request';
import type { AppContext } from '@api/types/hono';
import { HttpMethod } from '@api/types/http';
import { getCachedResponse } from '@api/utils/cache';
import { heldStreamFunction, releaseHeldStream } from '@api/utils/held-stream';
import { inputHookHandler, outputHookHandler } from '@api/utils/hooks';
import {
  validateAndTransformParameter,
  validateParameter,
} from '@api/utils/model-validator';
import { constructRequest } from '@api/utils/super-agents/requests';
import {
  type CommonRequestOptions,
  type CreateResponseOptions,
  createResponse,
} from '@api/utils/super-agents/responses';
import type { InternalProviderAPIConfig } from '@shared/types/ai-providers/config';
import { ModelParameter } from '@shared/types/ai-providers/model-capabilities';
import { FunctionName } from '@shared/types/api/request';
import type {
  SuperAgentsRequestBody,
  SuperAgentsRequestData,
} from '@shared/types/api/request/body';
import type {
  SuperAgentsConfig,
  SuperAgentsTarget,
} from '@shared/types/api/request/headers';
import { HeaderKey, StrategyModes } from '@shared/types/api/request/headers';
import type { ChatCompletionRequestBody } from '@shared/types/api/routes/chat-completions-api';
import type { ResponsesRequestBody } from '@shared/types/api/routes/responses-api';
import { ChatCompletionMessageRole } from '@shared/types/api/routes/shared/messages';
import { AIProvider, ContentTypeName } from '@shared/types/constants';
import { CacheStatus } from '@shared/types/middleware/cache';
import { HookType } from '@shared/types/middleware/hooks';
import { cloneDeep } from 'lodash';

function getProxyPath(
  requestURL: string,
  proxyProvider: AIProvider,
  proxyEndpointPath: string,
  baseURL: string,
  saTarget: SuperAgentsTarget,
): string {
  const reqURL = new URL(requestURL);
  let reqPath = reqURL.pathname;
  const reqQuery = reqURL.search;
  reqPath = reqPath.replace(proxyEndpointPath, '');

  // NOTE: temporary support for the deprecated way of making azure requests
  // where the endpoint was sent in request path of the incoming gateway url
  if (proxyProvider === AIProvider.AZURE_OPENAI) {
    // Extract what looks like a URL from the path and validate the hostname
    // The path format is typically: //hostname.openai.azure.com/rest/of/path
    const azureUrlMatch = reqPath.match(
      /^\/\/([\w-]+\.openai\.azure\.com)(\/.*)?$/,
    );
    if (azureUrlMatch) {
      const hostname = azureUrlMatch[1];
      const path = azureUrlMatch[2] || '';
      return `https://${hostname}${path}${reqQuery}`;
    }
  }

  const providerConfig = providerConfigs[proxyProvider];

  if (providerConfig?.api?.getProxyEndpoint) {
    return `${baseURL}${providerConfig.api.getProxyEndpoint({ reqPath, reqQuery, saTarget: saTarget })}`;
  }

  let proxyPath = `${baseURL}${reqPath}${reqQuery}`;

  // Fix specific for Anthropic SDK calls. Is this needed? - Yes
  if (proxyProvider === AIProvider.ANTHROPIC) {
    proxyPath = proxyPath.replace('/v1/v1/', '/v1/');
  }

  return proxyPath;
}

function getHyperParamDefaults(
  functionName: FunctionName,
  saTarget: SuperAgentsTarget,
) {
  // Apply configuration params as defaults (before override params)
  const configDefaults: Record<string, unknown> = {
    model: saTarget.configuration.model,
  };

  const provider = saTarget.configuration.ai_provider;
  const modelId = saTarget.configuration.model;

  // Helper function to validate, transform, and add parameter
  const addParameter = (
    parameter: ModelParameter,
    value: unknown,
    paramKey?: string,
  ) => {
    if (value === null) return;

    // Only transform numeric parameters (temperature, top_p, etc.)
    const isNumericParameter = typeof value === 'number';

    const validation = isNumericParameter
      ? validateAndTransformParameter(
          provider,
          modelId,
          parameter,
          value,
          functionName,
          true, // shouldTransform = true
        )
      : validateParameter(provider, modelId, parameter, functionName);

    if (validation.isSupported && validation.parameterName) {
      const key = paramKey || validation.parameterName;
      // Use transformed value if available, otherwise use original
      const finalValue = validation.transformedValue ?? value;
      configDefaults[key] = finalValue;
    }
  };

  // Validate and add each parameter
  addParameter(
    ModelParameter.TEMPERATURE,
    saTarget.configuration.temperature,
    'temperature',
  );

  addParameter(
    ModelParameter.MAX_TOKENS,
    saTarget.configuration.max_tokens,
    'max_tokens',
  );

  addParameter(ModelParameter.TOP_P, saTarget.configuration.top_p, 'top_p');

  addParameter(
    ModelParameter.FREQUENCY_PENALTY,
    saTarget.configuration.frequency_penalty,
    'frequency_penalty',
  );

  addParameter(
    ModelParameter.PRESENCE_PENALTY,
    saTarget.configuration.presence_penalty,
    'presence_penalty',
  );

  addParameter(ModelParameter.STOP, saTarget.configuration.stop, 'stop');

  addParameter(ModelParameter.SEED, saTarget.configuration.seed, 'seed');

  // Handle reasoning_effort (different structure for different function names)
  if (saTarget.configuration.reasoning_effort !== null) {
    const validation = validateParameter(
      provider,
      modelId,
      ModelParameter.REASONING_EFFORT,
      functionName,
    );

    if (validation.isSupported) {
      switch (functionName) {
        case FunctionName.STREAM_CHAT_COMPLETE:
        case FunctionName.CHAT_COMPLETE:
          configDefaults.reasoning_effort =
            saTarget.configuration.reasoning_effort;
          break;
        case FunctionName.CREATE_MODEL_RESPONSE:
          configDefaults.reasoning = {
            effort: saTarget.configuration.reasoning_effort,
          };
          break;
        default:
          throw new Error(`Unsupported function name: ${functionName}`);
      }

      if (validation.warning) {
        console.warn(
          `[${provider}/${modelId}][${functionName}] reasoning_effort: ${validation.warning}`,
        );
      }
    } else if (validation.reason) {
      console.warn(
        `[${provider}/${modelId}][${functionName}] ✗ Skipped reasoning_effort (value: ${JSON.stringify(saTarget.configuration.reasoning_effort)}): ${validation.reason}`,
      );
    }
  }

  return configDefaults;
}

/**
 * Removes from the outgoing body the parameters the target model rejects.
 *
 * The capability table keeps such parameters out of the target's *defaults*
 * (`getHyperParamDefaults`), but a caller's own `temperature` used to ride
 * through the spread untouched -- and a reasoning model answers that with a
 * 400 for the whole request. Dropping it is the only way the request can
 * succeed; the warning records that it happened.
 */
function dropUnsupportedParameters(
  functionName: FunctionName,
  saTarget: SuperAgentsTarget,
  body: Record<string, unknown>,
): void {
  const provider = saTarget.configuration.ai_provider;
  const modelId = saTarget.configuration.model;

  for (const parameter of Object.values(ModelParameter)) {
    if (!(parameter in body)) continue;
    const validation = validateParameter(
      provider,
      modelId,
      parameter,
      functionName,
    );
    if (validation.isSupported) continue;
    delete body[parameter];
    console.warn(
      `[${provider}/${modelId}][${functionName}] ✗ Dropped ${parameter} from the request: ${validation.reason}`,
    );
  }
}

/**
 * The providers that constrain the output to a `response_format` themselves,
 * so a request carrying one comes back as JSON without any help from the
 * prompt: the ones whose structured outputs are documented as enforced, and
 * Anthropic, which has no such field and instead builds the `__json_output`
 * tool, forces it through `tool_choice` and explains it in a system
 * instruction of its own (see ai-providers/anthropic/chat-complete.ts).
 *
 * Forwarding the field is not enforcing it. Ollama, OpenRouter, Together and
 * the other pass-through hosts hand `response_format` to whatever model sits
 * behind them, and a model that ignores it answers a `json_schema` request with
 * prose -- glm-5.3-flash through Ollama cloud wrote markdown essays where the
 * judge expected `{"score", "reasoning"}`. Those providers keep the schema
 * restated in the system prompt, which is what such models actually follow.
 */
const STRUCTURED_OUTPUT_ENFORCED_BY: ReadonlySet<AIProvider> = new Set([
  AIProvider.ANTHROPIC,
  AIProvider.OPENAI,
  AIProvider.AZURE_OPENAI,
  AIProvider.GOOGLE,
  AIProvider.GOOGLE_VERTEX_AI,
  AIProvider.MISTRAL_AI,
  AIProvider.XAI,
]);

/**
 * Makes a POST request to a provider and returns the response.
 * The POST request is constructed using the provider, apiKey, and requestBody parameters.
 * The fn parameter is the type of request being made (e.g., "complete", "chatComplete").
 */
export async function tryPost(
  c: AppContext,
  saConfig: SuperAgentsConfig,
  saTarget: SuperAgentsTarget,
  saRequestData: SuperAgentsRequestData,
  currentIndex: number,
): Promise<Response> {
  try {
    const hyperParamDefaults = getHyperParamDefaults(
      saRequestData.functionName,
      saTarget,
    );

    const overrideParams = saConfig?.override_params || {};
    // Merge: base request body -> config defaults -> override params
    const overriddenSuperAgentsRequestBody: SuperAgentsRequestBody = {
      ...(saRequestData.requestBody as Record<string, unknown>),
      ...hyperParamDefaults,
      ...overrideParams,
    } as SuperAgentsRequestBody;
    dropUnsupportedParameters(
      saRequestData.functionName,
      saTarget,
      overriddenSuperAgentsRequestBody as Record<string, unknown>,
    );

    // Where the provider constrains the output itself, restating the schema in
    // the system prompt adds nothing and only crowds out the prompt the skill
    // was configured with. Everywhere else it is what gets the JSON answered.
    const providerEnforcesResponseFormat = STRUCTURED_OUTPUT_ENFORCED_BY.has(
      saTarget.configuration.ai_provider,
    );

    // The JSON instructions asked for in prose: the schema, for the providers
    // that cannot express the constraint at all (Bedrock, Replicate, Workers
    // AI, ...) and for the ones that only forward it to the model behind them.
    const getJsonSchemaInstructions = (
      responseFormat: ChatCompletionRequestBody['response_format'],
    ): string => {
      if (!responseFormat || providerEnforcesResponseFormat) return '';

      // Telling a provider to call a tool it was never given is how answers end
      // up narrated or wrapped in a ```json fence, so ask for the bare object.
      const jsonOutputInstruction =
        'Respond with the JSON object alone: no markdown code fences, no commentary, no other text.';

      if (responseFormat.type === 'json_schema') {
        const schema =
          responseFormat.json_schema?.schema ?? responseFormat.json_schema;
        if (schema && typeof schema === 'object') {
          return `\n\nIMPORTANT: You must output your response as a JSON object that strictly conforms to the following schema:\n\n${JSON.stringify(schema, null, 2)}\n\nEnsure every required field is present with the correct type and format. ${jsonOutputInstruction}`;
        }
      } else if (responseFormat.type === 'json_object') {
        return `\n\nIMPORTANT: You must output your response as a valid JSON object. ${jsonOutputInstruction}`;
      }

      return '';
    };

    if (
      saTarget.configuration.system_prompt &&
      (saRequestData.functionName === FunctionName.CREATE_MODEL_RESPONSE ||
        saRequestData.functionName === FunctionName.CHAT_COMPLETE ||
        saRequestData.functionName === FunctionName.STREAM_CHAT_COMPLETE)
    ) {
      // Handle system prompt with template variables
      let systemPrompt = saTarget.configuration.system_prompt;

      // The JSON instructions, where they are needed, follow the skill's own
      // prompt: they describe the shape of the answer, not the job, and a
      // prompt that opens with gateway boilerplate reads as if the schema were
      // the point.
      const responseFormat = (
        overriddenSuperAgentsRequestBody as ChatCompletionRequestBody
      ).response_format;
      systemPrompt += getJsonSchemaInstructions(responseFormat);

      // Add system prompt if not overridden by the user
      switch (saRequestData.functionName) {
        case FunctionName.CHAT_COMPLETE:
        case FunctionName.STREAM_CHAT_COMPLETE: {
          // Copied: the body is a shallow spread of the caller's request, and
          // the caller's messages are still read after the handler returns.
          const messages = [
            ...(overriddenSuperAgentsRequestBody as ChatCompletionRequestBody)
              .messages,
          ];

          // Find existing system message or add new one at the beginning
          const systemMessageIndex = messages.findIndex(
            (msg) => msg.role === ChatCompletionMessageRole.SYSTEM,
          );
          const systemMessage = {
            role: ChatCompletionMessageRole.SYSTEM,
            content: systemPrompt,
          };

          if (systemMessageIndex >= 0) {
            // Replace existing system message
            messages[systemMessageIndex] = systemMessage;
          } else {
            // Add system message at the beginning
            messages.unshift(systemMessage);
          }

          (
            overriddenSuperAgentsRequestBody as ChatCompletionRequestBody
          ).messages = messages;
          break;
        }
        case FunctionName.CREATE_MODEL_RESPONSE: {
          const inputPreview = (
            overriddenSuperAgentsRequestBody as ResponsesRequestBody
          ).input;

          let input: Record<string, unknown>[] = [];
          // If inputPreview is not an array, convert it to an array so that we can add the system prompt
          if (!Array.isArray(inputPreview)) {
            input = [
              {
                role: ChatCompletionMessageRole.USER,
                content: inputPreview,
              },
            ];
          } else {
            input = [...inputPreview];
          }

          // Find existing system message or add new one at the beginning
          const systemMessageIndex = input.findIndex(
            (msg) => msg.role === ChatCompletionMessageRole.SYSTEM,
          );
          const systemMessage = {
            role: ChatCompletionMessageRole.SYSTEM,
            content: systemPrompt,
          };

          if (systemMessageIndex >= 0) {
            // Replace existing system message
            input[systemMessageIndex] = systemMessage;
          } else {
            // Add system message at the beginning
            input.unshift(systemMessage);
          }

          (overriddenSuperAgentsRequestBody as Record<string, unknown>).input =
            input;
        }
      }
    } else if (
      !saTarget.configuration.system_prompt &&
      (saRequestData.functionName === FunctionName.CHAT_COMPLETE ||
        saRequestData.functionName === FunctionName.STREAM_CHAT_COMPLETE)
    ) {
      // If there's no system prompt from the optimization arm,
      // we still need to augment any existing system message in the user's request
      // with JSON schema instructions if response_format is present
      const responseFormat = (
        overriddenSuperAgentsRequestBody as ChatCompletionRequestBody
      ).response_format;
      const jsonInstructions = getJsonSchemaInstructions(responseFormat);

      if (jsonInstructions) {
        // Copied for the same reason as above.
        const messages = [
          ...(overriddenSuperAgentsRequestBody as ChatCompletionRequestBody)
            .messages,
        ];

        // Find existing system message
        const systemMessageIndex = messages.findIndex(
          (msg) => msg.role === ChatCompletionMessageRole.SYSTEM,
        );

        if (systemMessageIndex >= 0) {
          // Augment existing system message
          const existingContent = messages[systemMessageIndex].content || '';
          messages[systemMessageIndex] = {
            ...messages[systemMessageIndex],
            content: existingContent + jsonInstructions,
          };
        } else {
          // Create new system message with just the JSON instructions
          messages.unshift({
            role: ChatCompletionMessageRole.SYSTEM,
            content: jsonInstructions.trim(),
          });
        }

        (
          overriddenSuperAgentsRequestBody as ChatCompletionRequestBody
        ).messages = messages;
      }
    }

    let isStreamingMode = false;
    if ('stream' in overriddenSuperAgentsRequestBody) {
      isStreamingMode = overriddenSuperAgentsRequestBody.stream
        ? (overriddenSuperAgentsRequestBody.stream as boolean)
        : false;
    }

    // A stream a blocking output hook has to review is served whole and
    // streamed to the client once judged; see `utils/held-stream.ts`.
    const heldStreamAs = isStreamingMode
      ? heldStreamFunction(saConfig, saRequestData.functionName)
      : null;
    if (heldStreamAs) {
      isStreamingMode = false;
      (overriddenSuperAgentsRequestBody as Record<string, unknown>).stream =
        false;
    }

    const overriddenSuperAgentsRequestData = (
      heldStreamAs
        ? { ...cloneDeep(saRequestData), functionName: heldStreamAs }
        : cloneDeep(saRequestData)
    ) as SuperAgentsRequestData;
    overriddenSuperAgentsRequestData.requestBody =
      overriddenSuperAgentsRequestBody;

    let strictOpenAiCompliance = true;

    if (saConfig.strict_open_ai_compliance === false) {
      strictOpenAiCompliance = false;
    }

    // Mapping providers to corresponding URLs
    const internalProviderConfig =
      providerConfigs[saTarget.configuration.ai_provider];

    if (!internalProviderConfig) {
      throw new Error(
        `Provider config not found for provider: ${saTarget.configuration.ai_provider}`,
      );
    }

    const apiConfig: InternalProviderAPIConfig = internalProviderConfig.api;

    const customHost = saTarget.custom_host || '';

    const baseUrl =
      customHost ||
      (await apiConfig.getBaseURL({
        c,
        saTarget,
        saRequestData: overriddenSuperAgentsRequestData,
      }));
    const endpoint = apiConfig.getEndpoint({
      c,
      saTarget,
      saRequestData: overriddenSuperAgentsRequestData,
    });

    const url =
      overriddenSuperAgentsRequestData.functionName === FunctionName.PROXY
        ? getProxyPath(
            overriddenSuperAgentsRequestData.url,
            saTarget.configuration.ai_provider,
            overriddenSuperAgentsRequestData.url.indexOf('/v1/proxy') > -1
              ? '/v1/proxy'
              : '/v1',
            baseUrl,
            saTarget,
          )
        : `${baseUrl}${endpoint}`;

    let fetchConfig: RequestInit = {};

    const outputSyncHooks = saConfig.hooks?.filter(
      (hook) => hook.type === HookType.OUTPUT_HOOK && hook.await === true,
    );

    c.set('sa_request_data', overriddenSuperAgentsRequestData);

    const commonRequestOptions: CommonRequestOptions = {
      saRequestData: overriddenSuperAgentsRequestData,
      aiProviderRequestURL: url,
      isStreamingMode,
      provider: saTarget.configuration.ai_provider,
      strictOpenAiCompliance,
      areSyncHooksAvailable: outputSyncHooks?.length > 0,
      currentIndex,
      fetchOptions: fetchConfig,
      cacheSettings: saTarget.cache,
    };

    const {
      errorResponse: inputHooksErrorResponse,
      transformedSuperAgentsBody,
    } = await inputHookHandler(c, overriddenSuperAgentsRequestData);

    if (inputHooksErrorResponse) {
      const createResponseOptions: CreateResponseOptions = {
        response: inputHooksErrorResponse,
        responseTransformerFunctionName: undefined,
        cacheStatus: CacheStatus.MISS,
        retryCount: undefined,
        aiProviderRequestBody: {},
        ...commonRequestOptions,
      };

      // Awaited so the 446 `createResponse` raises for it is caught below
      // and answered as one; returned as a promise it escapes this handler
      // as a bare 500.
      return await createResponse(c, createResponseOptions);
    }

    if (transformedSuperAgentsBody) {
      overriddenSuperAgentsRequestData.requestBody = transformedSuperAgentsBody;
    }

    let aiProviderRequestBody:
      | Record<string, unknown>
      | ReadableStream
      | ArrayBuffer
      | FormData = overriddenSuperAgentsRequestBody as
      | Record<string, unknown>
      | ReadableStream
      | ArrayBuffer
      | FormData;

    // Attach the body of the request
    if (
      !internalProviderConfig?.requestHandlers?.[
        overriddenSuperAgentsRequestData.functionName
      ]
    ) {
      aiProviderRequestBody =
        overriddenSuperAgentsRequestData.method === HttpMethod.POST
          ? transformToProviderRequest(
              saTarget.configuration.ai_provider,
              saTarget,
              overriddenSuperAgentsRequestData,
            )
          : overriddenSuperAgentsRequestBody;
    }

    const apiConfigHeaders = await apiConfig.headers({
      c,
      saTarget,
      saRequestData: overriddenSuperAgentsRequestData,
    });

    // Construct the base object for the POST request
    fetchConfig = constructRequest(
      overriddenSuperAgentsRequestData,
      apiConfigHeaders as Record<string, string>,
      {},
      {},
    );

    let apiConfigContentTypeHeader = apiConfigHeaders[HeaderKey.CONTENT_TYPE] as
      | string
      | undefined;

    if (!apiConfigContentTypeHeader) {
      apiConfigContentTypeHeader =
        overriddenSuperAgentsRequestData.requestHeaders[
          HeaderKey.CONTENT_TYPE
        ]?.split(';')[0];
      if (!apiConfigContentTypeHeader) {
        console.warn(
          'No Content-Type header found in request. Using application/json as default.',
        );

        apiConfigContentTypeHeader = 'application/json';
      }
    }

    const requestContentType =
      overriddenSuperAgentsRequestData.requestHeaders[
        HeaderKey.CONTENT_TYPE
      ]?.split(';')[0];

    if (
      apiConfigContentTypeHeader === ContentTypeName.MULTIPART_FORM_DATA ||
      (overriddenSuperAgentsRequestData.functionName === 'proxy' &&
        requestContentType === ContentTypeName.MULTIPART_FORM_DATA)
    ) {
      fetchConfig.body = aiProviderRequestBody as FormData;
    } else if (aiProviderRequestBody instanceof ReadableStream) {
      fetchConfig.body = aiProviderRequestBody;
    } else if (
      overriddenSuperAgentsRequestData.functionName === 'proxy' &&
      requestContentType?.startsWith(ContentTypeName.GENERIC_AUDIO_PATTERN)
    ) {
      fetchConfig.body = aiProviderRequestBody as ArrayBuffer;
    } else if (requestContentType) {
      fetchConfig.body = JSON.stringify(aiProviderRequestBody);
    }

    if (['GET', 'DELETE'].includes(overriddenSuperAgentsRequestData.method)) {
      delete fetchConfig.body;
    }

    // Return cached response if it exists
    const cachedResponse = await getCachedResponse(
      c,
      commonRequestOptions,
      aiProviderRequestBody,
    );

    if (cachedResponse) {
      return heldStreamAs
        ? releaseHeldStream(
            cachedResponse,
            saTarget.configuration.ai_provider,
            heldStreamAs,
          )
        : cachedResponse;
    }

    // Request handler (Including retries, recursion and hooks)
    const handlerResult = await recursiveOutputHookHandler(
      c,
      commonRequestOptions,
      url,
      fetchConfig,
      saTarget,
      isStreamingMode,
      overriddenSuperAgentsRequestData,
      0,
      strictOpenAiCompliance,
    );

    const createResponseOptions: CreateResponseOptions = {
      response: handlerResult.mappedResponse,
      responseTransformerFunctionName: undefined,
      cacheStatus: CacheStatus.MISS,
      retryCount: undefined,
      aiProviderRequestBody,
      responseAlreadyHandled: true, // Stream already processed by responseHandler
      ...commonRequestOptions,
    };

    const response = await createResponse(c, createResponseOptions);
    return heldStreamAs
      ? releaseHeldStream(
          response,
          saTarget.configuration.ai_provider,
          heldStreamAs,
        )
      : response;
  } catch (error) {
    if (error instanceof HttpError) {
      return error.toResponse();
    }
    return new Response(
      JSON.stringify({
        error: `${error}`,
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
        },
      },
    );
  }
}

export async function tryTarget(
  c: AppContext,
  saConfig: SuperAgentsConfig,
  saTarget: SuperAgentsTarget,
  saRequestData: SuperAgentsRequestData,
): Promise<Response> {
  return await tryPost(c, saConfig, saTarget, saRequestData, 0);
}

export async function tryTargets(
  c: AppContext,
  saConfig: SuperAgentsConfig,
  saRequestData: SuperAgentsRequestData,
): Promise<Response> {
  const strategyMode = saConfig.strategy.mode;

  let response: Response | undefined;

  switch (strategyMode) {
    case StrategyModes.FALLBACK:
      for (const target of saConfig.targets) {
        response = await tryTarget(c, saConfig, target, saRequestData);
        if (
          response?.ok &&
          !saConfig.strategy.on_status_codes?.includes(response?.status)
        ) {
          break;
        }
      }
      break;

    case StrategyModes.LOADBALANCE: {
      saConfig.targets.forEach((t: SuperAgentsTarget) => {
        if (t.weight === undefined) {
          t.weight = 1;
        }
      });
      const totalWeight = saConfig.targets.reduce(
        (sum: number, saTarget: SuperAgentsTarget) => sum + saTarget.weight!,
        0,
      );

      let randomWeight = Math.random() * totalWeight;
      for (const saTarget of saConfig.targets) {
        if (randomWeight < saTarget.weight) {
          response = await tryTarget(c, saConfig, saTarget, saRequestData);
          break;
        }
        randomWeight -= saTarget.weight;
      }
      break;
    }

    case StrategyModes.CONDITIONAL: {
      const metadata = saConfig.metadata;

      const params =
        saRequestData.requestBody instanceof FormData ||
        saRequestData.requestBody instanceof ReadableStream ||
        saRequestData.requestBody instanceof ArrayBuffer
          ? {} // Send empty object if not JSON
          : saRequestData.requestBody;

      let conditionalRouter: ConditionalRouter;
      let finalTarget: SuperAgentsTarget;
      try {
        conditionalRouter = new ConditionalRouter(saConfig, {
          metadata,
          params,
        });
        finalTarget = conditionalRouter.resolveTarget();
      } catch (e: unknown) {
        if (e instanceof Error) {
          throw new RouterError(e.message);
        }
        throw new RouterError('Unknown error');
      }

      response = await tryTarget(c, saConfig, finalTarget, saRequestData);
      break;
    }

    case StrategyModes.SINGLE:
      response = await tryTarget(
        c,
        saConfig,
        saConfig.targets[0],
        saRequestData,
      );
      break;

    default:
      try {
        response = await tryPost(
          c,
          saConfig,
          saConfig.targets[0],
          saRequestData,
          0,
        );
      } catch (e) {
        // tryPost always returns a Response.
        // TypeError will check for all unhandled exceptions.
        // GatewayError will check for all handled exceptions which cannot allow the request to proceed.
        if (e instanceof TypeError || e instanceof GatewayError) {
          const errorMessage =
            e instanceof GatewayError ? e.message : 'Something went wrong';
          response = new Response(
            JSON.stringify({
              status: 'failure',
              message: errorMessage,
            }),
            {
              status: 500,
              headers: {
                'content-type': 'application/json',
                // Add this header so that the fallback loop can be interrupted if its an exception.
                'sa-gateway-exception': 'true',
              },
            },
          );
        } else {
          if (e instanceof HttpError) {
            response = e.toResponse();
          }
        }
      }
      break;
  }

  if (!response) {
    throw new GatewayError('No response from target');
  }

  return response;
}

export async function recursiveOutputHookHandler(
  c: AppContext,
  commonRequestOptions: CommonRequestOptions,
  aiProviderRequestURL: string,
  options: RequestInit,
  saTarget: SuperAgentsTarget,
  isStreamingMode: boolean,
  saRequestData: SuperAgentsRequestData,
  retryAttemptsMade: number,
  strictOpenAiCompliance: boolean,
): Promise<{
  mappedResponse: Response;
  retryCount: number;
  createdAt: Date;
  originalResponseJson?: Record<string, unknown> | null;
}> {
  let response: Response,
    retryCount: number | undefined,
    createdAt: Date,
    retrySkipped: boolean;
  const requestTimeout = saTarget.request_timeout || null;

  const { retry } = saTarget;

  const providerConfig = providerConfigs[saTarget.configuration.ai_provider];
  if (!providerConfig) {
    throw new Error(`Provider ${saTarget.configuration.ai_provider} not found`);
  }
  const requestHandlers = providerConfig.requestHandlers;
  let requestHandler: (() => Promise<Response>) | undefined;

  const fn = saRequestData.functionName;

  if (requestHandlers?.[fn]) {
    const requestHandlerFunction = requestHandlers[fn];

    requestHandler = async (): Promise<Response> =>
      requestHandlerFunction({
        c,
        saTarget,
        saRequestData,
      });
  }

  ({
    response,
    attempt: retryCount,
    createdAt,
    skip: retrySkipped,
  } = await retryRequest(
    aiProviderRequestURL,
    options,
    retry?.attempts || 0,
    retry?.on_status_codes || [],
    requestTimeout || null,
    requestHandler,
    retry?.use_retry_after_header || false,
  ));

  // Create callbacks for streaming responses
  const onFirstChunk = isStreamingMode
    ? () => {
        c.set('first_token_time', Date.now());
      }
    : undefined;

  // Create a promise that resolves when the stream ends
  let streamEndResolver: ((accumulatedChunks: string) => void) | undefined;
  if (isStreamingMode) {
    const streamEndPromise = new Promise<void>((resolve) => {
      streamEndResolver = (accumulatedChunks: string) => {
        c.set('stream_end_time', Date.now());
        c.set('accumulated_stream_chunks', accumulatedChunks);
        resolve();
      };
    });
    c.set('stream_end_promise', streamEndPromise);
  }

  const {
    response: mappedResponse,
    saResponseBody,
    originalResponseJson,
  } = await responseHandler(
    response,
    isStreamingMode,
    saTarget.configuration.ai_provider,
    saRequestData.functionName,
    aiProviderRequestURL,
    CacheStatus.MISS,
    saRequestData,
    strictOpenAiCompliance,
    commonRequestOptions.areSyncHooksAvailable,
    onFirstChunk,
    streamEndResolver,
  );

  if (!mappedResponse.ok) {
    const errorBody = await mappedResponse.text();
    throw new HttpError(errorBody, {
      status: mappedResponse.status,
      statusText: mappedResponse.statusText,
      body: errorBody,
      contentType: mappedResponse.headers.get('content-type') ?? undefined,
    });
  }

  if (!saResponseBody && !isStreamingMode) {
    throw new GatewayError('No response body from target');
  }

  // For streaming responses, skip output hooks and return the streaming response directly
  if (isStreamingMode) {
    return {
      mappedResponse,
      retryCount: retryCount || 0,
      createdAt,
      originalResponseJson,
    };
  }

  const outputHookResponse = await outputHookHandler(
    c,
    saRequestData,
    mappedResponse,
    saResponseBody!, // Non-null assertion: we've already checked and returned early for streaming
    retryAttemptsMade,
  );

  const remainingRetryCount =
    (retry?.attempts || 0) - (retryCount || 0) - retryAttemptsMade;

  const isRetriableStatusCode = retry?.on_status_codes?.includes(
    outputHookResponse.status,
  );

  if (remainingRetryCount > 0 && !retrySkipped && isRetriableStatusCode) {
    return recursiveOutputHookHandler(
      c,
      commonRequestOptions,
      aiProviderRequestURL,
      options,
      saTarget,
      isStreamingMode,
      saRequestData,
      (retryCount || 0) + 1 + retryAttemptsMade,
      strictOpenAiCompliance,
    );
  }

  let lastAttempt = (retryCount || 0) + retryAttemptsMade;
  if (
    (lastAttempt === (retry?.attempts || 0) && isRetriableStatusCode) ||
    retrySkipped
  ) {
    lastAttempt = -1; // All retry attempts exhausted without success.
  }

  return {
    mappedResponse: outputHookResponse,
    retryCount: lastAttempt,
    createdAt,
    originalResponseJson,
  };
}
