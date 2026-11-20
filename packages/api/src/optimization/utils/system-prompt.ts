import {
  getApiUrl,
  getInternalApiKey,
  SA_SKILL_REQUEST_PARAMS,
} from '@api/constants';
import type { UserDataStorageConnector } from '@api/types/connector';
import type { AppContext } from '@api/types/hono';
import {
  agentById,
  resolveRoleModel,
} from '@api/utils/evaluation-model-resolver';
import { warn } from '@shared/console-logging';
import type { ReasoningEffort } from '@shared/types/api/routes/shared/thinking';
import type { Agent, Skill } from '@shared/types/data';
import OpenAI from 'openai';
import type { ParsedChatCompletion } from 'openai/resources/chat/completions.mjs';
import z from 'zod';

const StructuredOutputResponse = z.object({
  system_prompt: z.string(),
});

type StructuredOutputResponse = z.infer<typeof StructuredOutputResponse>;

/**
 * Shared function to generate the template variables section for prompts.
 * Only returns content if variables are provided (assumes user defined them for a reason).
 */
function getTemplateVariablesSection(
  allowedTemplateVariables?: string[],
): string {
  if (!allowedTemplateVariables || allowedTemplateVariables.length === 0) {
    return '';
  }

  return `

**Template Variables:**
You MUST use template variables in the system prompt using double curly braces.
Required variables:
${allowedTemplateVariables.map((v) => `- {{ ${v} }}`).join('\n')}

These variables will be provided by the user at runtime via system_prompt_variables.`;
}

/**
 * Shared function to generate the response format section for prompts.
 */
function getResponseFormatSection(responseFormat?: unknown): string {
  if (!responseFormat) {
    return '';
  }

  return `

CRITICAL: This agent must produce output conforming to the following JSON schema:

${JSON.stringify(responseFormat, null, 2)}

The system prompt MUST be designed around this schema. Include explicit instructions for every required field, specify exact data types and formats, explain constraints, and guide the assistant on how to structure its output to match this schema perfectly.`;
}

/**
 * Shared function to generate the examples section for prompts.
 */
function getExamplesSection(examples: string[]): string {
  if (examples.length === 0) {
    return '';
  }

  return `

Here are real examples of inputs and outputs to inform the system prompt:

${examples.join('\n\n---\n\n')}

Analyze these examples to understand the task better and incorporate any patterns or domain-specific knowledge into the system prompt.`;
}

/**
 * Shared function to create and configure OpenAI client for system prompt generation.
 */
async function createSystemPromptClient(
  c: AppContext,
  skillName: string,
  connector: UserDataStorageConnector,
  agent: Agent | null = null,
) {
  // The agent whose skill this prompt is for answers for the model, its
  // timeout and its effort; the system settings answer for the rest.
  const modelConfig = await resolveRoleModel(
    c,
    'system_prompt_reflection',
    connector,
    agent,
  );

  if (!modelConfig) {
    warn(
      '[OPTIMIZER] No system prompt reflection model configured in system settings',
    );
    throw new Error(
      'No system prompt reflection model configured in system settings',
    );
  }

  const client = new OpenAI({
    apiKey: getInternalApiKey(c),
    baseURL: `${getApiUrl(c)}/v1`,
    // Without this the client waits ten minutes and retries twice, which
    // outlives the reflection lock this runs under.
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
    skill_name: skillName,
  };

  return {
    client,
    saConfig,
    model: modelConfig.model,
    reasoningEffort: modelConfig.reasoningEffort,
  };
}

/**
 * Shared function to call OpenAI with structured output for system prompt generation.
 */
async function callSystemPromptAPI(
  client: OpenAI,
  saConfig: unknown,
  model: string,
  systemPrompt: string,
  userMessage: string,
  reasoningEffort?: ReasoningEffort | null,
): Promise<string> {
  const response: ParsedChatCompletion<StructuredOutputResponse> = await client
    .withOptions({
      defaultHeaders: {
        'sa-config': JSON.stringify(saConfig),
      },
    })
    .chat.completions.parse({
      ...SA_SKILL_REQUEST_PARAMS,
      // Only when the role's setting names one: a model that takes no such
      // parameter is left at its own default.
      ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: userMessage,
        },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'system_prompt_generator',
          strict: true,
          schema: z.toJSONSchema(StructuredOutputResponse),
        },
      },
    });

  const structuredOutputResponse = response.choices[0].message.parsed;

  if (!structuredOutputResponse) {
    throw new Error(
      `[OPTIMIZER] can't generate system prompt - No response found`,
    );
  }

  // Only a provider that enforces `response_format` guarantees the shape, so
  // the reply is checked rather than trusted -- otherwise a model that answered
  // in some other shape stores `undefined` as the arm's system prompt.
  const validated = StructuredOutputResponse.safeParse(
    structuredOutputResponse,
  );

  if (!validated.success) {
    throw new Error(
      `[OPTIMIZER] can't generate system prompt - the response does not match the schema: ${validated.error.message}`,
    );
  }

  return validated.data.system_prompt;
}

