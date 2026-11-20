import {
  type SystemOneAnswer,
  type SystemOneQuestion,
  SystemOneRequestBody,
  SystemOneResponseBody,
} from '@shared/types/api/routes/system-one-api';
import type { CompletedLog } from '@shared/types/data/log';
import { systemOneStateText } from '@shared/utils/system-one';

/**
 * A decision model's log, as text for the models that read one: the judge
 * deciding what the right answers were, and the prompt writers learning from
 * the answers a policy got.
 *
 * Both read the request the caller sent (`log.request_body`), not the one
 * the provider was sent: that one has the skill's policy folded into every
 * question, and a policy writer shown it would read its own policy back as
 * part of the question, and a judge would be shown the very thing it is
 * meant to judge without.
 */

export interface DecisionExchange {
  request: SystemOneRequestBody;
  /** Null when the provider's answer is missing or could not be read. */
  response: SystemOneResponseBody | null;
}

/** The decision a log records, or null when it is not one it can read. */
export function decisionExchangeOf(
  log: Pick<CompletedLog, 'request_body' | 'ai_provider_request_log'>,
): DecisionExchange | null {
  const request = SystemOneRequestBody.safeParse(log.request_body);
  if (!request.success) {
    return null;
  }
  const response = SystemOneResponseBody.safeParse(
    log.ai_provider_request_log?.response_body,
  );
  return {
    request: request.data,
    response: response.success ? response.data : null,
  };
}

/** Guidance as it is written: text as it came, anything else as JSON. */
function guidanceText(guidance: unknown): string | null {
  if (guidance === undefined || guidance === null || guidance === '') {
    return null;
  }
  return typeof guidance === 'string' ? guidance : JSON.stringify(guidance);
}

const KIND: Record<SystemOneQuestion['type'], string> = {
  noul: 'yes or no',
  choice: 'one of several options',
  score: 'a level on a scale',
};

function describeQuestion(id: string, question: SystemOneQuestion): string {
  const lines = [`### ${id} (${KIND[question.type]})`];
  const instructions = guidanceText(question.instructions);
  if (instructions) {
    lines.push(`Instructions: ${instructions}`);
  }
  switch (question.type) {
    case 'noul': {
      const yes = guidanceText(question.criteria?.true);
      const no = guidanceText(question.criteria?.false);
      if (yes) {
        lines.push(`Yes means: ${yes}`);
      }
      if (no) {
        lines.push(`No means: ${no}`);
      }
      break;
    }
    case 'choice':
      lines.push('Options:');
      for (const [label, description] of Object.entries(question.criteria)) {
        const text = guidanceText(description);
        lines.push(text ? `- ${label}: ${text}` : `- ${label}`);
      }
      break;
    case 'score':
      lines.push('Levels, lowest first:');
      question.criteria.forEach((description, level) => {
        lines.push(
          `- ${level}: ${guidanceText(description) ?? `Level ${level}`}`,
        );
      });
      break;
  }
  return lines.join('\n');
}

/**
 * The material and the questions about it: what a decision model was asked,
 * and all a judge needs to answer the same questions itself. Images are named
 * but not shown -- the readers of this text read text.
 */
export function describeDecisionRequest(request: SystemOneRequestBody): string {
  const sections = [
    `## State\n${systemOneStateText(request.state) ?? '(empty)'}`,
  ];
  const images = Object.keys(request.assets ?? {});
  if (images.length > 0) {
    sections.push(
      `## Images\nThe request showed the model ${images.length === 1 ? 'an image' : `${images.length} images`}, referred to in the text as ${images.join(', ')}. ${images.length === 1 ? 'It is' : 'They are'} not shown here.`,
    );
  }
  sections.push(
    `## Questions\n${Object.entries(request.questions)
      .map(([id, question]) => describeQuestion(id, question))
      .join('\n\n')}`,
  );
  return sections.join('\n\n');
}

const percent = (probability: number) => probability.toFixed(2);

/** One answer as a line: what the model leaned toward, and how far. */
export function describeAnswer(
  question: SystemOneQuestion | undefined,
  answer: SystemOneAnswer,
): string {
  switch (answer.type) {
    case 'noul':
      return `P(yes) = ${percent(answer.noul)}`;
    case 'choice': {
      const spread = Object.entries(answer.probabilities ?? {})
        .map(([label, p]) => `${label} ${percent(p)}`)
        .join(', ');
      return spread ? `${answer.choice} (${spread})` : answer.choice;
    }
    case 'score': {
      const levels =
        question?.type === 'score' ? question.criteria.length : undefined;
      const spread = Object.entries(answer.probabilities ?? {})
        .map(([level, p]) => `${level}: ${percent(p)}`)
        .join(', ');
      const scale = levels ? ` on 0-${levels - 1}` : '';
      return `expected level ${answer.score.toFixed(2)}${scale}${spread ? ` (${spread})` : ''}`;
    }
  }
}

/** The model's answers, one line per question, in the questions' order. */
export function describeDecisionAnswers(exchange: DecisionExchange): string {
  const answers = exchange.response?.answers ?? {};
  const lines = Object.keys(exchange.request.questions).map((id) => {
    const answer = answers[id];
    return answer
      ? `- ${id}: ${describeAnswer(exchange.request.questions[id], answer)}`
      : `- ${id}: (no answer)`;
  });
  return `## Answers\n${lines.join('\n')}`;
}

/** A decision log in full: what was asked, and what the model answered. */
export function describeDecisionLog(exchange: DecisionExchange): string {
  return `${describeDecisionRequest(exchange.request)}\n\n${describeDecisionAnswers(exchange)}`;
}
