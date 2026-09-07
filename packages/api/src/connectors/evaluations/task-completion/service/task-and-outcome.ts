import type { TaskCompletionEvaluationParameters } from '@api/connectors/evaluations/task-completion/types';
import {
  getApiUrl,
  getInternalApiKey,
  SA_SKILL_REQUEST_PARAMS,
} from '@api/constants';
import { parseJudgeJson } from '@api/evaluations/llm-judge';
import type { UserDataStorageConnector } from '@api/types/connector';
import type { AppContext } from '@api/types/hono';
import { resolveJudgeModelConfig } from '@api/utils/evaluation-model-resolver';
import { warn } from '@shared/console-logging';
import OpenAI from 'openai';
import z from 'zod';

const StructuredOutputResponse = z.object({
  task: z.string(),
  outcome: z.string(),
});

// The outcome is scoped to the latest response on purpose: every earlier
// turn of the conversation arrived as its own request, carries its own log,
// and is scored by its own evaluation run -- often under a different arm.
// An outcome that narrates the whole conversation re-scores those turns
// here, crediting (or docking) this turn's arm for work it did not do.
function getSystemPrompt(task?: string) {
  const systemPrompt = `You are an expert at analyzing AI system interactions to extract task objectives and factual outcomes.

${task ? `The TASK: ${task}\n` : 'Your job is to analyze the conversation to determine the task. What was the user trying to accomplish?\n'}
    
Your job is to determine the OUTCOME of the assistant's LATEST RESPONSE: what that response did or produced toward the task. The conversation before it is context only -- each earlier turn is evaluated with its own request, so events from earlier turns (mistakes already corrected, work already done, detours already resolved) belong to those turns and must not be folded into this outcome.

Be precise and factual. Focus on the concrete task and on what the latest response itself contributes.`;

  return systemPrompt;
}

function getFirstMessage(input: string, output: string) {
  const firstMessage = `Analyze this interaction and extract the task and outcome:

CONVERSATION (context only -- earlier turns are evaluated separately):
${input}

THE ASSISTANT'S LATEST RESPONSE (extract the outcome of this):
${output}

Extract the TASK from the conversation and the OUTCOME of the latest response.`;

  return firstMessage;
}

export async function extractTaskAndOutcome(
  c: AppContext,
  params: TaskCompletionEvaluationParameters,
  input: string,
  output: string,
  connector: UserDataStorageConnector,
) {
  // Resolve judge model from system settings for task extraction. Extraction
  // runs under the judge's timeout and token budget alike: same model, same
  // reasoning spent before the answer.
  const modelConfig = await resolveJudgeModelConfig(c, connector);

  if (!modelConfig) {
    warn('[OPTIMIZER] No judge model configured in system settings');
    throw new Error('No judge model configured in system settings');
  }

  const client = new OpenAI({
    apiKey: getInternalApiKey(c),
    baseURL: `${getApiUrl(c)}/v1`,
    timeout: modelConfig.timeoutMs,
    maxRetries: 1,
  });

  const saConfig = {
    targets: [
      {
        provider: modelConfig.provider,
        model: modelConfig.model,
        ...(modelConfig.apiKey ? { api_key: modelConfig.apiKey } : {}),
        // Same reason as the other internal skills: without this a self-hosted
        // provider is sent to its vendor default.
        ...(modelConfig.customHost
          ? { custom_host: modelConfig.customHost }
          : {}),
      },
    ],
    agent_name: 'super-agents',
    skill_name: 'extract-task-and-outcome',
  };

  const systemPrompt = getSystemPrompt(params.task);
  const firstMessage = getFirstMessage(input, output);

  const response = await client
    .withOptions({
      defaultHeaders: {
        'sa-config': JSON.stringify(saConfig),
      },
    })
    .chat.completions.create({
      ...SA_SKILL_REQUEST_PARAMS,
      model: modelConfig.model,
      // Extraction is part of the task-completion evaluation, so it runs
      // under the same overrides the scoring call does.
      max_tokens: params.max_tokens ?? modelConfig.maxTokens,
      ...((params.reasoning_effort ?? modelConfig.reasoningEffort)
        ? {
            reasoning_effort:
              params.reasoning_effort ?? modelConfig.reasoningEffort,
          }
        : {}),
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: firstMessage,
        },
      ],
      // This is a custom zodTextFormat to make it work with zod v4
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'event',
          strict: true,
          schema: z.toJSONSchema(StructuredOutputResponse),
        },
      },
    });

  // Parsed tolerantly, like the judge's own answers: a self-hosted model
  // ignores `response_format` often enough that the SDK's strict `.parse()`
  // kept failing the whole evaluation on a trailing comma.
  const content = response.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error(
      `[OPTIMIZER] can't extract task and outcome - No response found`,
    );
  }
  const structuredOutputResponse = parseJudgeJson(content);

  // Only a provider that enforces `response_format` guarantees the shape, so
  // the reply is checked rather than trusted -- a missing outcome would
  // otherwise reach the judge as `undefined` and be scored as if it were an
  // answer.
  const validated = StructuredOutputResponse.safeParse(
    structuredOutputResponse,
  );

  if (!validated.success) {
    throw new Error(
      `[OPTIMIZER] can't extract task and outcome - the response does not match the schema: ${validated.error.message}`,
    );
  }

  return validated.data;
}
