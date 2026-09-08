import { judgeOverrides } from '@api/connectors/evaluations/judge-overrides';
import { extractTaskAndOutcome } from '@api/connectors/evaluations/task-completion/service/task-and-outcome';
import getTaskCompletionVerdictTemplate from '@api/connectors/evaluations/task-completion/templates/verdict';
import { TaskCompletionEvaluationParameters } from '@api/connectors/evaluations/task-completion/types';
import { humanVerdictNote } from '@api/evaluations/human-verdict';
import { createLLMJudge } from '@api/evaluations/llm-judge';
import type {
  EvaluateLogOptions,
  UserDataStorageConnector,
} from '@api/types/connector';
import type { LLMJudge } from '@api/types/evaluations/llm-judge';
import type { AppContext } from '@api/types/hono';
import {
  agentOfSkill,
  resolveEvaluationModelConfig,
} from '@api/utils/evaluation-model-resolver';
import {
  extractSystemPromptFromMessages,
  formatMessagesForExtraction,
} from '@api/utils/messages';
import { extractMessagesFromRequestData } from '@api/utils/super-agents/requests';
import {
  extractOutputFromResponseBody,
  responseEndsInToolCalls,
} from '@api/utils/super-agents/responses';
import type {
  ChatCompletionRequestData,
  ResponsesRequestData,
  StreamChatCompletionRequestData,
} from '@shared/types/api/request';
import { SuperAgentsResponseBody } from '@shared/types/api/response';
import type {
  SkillOptimizationEvaluation,
  SkillOptimizationEvaluationResult,
} from '@shared/types/data';
import type { CompletedLog } from '@shared/types/data/log';
import { EvaluationMethodName } from '@shared/types/evaluations';
import { produceSuperAgentsRequestData } from '@shared/utils/sa-request-data';

/**
 * Generate verdict using universal LLM judge with verdict template
 */
async function generateVerdict(
  {
    task,
    outcome,
    inProgress,
    humanVerdict,
    humanVerdictReason,
  }: {
    task: string;
    outcome: string;
    inProgress: boolean;
    humanVerdict?: 'good' | 'bad';
    humanVerdictReason?: string;
  },
  llm_judge: LLMJudge,
): Promise<{ verdict: number; reason: string }> {
  const verdictTemplate = getTaskCompletionVerdictTemplate({
    task,
    outcome,
    inProgress,
    humanVerdictNote: humanVerdict
      ? humanVerdictNote(humanVerdict, humanVerdictReason)
      : undefined,
  });
  // Explicit prompts: the heuristic re-split of the joined text only kept
  // returning real scores because the template's JSON instruction happened
  // to land in the user half of the split.
  const verdict_result = await llm_judge.evaluate({
    text: `${verdictTemplate.systemPrompt}\n\n${verdictTemplate.userPrompt}`,
    systemPrompt: verdictTemplate.systemPrompt,
    userPrompt: verdictTemplate.userPrompt,
  });

  return {
    verdict: verdict_result.score,
    reason: verdict_result.reasoning,
  };
}

async function getTaskAndOutcome(
  c: AppContext,
  params: TaskCompletionEvaluationParameters,
  log: CompletedLog,
  connector: UserDataStorageConnector,
): Promise<{ task: string; outcome: string; inProgress: boolean }> {
  const saRequestData = produceSuperAgentsRequestData(
    log.ai_provider_request_log.method,
    log.ai_provider_request_log.request_url,
    {},
    log.ai_provider_request_log.request_body,
  );
  const responseBody = SuperAgentsResponseBody.parse(
    log.ai_provider_request_log.response_body,
  );

  const messages = extractMessagesFromRequestData(
    saRequestData as
      | ChatCompletionRequestData
      | StreamChatCompletionRequestData
      | ResponsesRequestData,
  );
  // The extractor infers the task from the conversation when the evaluation
  // params carry none -- and without the system prompt, a conversation the
  // assistant was told to transform (title it, summarize it) reads as a
  // request the assistant was supposed to fulfill.
  const role = extractSystemPromptFromMessages(messages);
  const formatted = formatMessagesForExtraction(messages);
  const input = role
    ? `ASSISTANT ROLE (its system prompt):\n${role}\n\nCONVERSATION:\n${formatted}`
    : formatted;
  const output = extractOutputFromResponseBody(responseBody);

  const { task, outcome } = await extractTaskAndOutcome(
    c,
    params,
    input,
    output,
    connector,
    log.skill_id ? await agentOfSkill(c, connector, log.skill_id) : null,
  );
  return {
    task: params.task || task,
    outcome,
    // A turn that ends in tool calls is mid-task: the verdict should judge
    // whether the work is on track, not whether the task is finished.
    inProgress: responseEndsInToolCalls(responseBody),
  };
}

