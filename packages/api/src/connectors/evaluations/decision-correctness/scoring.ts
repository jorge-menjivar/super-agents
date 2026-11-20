import type {
  SystemOneAnswer,
  SystemOneQuestion,
} from '@shared/types/api/routes/system-one-api';

/**
 * How well a decision model's answer agrees with the right one.
 *
 * A decision model answers with probabilities, so it is scored on the
 * probabilities and not only on where it leaned: with the Brier score, a
 * proper scoring rule, turned into an agreement between 0 and 1 -- one for
 * every bit of probability on the right answer, zero for all of it on a wrong
 * one. Being proper is the point: a model is scored best for saying how sure
 * it actually is, so a policy that makes it confidently wrong scores worse
 * than one that leaves it unsure, and one that makes it rightly sure scores
 * best of all.
 */

/** What the judge may say when the material shown to it cannot settle a question. */
export const UNKNOWN_ANSWER = 'unknown';

const clamp = (value: number) => Math.min(1, Math.max(0, value));

/**
 * One minus half the Brier score of `probabilities` against `right` over
 * `outcomes`. Half, because a distribution's squared distance from a certain
 * outcome is at most two.
 */
function brierAgreement(
  probabilities: Record<string, number>,
  outcomes: string[],
  right: string,
): number {
  let distance = 0;
  for (const outcome of outcomes) {
    const p = probabilities[outcome] ?? 0;
    const y = outcome === right ? 1 : 0;
    distance += (p - y) ** 2;
  }
  return clamp(1 - distance / 2);
}

/** The judge's answer to a yes-or-no question, as `true` or `false`. */
function noulLabel(answer: string): boolean | null {
  const said = answer.trim().toLowerCase();
  if (said === 'true' || said === 'yes') {
    return true;
  }
  if (said === 'false' || said === 'no') {
    return false;
  }
  return null;
}

/** The option the judge named, matched to the question's own label. */
function choiceLabel(answer: string, options: string[]): string | null {
  const said = answer.trim();
  return (
    options.find((option) => option === said) ??
    options.find((option) => option.toLowerCase() === said.toLowerCase()) ??
    null
  );
}

/** The level the judge named, when it is one the scale has. */
function scoreLevel(answer: string, levels: number): number | null {
  const said = answer.trim();
  if (!/^\d+$/.test(said)) {
    return null;
  }
  const level = Number(said);
  return level < levels ? level : null;
}

/**
 * How well `answer` agrees with the judge's answer to `question`, between 0
 * and 1; or null when there is nothing to compare -- the judge could not say,
 * named something the question does not have, or the model's answer is of
 * another type.
 */
export function scoreAnswer(
  question: SystemOneQuestion,
  answer: SystemOneAnswer,
  judged: string,
): number | null {
  if (
    answer.type !== question.type ||
    judged.trim().toLowerCase() === UNKNOWN_ANSWER
  ) {
    return null;
  }
  switch (answer.type) {
    case 'noul': {
      const right = noulLabel(judged);
      if (right === null) {
        return null;
      }
      const p = clamp(answer.noul);
      return brierAgreement(
        { true: p, false: 1 - p },
        ['true', 'false'],
        String(right),
      );
    }
    case 'choice': {
      if (question.type !== 'choice') {
        return null;
      }
      const options = Object.keys(question.criteria);
      const right = choiceLabel(judged, options);
      if (right === null) {
        return null;
      }
      // Without the spread, all the model said is where it leaned.
      const probabilities = answer.probabilities ?? { [answer.choice]: 1 };
      return brierAgreement(probabilities, options, right);
    }
    case 'score': {
      if (question.type !== 'score') {
        return null;
      }
      const levels = question.criteria.length;
      const right = scoreLevel(judged, levels);
      if (right === null) {
        return null;
      }
      if (answer.probabilities) {
        const outcomes = Array.from({ length: levels }, (_, level) =>
          String(level),
        );
        return brierAgreement(answer.probabilities, outcomes, String(right));
      }
      // Only the expected level: scored by how far it is from the right
      // one, on the scale's own length.
      if (levels === 1) {
        return 1;
      }
      return clamp(1 - ((answer.score - right) / (levels - 1)) ** 2);
    }
  }
}
