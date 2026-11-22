import { scoreAnswer } from '@api/connectors/evaluations/decision-correctness/scoring';
import type {
  SystemOneAnswer,
  SystemOneQuestion,
} from '@shared/types/api/routes/system-one-api';
import { describe, expect, it } from 'vitest';

const noul: SystemOneQuestion = { type: 'noul', instructions: 'Withhold it?' };
const choice: SystemOneQuestion = {
  type: 'choice',
  instructions: 'What is it about?',
  criteria: { refund: 'Money back', shipping: null, other: null },
};
const scale: SystemOneQuestion = {
  type: 'score',
  instructions: 'How urgent is it?',
  criteria: ['Not at all', 'Somewhat', 'Very', 'Drop everything'],
};

const yes = (p: number): SystemOneAnswer => ({ type: 'noul', noul: p });

describe('scoreAnswer', () => {
  describe('a yes-or-no question', () => {
    // 1 - (p - y)^2: every bit of probability on the right answer is 1,
    // all of it on the wrong one is 0.
    it('scores the probability against the right answer', () => {
      expect(scoreAnswer(noul, yes(0.9), 'true')).toBeCloseTo(0.99);
      expect(scoreAnswer(noul, yes(0.9), 'false')).toBeCloseTo(0.19);
      expect(scoreAnswer(noul, yes(1), 'true')).toBe(1);
      expect(scoreAnswer(noul, yes(0), 'true')).toBe(0);
    });

    // A proper score: unsure beats confidently wrong.
    it('scores an unsure answer above a confidently wrong one', () => {
      expect(scoreAnswer(noul, yes(0.5), 'false')).toBeGreaterThan(
        scoreAnswer(noul, yes(0.95), 'false') ?? 1,
      );
    });

    it('reads yes and no as true and false, in any case', () => {
      expect(scoreAnswer(noul, yes(0.8), 'Yes')).toBeCloseTo(0.96);
      expect(scoreAnswer(noul, yes(0.8), ' NO ')).toBeCloseTo(0.36);
    });
  });

  describe('a question with options', () => {
    it('scores the whole spread against the right option', () => {
      const answer: SystemOneAnswer = {
        type: 'choice',
        choice: 'refund',
        probabilities: { refund: 0.7, shipping: 0.2, other: 0.1 },
      };
      // 1 - ((0.3)^2 + 0.2^2 + 0.1^2) / 2
      expect(scoreAnswer(choice, answer, 'refund')).toBeCloseTo(0.93);
      // 1 - (0.7^2 + 0.8^2 + 0.1^2) / 2
      expect(scoreAnswer(choice, answer, 'shipping')).toBeCloseTo(0.43);
    });

    // Without the spread, its confidence is how sure it was; the rest is
    // taken as shared by the other options.
    it('scores the confidence of a choice that gave no spread', () => {
      const answer: SystemOneAnswer = {
        type: 'choice',
        choice: 'refund',
        confidence: 0.55,
      };
      // refund 0.55, shipping and other 0.225 each, against shipping:
      // 1 - (0.55^2 + 0.775^2 + 0.225^2) / 2
      expect(scoreAnswer(choice, answer, 'shipping')).toBeCloseTo(0.5235);
    });

    // A confidence of 0.1 on the option chosen left 0.45 on each of the
    // others, and a right choice scored 0.39 where a wrong one scored 0.74.
    // It was the model's choice: at least as likely as any other option.
    it('never scores a right choice below a wrong one', () => {
      const answer: SystemOneAnswer = {
        type: 'choice',
        choice: 'refund',
        confidence: 0.1,
      };
      const right = scoreAnswer(choice, answer, 'refund') ?? 0;
      const wrong = scoreAnswer(choice, answer, 'shipping') ?? 1;

      // Within rounding: an even share on all three scores the two alike.
      expect(right).toBeGreaterThanOrEqual(wrong - 1e-9);
      // 1 - ((2/3)^2 + 2 * (1/3)^2) / 2
      expect(right).toBeCloseTo(2 / 3);
    });

    // A judge not held to its schema answers a yes-or-no choice as a
    // boolean, which reached the scorer as "true" and matched no option.
    it("reads a true or false judgment as the question's yes or no", () => {
      const yesNo: SystemOneQuestion = {
        type: 'choice',
        criteria: { Yes: null, No: null },
      };
      const answer: SystemOneAnswer = {
        type: 'choice',
        choice: 'Yes',
        probabilities: { Yes: 0.8, No: 0.2 },
      };

      // 1 - (0.2^2 + 0.2^2) / 2
      expect(scoreAnswer(yesNo, answer, 'true')).toBeCloseTo(0.96);
      // 1 - (0.8^2 + 0.8^2) / 2
      expect(scoreAnswer(yesNo, answer, ' FALSE ')).toBeCloseTo(0.36);
      // Without a yes or a no to name, it names nothing.
      expect(scoreAnswer(choice, answer, 'true')).toBeNull();
    });

    it('matches an option named "true" as itself', () => {
      const literal: SystemOneQuestion = {
        type: 'choice',
        criteria: { true: null, false: null, yes: null },
      };
      const answer: SystemOneAnswer = { type: 'choice', choice: 'true' };

      expect(scoreAnswer(literal, answer, 'true')).toBe(1);
    });

    it('scores an option named "unknown" like any other', () => {
      const unsure: SystemOneQuestion = {
        type: 'choice',
        criteria: { yes: null, no: null, unknown: null },
      };
      const answer: SystemOneAnswer = {
        type: 'choice',
        choice: 'unknown',
        probabilities: { yes: 0.05, no: 0.05, unknown: 0.9 },
      };
      expect(scoreAnswer(unsure, answer, 'unknown')).toBeCloseTo(0.9925);
    });

    it('scores where the model leaned when it gave no spread', () => {
      const answer: SystemOneAnswer = { type: 'choice', choice: 'refund' };
      expect(scoreAnswer(choice, answer, 'refund')).toBe(1);
      expect(scoreAnswer(choice, answer, 'other')).toBe(0);
    });

    it("matches the judge's option to the question's own label", () => {
      const answer: SystemOneAnswer = { type: 'choice', choice: 'refund' };
      expect(scoreAnswer(choice, answer, 'Refund')).toBe(1);
      expect(scoreAnswer(choice, answer, 'returns')).toBeNull();
    });
  });

  describe('a question on a scale', () => {
    it('scores the spread over the levels against the right one', () => {
      const answer: SystemOneAnswer = {
        type: 'score',
        score: 2.4,
        probabilities: { '0': 0.05, '1': 0.1, '2': 0.25, '3': 0.6 },
      };
      // Cumulative 0.05, 0.15, 0.4 against 0, 0, 0:
      // 1 - (0.05^2 + 0.15^2 + 0.4^2) / 3
      expect(scoreAnswer(scale, answer, '3')).toBeCloseTo(0.938333);
    });

    // A scale is ordered: one level off is nearly right, the far end wrong.
    it('scores a near miss above a far one', () => {
      const five: SystemOneQuestion = {
        type: 'score',
        criteria: ['0', '1', '2', '3', '4'],
      };
      const sureOf = (level: number): SystemOneAnswer => ({
        type: 'score',
        score: level,
        probabilities: { [String(level)]: 1 },
      });

      expect(scoreAnswer(five, sureOf(3), '3')).toBe(1);
      expect(scoreAnswer(five, sureOf(2), '3')).toBeCloseTo(0.75);
      expect(scoreAnswer(five, sureOf(0), '3')).toBeCloseTo(0.25);
    });

    // The same answer scores the same whether the vendor sent the spread or
    // only the expected level -- Jev and Drex do not always send both.
    it('scores an answer alike with or without its spread', () => {
      const five: SystemOneQuestion = {
        type: 'score',
        criteria: ['0', '1', '2', '3', '4'],
      };
      expect(scoreAnswer(five, { type: 'score', score: 2 }, '3')).toBeCloseTo(
        scoreAnswer(
          five,
          { type: 'score', score: 2, probabilities: { '2': 1 } },
          '3',
        ) ?? 0,
      );
    });

    // Missing mass was read as sitting on the top level, so a spread that
    // put nothing on the scale's levels was scored as certain of the top --
    // a perfect score whenever the top was right.
    it('reads only the levels of a spread, made to sum to one', () => {
      const answer: SystemOneAnswer = {
        type: 'score',
        score: 2.2,
        probabilities: { '0': 0.1, '1': 0.1, '2': 0.1, '3': 0.2 },
      };
      // As 0.2, 0.2, 0.2, 0.4: cumulative 0.2, 0.4, 0.6 against 0, 0, 0:
      // 1 - (0.2^2 + 0.4^2 + 0.6^2) / 3
      expect(scoreAnswer(scale, answer, '3')).toBeCloseTo(1 - 0.56 / 3);
    });

    it('scores the expected level when the spread has nothing on the levels', () => {
      const empty: SystemOneAnswer = {
        type: 'score',
        score: 0,
        probabilities: {},
      };
      const legend: SystemOneAnswer = {
        type: 'score',
        score: 0,
        probabilities: { 'Not at all': 1 },
      };

      // The expected level, 0, is the whole scale away from 3.
      expect(scoreAnswer(scale, empty, '3')).toBe(0);
      expect(scoreAnswer(scale, legend, '3')).toBe(0);
      expect(scoreAnswer(scale, legend, '0')).toBe(1);
    });

    it('scores the expected level by its distance, without a spread', () => {
      const answer: SystemOneAnswer = { type: 'score', score: 2 };
      expect(scoreAnswer(scale, answer, '2')).toBe(1);
      // A whole scale away is as wrong as it gets.
      expect(scoreAnswer(scale, { type: 'score', score: 0 }, '3')).toBe(0);
      expect(scoreAnswer(scale, answer, '3')).toBeCloseTo(1 - 1 / 3);
    });

    it('refuses a level the scale does not have', () => {
      const answer: SystemOneAnswer = { type: 'score', score: 2 };
      expect(scoreAnswer(scale, answer, '4')).toBeNull();
      expect(scoreAnswer(scale, answer, 'very')).toBeNull();
    });
  });

  it('scores nothing the judge could not settle', () => {
    expect(scoreAnswer(noul, yes(0.9), 'unknown')).toBeNull();
    expect(scoreAnswer(noul, yes(0.9), 'maybe')).toBeNull();
  });

  it('scores nothing when the answer is not of the question type', () => {
    expect(scoreAnswer(choice, yes(0.9), 'refund')).toBeNull();
  });
});
