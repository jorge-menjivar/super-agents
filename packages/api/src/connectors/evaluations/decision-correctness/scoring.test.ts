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
      // 1 - (0.05^2 + 0.1^2 + 0.25^2 + 0.4^2) / 2
      expect(scoreAnswer(scale, answer, '3')).toBeCloseTo(0.88375);
    });

    it('scores the expected level by its distance, without a spread', () => {
      const answer: SystemOneAnswer = { type: 'score', score: 2 };
      expect(scoreAnswer(scale, answer, '2')).toBe(1);
      // A whole scale away is as wrong as it gets.
      expect(scoreAnswer(scale, { type: 'score', score: 0 }, '3')).toBe(0);
      expect(scoreAnswer(scale, answer, '3')).toBeCloseTo(1 - (1 / 3) ** 2);
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
