import { scoreAnswer } from '@api/connectors/evaluations/decision-correctness/scoring';
import { decisionJudgePrompt } from '@api/connectors/evaluations/decision-correctness/templates';
import {
  DecisionCorrectnessEvaluationParameters,
  DecisionJudgment,
} from '@api/connectors/evaluations/decision-correctness/types';
import { judgeOverrides } from '@api/connectors/evaluations/judge-overrides';
import { humanVerdictNote } from '@api/evaluations/human-verdict';
import { createLLMJudge } from '@api/evaluations/llm-judge';
import type {
  EvaluateLogOptions,
  UserDataStorageConnector,
} from '@api/types/connector';
import type { AppContext } from '@api/types/hono';
import { resolveEvaluationModelConfig } from '@api/utils/evaluation-model-resolver';
import {
  decisionExchangeOf,
  describeAnswer,
  describeDecisionAnswers,
  describeDecisionRequest,
} from '@api/utils/super-agents/decision-logs';
import { warn } from '@shared/console-logging';
import type {
  SkillOptimizationEvaluation,
  SkillOptimizationEvaluationResult,
} from '@shared/types/data';
import type { CompletedLog } from '@shared/types/data/log';
import { EvaluationMethodName } from '@shared/types/evaluations';

/**
 * Decision correctness: how much of its probability a decision model put on
 * the right answers.
 *
 * A judge -- an LLM, the skill's usual one -- answers the questions the model
 * was asked, from the same material, without being shown the model's answers
 * or the policy the skill asked them under: what it is asked is what the
 * caller asked. Its answers are the reference, and each of the model's is
 * scored against it with the Brier score (see `scoring.ts`); the log's score
 * is their mean. A human's thumbs up or down on the log re-runs this with the
 * model's answers and the verdict in front of the judge, which is how a person
 * corrects a reference they disagree with.
 *
 * What it cannot judge -- a log it cannot read, a judge that could not be
 * asked, questions the judge could not settle -- scores a neutral 0.5 and
 * says why, as every method does: a result left out would count as a zero
 * against the arm that served it.
 */

interface Context {
  agentDescription: string | null;
  skillDescription: string | null;
}

/** What the agent and skill say they are for, where they can be read. */
async function contextOf(
  c: AppContext,
  storageConnector: UserDataStorageConnector,
  evaluation: SkillOptimizationEvaluation,
): Promise<Context> {
  try {
    const [skills, agents] = await Promise.all([
      storageConnector.getSkills(c, { id: evaluation.skill_id }),
      storageConnector.getAgents(c, { id: evaluation.agent_id }),
    ]);
    return {
      agentDescription: agents[0]?.description || null,
      skillDescription: skills[0]?.description || null,
    };
  } catch (e) {
    warn('[DECISION_CORRECTNESS] Judging without the skill context:', e);
    return { agentDescription: null, skillDescription: null };
  }
}

interface JudgedQuestion {
  question_id: string;
  answer: string;
  reasoning: string;
  /** Null when there was nothing to compare: see `scoreAnswer`. */
  score: number | null;
}

export async function evaluateLog(
  c: AppContext,
  evaluation: SkillOptimizationEvaluation,
  log: CompletedLog,
  storageConnector: UserDataStorageConnector,
  options?: EvaluateLogOptions,
): Promise<SkillOptimizationEvaluationResult> {
  const start_time = Date.now();
  const params = DecisionCorrectnessEvaluationParameters.parse(
    evaluation.params,
  );

  const neutral = (
    reason: string,
    extra: Record<string, unknown> = {},
    judge: { model: string | null; provider: string | null } = {
      model: null,
      provider: null,
    },
  ): SkillOptimizationEvaluationResult => {
    const execution_time = Date.now() - start_time;
    return {
      evaluation_id: evaluation.id,
      method: EvaluationMethodName.DECISION_CORRECTNESS,
      score: 0.5,
      extra_data: {
        fallback: true,
        error: reason,
        ...extra,
        execution_time,
        execution_time_ms: execution_time,
        evaluated_at: new Date().toISOString(),
      },
      display_info: [{ label: 'Not judged', content: reason }],
      judge_model_name: judge.model,
      judge_model_provider: judge.provider,
    };
  };

  const exchange = decisionExchangeOf(log);
  if (!exchange) {
    return neutral('The log is not a System One request this method can read');
  }
  if (!exchange.response) {
    return neutral('The log has no answers from the model to judge');
  }
  const { request, response } = exchange;

  const [modelConfig, context] = await Promise.all([
    resolveEvaluationModelConfig(c, evaluation, storageConnector),
    contextOf(c, storageConnector, evaluation),
  ]);
  const judgeModel = {
    model: modelConfig?.model ?? null,
    provider: modelConfig?.provider ?? null,
  };

  const llmJudge = createLLMJudge(
    c,
    { temperature: params.temperature, ...judgeOverrides(params) },
    modelConfig ?? undefined,
  );

  const reviewed = options?.humanVerdict
    ? {
        reviewedAnswers: describeDecisionAnswers(exchange),
        humanVerdictNote: humanVerdictNote(
          options.humanVerdict,
          options.humanVerdictReason,
        ),
      }
    : {};
  const judgment = await llmJudge.answer(
    decisionJudgePrompt({
      ...context,
      guidance: params.guidance,
      request: describeDecisionRequest(request),
      ...reviewed,
    }),
    { name: 'decision_judgment', schema: DecisionJudgment },
  );
  if (!judgment.ok) {
    return neutral(
      judgment.fallback.reasoning,
      { metadata: judgment.fallback.metadata },
      judgeModel,
    );
  }

  const judgedById = new Map(
    judgment.value.answers.map((judged) => [judged.question_id, judged]),
  );
  const judged: JudgedQuestion[] = Object.entries(request.questions).map(
    ([id, question]) => {
      const reference = judgedById.get(id);
      const answer = response.answers[id];
      return {
        question_id: id,
        answer: reference ? String(reference.answer) : '',
        reasoning: reference?.reasoning ?? 'The judge did not answer it.',
        score:
          reference && answer
            ? scoreAnswer(question, answer, String(reference.answer))
            : null,
      };
    },
  );

  const scored = judged.filter(
    (question): question is JudgedQuestion & { score: number } =>
      question.score !== null,
  );
  if (scored.length === 0) {
    return neutral(
      'The judge could not settle any of the questions from what it was shown',
      { judged },
      judgeModel,
    );
  }
  const score =
    scored.reduce((total, question) => total + question.score, 0) /
    scored.length;

  const execution_time = Date.now() - start_time;
  return {
    evaluation_id: evaluation.id,
    method: EvaluationMethodName.DECISION_CORRECTNESS,
    score,
    extra_data: {
      judged,
      guidance: params.guidance,
      ...(options?.humanVerdict ? { human_verdict: options.humanVerdict } : {}),
      execution_time,
      execution_time_ms: execution_time,
      evaluated_at: new Date().toISOString(),
    },
    display_info: judged.map((question) => {
      const asked = request.questions[question.question_id];
      const answer = response.answers[question.question_id];
      const modelSaid = answer
        ? describeAnswer(asked, answer)
        : 'no answer from the model';
      const verdict =
        question.score === null
          ? 'not scored'
          : `agreement ${question.score.toFixed(2)}`;
      return {
        label: question.question_id,
        content: `Right answer: ${question.answer || '(none given)'}. The model: ${modelSaid}. ${verdict}.\n\n${question.reasoning}`,
      };
    }),
    judge_model_name: judgeModel.model,
    judge_model_provider: judgeModel.provider,
  };
}