function getSeederSystemPrompt() {
  const systemPrompt =
    'You are an AI assistant in charge of training AI agents to do specific tasks.';

  return systemPrompt;
}

function getSeederFirstMessage(description: string) {
  const firstMessage = `
Given the following description of an AI agent, generate a system prompt for the AI agent so that it can produce high-quality responses:

${description}
`;

  return firstMessage;
}

/**
 * A skill the gateway created keeps the prompt its caller sent. Regeneration
 * should improve on that prompt, not write another from the description.
 */
/**
 * A decision skill's system prompt is not a chat prompt, and a writer that
 * has only ever written chat prompts writes a persona and an output format
 * for a model that has no use for either. This is what it is told instead.
 */
const DECISION_POLICY_BRIEF = `This skill is served by a decision model, not a chat model. A decision model reads some material (the "state") and answers questions about it -- yes or no, one of several options, or a level on a scale -- with a probability for each answer, in a single forward pass. It writes nothing.

What you write is the skill's policy. It is placed ahead of every question's own instructions, so the model reads it before each question it answers. A good policy:
- defines the terms the questions turn on, and says where their lines fall, with concrete cases on either side of each line
- states the rules and priorities a careful expert would apply to this material, including which one wins when two conflict
- is plain, declarative text: no persona, no greeting, no instructions to think step by step, and nothing about output format, JSON or tools -- the model answers with probabilities whatever the policy says
- does not repeat the questions, which are asked after it in their own words`;

function isDecisionAgent(agent: Agent | null): boolean {
  return agent?.agent_type === 'decision';
}

function getPolicySeederSystemPrompt() {
  return 'You are an expert at writing the policies decision models answer under: the rules a model that answers questions with probabilities reads before each question.';
}

function getPolicySeederFirstMessage(description: string) {
  return `
Given the following description of a skill, write the policy its decision model answers its questions under.

${DECISION_POLICY_BRIEF}

Skill description:
${description}
`;
}

function getSeedPromptSection(seedSystemPrompt?: string | null) {
  if (!seedSystemPrompt) {
    return '';
  }

  return `

The developer's own system prompt for this skill is below. Keep its intent, constraints and output format, and improve on it rather than replacing it:

${seedSystemPrompt}`;
}

function getSeederWithContextFirstMessage(
  agentDescription: string,
  skillDescription: string,
  examples: string[],
  responseFormat?: unknown,
  allowedTemplateVariables?: string[],
  seedSystemPrompt?: string | null,
) {
  const responseFormatSection = getResponseFormatSection(responseFormat);
  const examplesSection = getExamplesSection(examples);
  const templateVariablesSection = getTemplateVariablesSection(
    allowedTemplateVariables,
  );
  const seedPromptSection = getSeedPromptSection(seedSystemPrompt);

  const firstMessage = `
I am building an AI agent with the following purpose:

Agent Description:
${agentDescription}

The agent has a specific skill it needs to perform:

Skill Description:
${skillDescription}
${responseFormatSection}
${examplesSection}
${templateVariablesSection}${seedPromptSection}

Generate a comprehensive system prompt that will enable the assistant to perform this skill effectively. The system prompt should be clear, detailed, and actionable.

Return the system prompt in a JSON object.`;

  return firstMessage;
}

