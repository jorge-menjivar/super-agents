import {
  getApiUrl,
  getInternalApiKey,
  SA_SKILL_REQUEST_PARAMS,
} from '@api/constants';
import type {
  EvaluationMethodConnector,
  UserDataStorageConnector,
} from '@api/types/connector';
import type { AppContext } from '@api/types/hono';
import { resolveSystemSettingsModel } from '@api/utils/evaluation-model-resolver';
import { warn } from '@shared/console-logging';
import type { Skill } from '@shared/types/data';
import type {
  SkillOptimizationEvaluation,
  SkillOptimizationEvaluationCreateParams,
} from '@shared/types/data/skill-optimization-evaluation';
import type { EvaluationMethodName } from '@shared/types/evaluations';
import OpenAI from 'openai';
import type { ParsedChatCompletion } from 'openai/resources/chat/completions.mjs';
import z from 'zod';

function getSetupEvaluationSystemPrompt() {
  const systemPrompt = `You are an AI assistant that configures evaluation methods for AI agent training systems.

Your role is to generate evaluation METHOD PARAMETERS, not to create evaluation prompts or judge agents yourself.

The evaluation system has two stages:
1. EXTRACTION: An AI extracts the "task" and "outcome" from each request/response
2. VERDICT: An AI judges if the outcome matches the task

You are configuring WHAT TASK to extract (stage 1), not creating the judge (stage 2).`;

  return systemPrompt;
}

function getSetupEvaluationFirstMessage(
  agentDescription: string,
  skillDescription: string,
  evaluationConnector: EvaluationMethodConnector,
  examples?: string[],
) {
  const details = evaluationConnector.getDetails();
  const evaluationName = details.method;
  const evaluationDescription = details.description;

  let firstMessage = `
I am building an AI agent with the following purpose:

Agent Description:
'''
${agentDescription}
'''

This agent has a specific skill that it needs to perform:

Skill Description:
'''
${skillDescription}
'''

Configure the evaluation method: ${evaluationName} (${evaluationDescription}).

Your task: Generate parameters that define WHAT TASK the extraction AI should look for in request/response pairs.

IMPORTANT: You are NOT creating judge prompts or evaluation criteria. You are defining:
- The "task" field: A clear, concise description of what task the AI agent is trying to accomplish
  Example: "Generate a calendar event JSON object from plain text with only real participant names"

This task description will be used by a separate extraction AI to identify what the user was trying to accomplish in each request.

Focus on being specific and actionable. The task should be something measurable and observable in the agent's outputs.
`;

  // If we have examples from actual requests, include them
  if (examples && examples.length > 0) {
    firstMessage += `

CONTEXT: Below are examples of actual requests and responses from this skill in production.

'''
${examples.join('\n\n---\n\n')}
'''

Based on these examples, refine your task description to be:
1. SPECIFIC to what you observe the agent doing (e.g., "Generate JSON with fields X, Y, Z" not just "Generate JSON")
2. CLEAR about any constraints or requirements (e.g., "Only use real person names" if you see that pattern)
3. FOCUSED on the core deliverable (what the user actually receives)

Pay attention to:
- Any "Request Constraints" sections showing JSON schemas, tools, or output formats
- Patterns in what the agent produces (structured data formats, specific fields, constraints)
- Consistent requirements across multiple examples

Your task description will guide the extraction AI to understand what users are asking for.
`;
  }

  return firstMessage;
}

/**
 * Whether the method has any parameter for a model to fill in.
 *
 * Most methods declare an empty AI schema: they are configured entirely by
 * their own defaults, and `task_completion` is the only one that asks for
 * anything. Sending the model a schema with no properties spends a request to
 * be told `{}`, and a provider that does not enforce the schema -- a
 * self-hosted model, most of all -- answers with whatever it thought was
 * wanted. That reply used to be stored verbatim, and the method's own
 * parameter schema then rejected it at evaluation time, long after the fact:
 *
 *   [REALTIME_EVAL] Failed to evaluate log ... with method tool_correctness:
 *   Unrecognized key: "task"
 */
function hasGeneratableParameters(schema: z.ZodType): boolean {
  if (schema instanceof z.ZodObject) {
    return Object.keys(schema.shape).length > 0;
  }
  return true;
}