export async function evaluateLog(
  c: AppContext,
  evaluation: SkillOptimizationEvaluation,
  log: CompletedLog,
  storageConnector: UserDataStorageConnector,
  options?: EvaluateLogOptions,
): Promise<SkillOptimizationEvaluationResult> {
  const start_time = Date.now();

  try {
    const params = TaskCompletionEvaluationParameters.parse(evaluation.params);

    // Resolve model configuration from evaluation.model_id or system settings
    const modelConfig = await resolveEvaluationModelConfig(
      c,
      evaluation,
      storageConnector,
    );

    const llmJudge = createLLMJudge(
      c,
      {
        temperature: params.temperature,
        ...judgeOverrides(params),
      },
      modelConfig ?? undefined,
    );

    const { task, outcome, inProgress } = await getTaskAndOutcome(
      c,
      params,
      log,
      storageConnector,
    );

    // Step 2: Generate verdict
    const { verdict, reason } = await generateVerdict(
      {
        task,
        outcome,
        inProgress,
        humanVerdict: options?.humanVerdict,
        humanVerdictReason: options?.humanVerdictReason,
      },
      llmJudge,
    );
    const verdict_llm_output = JSON.stringify({ verdict, reason });

    const execution_time = Date.now() - start_time;

    const judgeModelName = modelConfig?.model ?? null;
    const judgeModelProvider = modelConfig?.provider ?? null;

    const result: SkillOptimizationEvaluationResult = {
      evaluation_id: evaluation.id,
      method: EvaluationMethodName.TASK_COMPLETION,
      score: verdict,
      extra_data: {
        task,
        outcome,
        strict_mode: params.strict_mode,
        extraction_llm_output: {
          task,
          outcome,
        },
        verdict_llm_output,
        execution_time,
        execution_time_ms: execution_time,
        evaluated_at: new Date().toISOString(),
      },
      display_info: [
        {
          label: 'Task',
          content: task,
        },
        {
          label: 'Outcome',
          content: outcome,
        },
        {
          label: 'Verdict',
          content: `Score: ${verdict}\n\nReason:\n${reason}`,
        },
      ],
      judge_model_name: judgeModelName,
      judge_model_provider: judgeModelProvider,
    };

    return result;
  } catch (err) {
    // Always return a result, even if evaluation fails
    // This ensures arm stats and counters are updated
    const execution_time = Date.now() - start_time;
    const errorMessage = err instanceof Error ? err.message : String(err);

    return {
      evaluation_id: evaluation.id,
      method: EvaluationMethodName.TASK_COMPLETION,
      score: 0.5, // Neutral fallback score
      extra_data: {
        task: '',
        outcome: '',
        strict_mode: false,
        extraction_llm_output: {
          task: '',
          outcome: '',
        },
        verdict_llm_output: JSON.stringify({
          verdict: 0.5,
          reason: `Evaluation failed: ${errorMessage}`,
        }),
        execution_time,
        execution_time_ms: execution_time,
        evaluated_at: new Date().toISOString(),
        error: errorMessage,
        fallback: true,
      },
      display_info: [
        {
          label: 'Error',
          content: `Evaluation failed: ${errorMessage}`,
        },
      ],
      judge_model_name: null,
      judge_model_provider: null,
    };
  }
}