/**
 * The policy writer's brief, from a decision skill's first real requests.
 * Each example is a decision log: the state, the questions, and how the model
 * answered them before it had a policy.
 */
function getPolicySeederWithContextFirstMessage(
  agentDescription: string,
  skillDescription: string,
  examples: string[],
  allowedTemplateVariables?: string[],
  seedSystemPrompt?: string | null,
) {
  const examplesSection =
    examples.length === 0
      ? ''
      : `

Here are real requests this skill was sent, with how the model answered them:

${examples.join('\n\n---\n\n')}

Read them for what the material looks like, which cases are close calls, and where a rule would settle them.`;
  const seedSection = seedSystemPrompt
    ? `

The developer's own policy for this skill is below. Keep its intent and its rules, and improve on it rather than replacing it:

${seedSystemPrompt}`
    : '';

  return `
I am building an agent with the following purpose:

Agent Description:
${agentDescription}

The agent has a specific skill it needs to perform:

Skill Description:
${skillDescription}

${DECISION_POLICY_BRIEF}
${examplesSection}
${getTemplateVariablesSection(allowedTemplateVariables)}${seedSection}

Write the policy that will let the model answer this skill's questions as a careful expert would.

Return the policy in a JSON object, as its system prompt.`;
}

export async function generateSeedSystemPromptForSkill(
  c: AppContext,
  skill: Skill,
  connector: UserDataStorageConnector,
) {
  const agent = await agentById(c, connector, skill.agent_id);
  const { client, saConfig, model, reasoningEffort } =
    await createSystemPromptClient(
      c,
      'system-prompt-seeding',
      connector,
      agent,
    );

  const decision = isDecisionAgent(agent);
  const systemPrompt = decision
    ? getPolicySeederSystemPrompt()
    : getSeederSystemPrompt();
  const userMessage = decision
    ? getPolicySeederFirstMessage(skill.description)
    : getSeederFirstMessage(skill.description);

  return await callSystemPromptAPI(
    client,
    saConfig,
    model,
    systemPrompt,
    userMessage,
    reasoningEffort,
  );
}

export async function generateSeedSystemPromptWithContext(
  c: AppContext,
  agentDescription: string,
  skillDescription: string,
  examples: string[],
  connector: UserDataStorageConnector,
  responseFormat?: unknown,
  allowedTemplateVariables?: string[],
  seedSystemPrompt?: string | null,
  /** Whose skill this prompt is for, when the caller knows. */
  agent: Agent | null = null,
) {
  const { client, saConfig, model, reasoningEffort } =
    await createSystemPromptClient(
      c,
      'system-prompt-seeding-with-context',
      connector,
      agent,
    );

  const decision = isDecisionAgent(agent);
  const systemPrompt = decision
    ? getPolicySeederSystemPrompt()
    : getSeederSystemPrompt();
  // A decision model has no response format to design a prompt around.
  const userMessage = decision
    ? getPolicySeederWithContextFirstMessage(
        agentDescription,
        skillDescription,
        examples,
        allowedTemplateVariables,
        seedSystemPrompt,
      )
    : getSeederWithContextFirstMessage(
        agentDescription,
        skillDescription,
        examples,
        responseFormat,
        allowedTemplateVariables,
        seedSystemPrompt,
      );

  return await callSystemPromptAPI(
    client,
    saConfig,
    model,
    systemPrompt,
    userMessage,
    reasoningEffort,
  );
}

function getReflectorSystemPrompt() {
  const systemPrompt = `You are an expert at refining AI system prompts based on performance feedback. You will receive:
1. The current system prompt
2. The best example it ever produced (what to preserve)
3. Recent failures with evaluation results explaining what went wrong (what to fix)

Your task: Generate an improved system prompt that maintains the strengths while fixing the specific issues identified in the evaluation feedback.`;

  return systemPrompt;
}