export async function generateEvaluationCreateParams(
  c: AppContext,
  skill: Skill,
  evaluationConnector: EvaluationMethodConnector,
  method: EvaluationMethodName,
  agentDescription: string,
  connector: UserDataStorageConnector,
  examples?: string[],
): Promise<SkillOptimizationEvaluationCreateParams> {
  const schema = evaluationConnector.getAIParameterSchema;

  // A method with nothing for a model to fill in needs no model at all: its
  // parameters are the schema's defaults. Resolving one first meant a
  // deployment that had configured no generation model could not add even
  // these -- and every method but task_completion is one of them.
  if (!schema || !hasGeneratableParameters(schema)) {
    return {
      agent_id: skill.agent_id,
      skill_id: skill.id,
      evaluation_method: method,
      params: {}, // Use default parameters from schema
      weight: 1.0,
    };
  }

  // Resolve evaluation generation model from system settings
  const modelConfig = await resolveSystemSettingsModel(
    c,
    'evaluation_generation',
    connector,
  );

  if (!modelConfig) {
    warn(
      '[OPTIMIZER] No evaluation generation model configured in system settings',
    );
    throw new Error(
      'No evaluation generation model configured in system settings',
    );
  }

  // Create OpenAI client pointing to local Super Agents API
  const client = new OpenAI({
    apiKey: getInternalApiKey(c),
    baseURL: `${getApiUrl(c)}/v1`,
    // Without this the client waits ten minutes and retries twice, which
    // outlives the evaluation lock this runs under.
    timeout: modelConfig.timeoutMs,
    maxRetries: 1,
  });

  const saConfig = {
    targets: [
      {
        provider: modelConfig.provider,
        model: modelConfig.model,
        ...(modelConfig.apiKey ? { api_key: modelConfig.apiKey } : {}),
        ...(modelConfig.customHost
          ? { custom_host: modelConfig.customHost }
          : {}),
      },
    ],
    agent_name: 'super-agents',
    skill_name: 'create-evaluations',
  };

  const jsonSchema = z.toJSONSchema(schema);

  const systemPrompt = getSetupEvaluationSystemPrompt();
  const firstMessage = getSetupEvaluationFirstMessage(
    agentDescription,
    skill.description,
    evaluationConnector,
    examples,
  );

  const response: ParsedChatCompletion<typeof schema> = await client
    .withOptions({
      defaultHeaders: {
        'sa-config': JSON.stringify(saConfig),
      },
    })
    .chat.completions.parse({
      ...SA_SKILL_REQUEST_PARAMS,
      // Only when the role's setting names one: a model that takes no such
      // parameter is left at its own default.
      ...(modelConfig.reasoningEffort
        ? { reasoning_effort: modelConfig.reasoningEffort }
        : {}),
      model: modelConfig.model,
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
          name: 'params',
          strict: true,
          schema: jsonSchema,
        },
      },
    });

  const structuredOutputResponse = response.choices[0].message.parsed;

  if (!structuredOutputResponse) {
    throw new Error(
      `[OPTIMIZER] can't generate evaluations for skill - No response found`,
    );
  }

  // The model's answer is checked against the schema it was given rather than
  // trusted: only a provider that enforces `response_format` guarantees the
  // shape, and these parameters are read back much later, by the evaluation
  // that runs on every request. Parsing also fills in the defaults the model
  // left out, such as `task_completion`'s threshold.
  const validated = schema.safeParse(structuredOutputResponse);

  if (!validated.success) {
    throw new Error(
      `[OPTIMIZER] can't generate evaluations for skill - the ${method} parameters the model returned do not match its schema: ${validated.error.message}`,
    );
  }

  const params: SkillOptimizationEvaluationCreateParams = {
    agent_id: skill.agent_id,
    skill_id: skill.id,
    evaluation_method: method,
    params: validated.data as Record<string, unknown>,
    weight: 1.0, // Default weight - can be adjusted by user
  };

  return params;
}

/**
 * Regenerates evaluations for a skill using real request examples.
 * This should be called after the skill has been used in production to create
 * evaluations that are better aligned with actual usage patterns.
 */
export async function regenerateEvaluationsWithExamples(
  c: AppContext,
  skill: Skill,
  agentDescription: string,
  examples: string[],
  evaluationConnectors: Record<string, EvaluationMethodConnector>,
  existingEvaluationMethods: EvaluationMethodName[],
  connector: UserDataStorageConnector,
): Promise<SkillOptimizationEvaluationCreateParams[]> {
  const regeneratePromises = existingEvaluationMethods.map(async (method) => {
    const evaluationConnector = evaluationConnectors[method];
    if (!evaluationConnector) {
      throw new Error(`Evaluation connector not found for method ${method}`);
    }

    return await generateEvaluationCreateParams(
      c,
      skill,
      evaluationConnector,
      method,
      agentDescription,
      connector,
      examples,
    );
  });

  return await Promise.all(regeneratePromises);
}

/**
 * Apply regenerated evaluations to the ones a skill already has: matched by
 * method, updated in place. An evaluation's id is what every judge result
 * recorded against it points at -- a log's weighted score is computed by
 * joining its results back to these rows -- so regeneration must never
 * delete and recreate them: that orphans every score the skill's logs have
 * and blanks them in the dashboard. A method that was not regenerated keeps
 * what it had.
 */
export async function applyRegeneratedEvaluations(
  c: AppContext,
  connector: UserDataStorageConnector,
  existing: SkillOptimizationEvaluation[],
  regenerated: SkillOptimizationEvaluationCreateParams[],
): Promise<void> {
  for (const evaluation of existing) {
    const next = regenerated.find(
      (params) => params.evaluation_method === evaluation.evaluation_method,
    );
    if (!next) continue;
    await connector.updateSkillOptimizationEvaluation(c, evaluation.id, {
      params: next.params,
      weight: next.weight,
    });
  }
}
