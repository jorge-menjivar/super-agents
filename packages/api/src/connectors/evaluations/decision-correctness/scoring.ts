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

/**
 * A choice's probabilities when the model sent none: its `confidence` on the
 * option it chose -- certainty when it gave none -- and the rest shared by
 * the other options.
 */
function spreadOf(
  choice: string,
  answer: { confidence?: number },
  options: string[],
): Record<string, number> {
  const sure = clamp(answer.confidence ?? 1);
  const others = options.filter((option) => option !== choice);
  return Object.fromEntries([
    [choice, sure],
    ...others.map((option) => [option, (1 - sure) / others.length]),
  ]);
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

/**
 * One minus the ranked probability score of `probabilities` over `levels`
 * ordered levels, against the right one: the Brier score of the cumulative
 * distribution, which a scale needs where options do not -- a model leaning
 * one level off is nearly right, and scored so, where scoring each level as
 * an unrelated option counted it as wrong as leaning to the far end. A whole
 * level away scores `1 - 1/(levels - 1)`, the far end 0.
 */
function rankedAgreement(
  probabilities: Record<string, number>,
  levels: number,
  right: number,
): number {
  if (levels === 1) {
    return 1;
  }
  let forecast = 0;
  let distance = 0;
  for (let level = 0; level < levels - 1; level++) {
    forecast += probabilities[String(level)] ?? 0;
    const observed = level >= right ? 1 : 0;
    distance += (forecast - observed) ** 2;
  }
  return clamp(1 - distance / (levels - 1));
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
  if (answer.type !== question.type) {
    return null;
  }
  // An option named "unknown" is an answer like any other; anywhere else,
  // it is the judge saying it cannot settle the question.
  const canSettle =
    question.type === 'choice' &&
    choiceLabel(judged, Object.keys(question.criteria)) !== null;
  if (!canSettle && judged.trim().toLowerCase() === UNKNOWN_ANSWER) {
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
      // Without the spread, the model said where it leaned and how sure it
      // was: the rest is taken as shared by the other options alike.
      const probabilities =
        answer.probabilities ?? spreadOf(answer.choice, answer, options);
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
        return rankedAgreement(answer.probabilities, levels, right);
      }
      // Only the expected level: scored as the ranked probability score
      // scores all of it on one level -- by how many levels it is off, on
      // the scale's own length -- so the same answer scores the same with
      // or without the spread.
      if (levels === 1) {
        return 1;
      }
      return clamp(1 - Math.abs(answer.score - right) / (levels - 1));
    }
  }
}