function getReflectorFirstMessage(
  currentSystemPrompt: string,
  bestExamples: string[],
  worstExamples: string[],
  agentDescription: string,
  skillDescription: string,
  allowedTemplateVariables: string[],
) {
  const firstMessage = `# Context

Agent: ${agentDescription}
Skill: ${skillDescription}

# Current System Prompt
'''
${currentSystemPrompt}
'''

# Performance Analysis

## Best Example (Peak Performance - Preserve These Qualities)
'''
${bestExamples.join('\n\n---\n\n')}
'''

## Recent Failures (Fix These Issues)

Each failure below includes evaluation results that explain exactly what went wrong. Use this feedback to identify and fix specific problems.

'''
${worstExamples.join('\n\n---\n\n')}
'''

# Instructions

Generate an improved system prompt that:
1. **Preserves** the qualities that led to the best example
2. **Fixes** the specific issues identified in the evaluation results
3. **Handles** any "Request Constraints" (JSON schemas, tools, etc.) shown in the examples

Key points:
- If examples show structured output (response_format), design the prompt around that schema
- Include explicit instructions for every required field, data type, and constraint
- Extract and include any domain-specific knowledge or strategies from the examples
- Make the prompt clear, actionable, and focused on the actual task requirements
${getTemplateVariablesSection(allowedTemplateVariables)}

Return the new system prompt as JSON.`;

  return firstMessage;
}

function getPolicyReflectorSystemPrompt() {
  return `You are an expert at refining the policies decision models answer under, from how their answers scored. You will receive:
1. The current policy
2. The request it answered best (what to preserve)
3. Recent requests it answered worst, each with an evaluation saying what the right answers were (what to fix)

Your task: write an improved policy that keeps what led to the best answers and settles the cases the worst ones got wrong.`;
}

function getPolicyReflectorFirstMessage(
  currentPolicy: string,
  bestExamples: string[],
  worstExamples: string[],
  agentDescription: string,
  skillDescription: string,
  allowedTemplateVariables: string[],
) {
  return `# Context

Agent: ${agentDescription}
Skill: ${skillDescription}

${DECISION_POLICY_BRIEF}

# Current Policy
'''
${currentPolicy || '(none yet: the questions have been asked as they came)'}
'''

# Performance Analysis

## Best Answered (Preserve What Decided These)
'''
${bestExamples.join('\n\n---\n\n')}
'''

## Recent Failures (Settle These Cases)

Each request below shows the model's answers, then the evaluation: the right answer to each question, how much of its probability the model put there, and why that answer is right.

'''
${worstExamples.join('\n\n---\n\n')}
'''

# Instructions

Write an improved policy that:
1. **Preserves** the definitions and rules that led to the best answers
2. **Settles** each case the failures got wrong: where the model leaned the wrong way, add or sharpen the definition, threshold or rule that decides that case, in general terms that cover its neighbours too
3. **Stays** a policy: declarative, about the material and what the questions turn on, never about format
${getTemplateVariablesSection(allowedTemplateVariables)}

Return the new policy as JSON, as its system prompt.`;
}

export async function generateReflectiveSystemPromptForSkill(
  c: AppContext,
  currentSystemPrompt: string,
  bestExamples: string[],
  worstExamples: string[],
  agentDescription: string,
  skillDescription: string,
  allowedTemplateVariables: string[],
  connector: UserDataStorageConnector,
  /** Whose skill is being reflected on, when the caller knows. */
  agent: Agent | null = null,
) {
  const { client, saConfig, model, reasoningEffort } =
    await createSystemPromptClient(
      c,
      'system-prompt-reflection',
      connector,
      agent,
    );

  const decision = isDecisionAgent(agent);
  const systemPrompt = decision
    ? getPolicyReflectorSystemPrompt()
    : getReflectorSystemPrompt();
  const userMessage = (
    decision ? getPolicyReflectorFirstMessage : getReflectorFirstMessage
  )(
    currentSystemPrompt,
    bestExamples,
    worstExamples,
    agentDescription,
    skillDescription,
    allowedTemplateVariables,
  );

  return await callSystemPromptAPI(
    client,
    saConfig,
    model,
    systemPrompt,
    userMessage,
    reasoningEffort,
  );
}
