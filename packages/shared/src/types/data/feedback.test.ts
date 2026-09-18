import {
  FEEDBACK_LOG_IDS_LIMIT,
  Feedback,
  FeedbackCreateParams,
  FeedbackQueryParams,
} from '@shared/types/data/feedback';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock uuid to have predictable values in tests
vi.mock('uuid', () => ({
  v4: vi.fn().mockReturnValue('123e4567-e89b-12d3-a456-426614174000'),
}));

// Freeze the clock so the schemas' generated timestamps are predictable.
// Vitest 5 constructs a mock implementation, so a spy on `Date` returning an
// arrow function is no longer callable with `new`; faking the system time is
// both the supported way to do this and less to keep in sync.
const mockISOString = '2023-01-01T00:00:00.000Z';
vi.useFakeTimers();
vi.setSystemTime(new Date(mockISOString));

describe('Feedback Data Transforms and Validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('FeedbackCreateParams Transform', () => {
    it('should auto-generate id, created_at, and updated_at fields', () => {
      const inputData = {
        log_id: '123e4567-e89b-12d3-a456-426614174002',
        score: 0.8,
        feedback: 'Great response',
      };

      const result = FeedbackCreateParams.parse(inputData);

      expect(result).toEqual({
        ...inputData,
        id: '123e4567-e89b-12d3-a456-426614174000',
        created_at: '2023-01-01T00:00:00.000Z',
        updated_at: '2023-01-01T00:00:00.000Z',
      });
    });

    it('should handle optional feedback field when not provided', () => {
      const inputData = {
        log_id: '123e4567-e89b-12d3-a456-426614174002',
        score: 0.8,
      };

      const result = FeedbackCreateParams.parse(inputData);

      expect(result).toEqual({
        ...inputData,
        id: '123e4567-e89b-12d3-a456-426614174000',
        created_at: '2023-01-01T00:00:00.000Z',
        updated_at: '2023-01-01T00:00:00.000Z',
      });
    });

    it('should prevent users from overriding id field (strict mode)', () => {
      const inputData = {
        log_id: '123e4567-e89b-12d3-a456-426614174002',
        score: 0.8,
        feedback: 'Great response',
        id: 'user-provided-id', // Should be rejected
      };

      expect(() => FeedbackCreateParams.parse(inputData)).toThrow();
    });

    it('should prevent users from overriding created_at field (strict mode)', () => {
      const inputData = {
        log_id: '123e4567-e89b-12d3-a456-426614174002',
        score: 0.8,
        feedback: 'Great response',
        created_at: '2022-01-01T00:00:00.000Z', // Should be rejected
      };

      expect(() => FeedbackCreateParams.parse(inputData)).toThrow();
    });

    it('should prevent users from overriding updated_at field (strict mode)', () => {
      const inputData = {
        log_id: '123e4567-e89b-12d3-a456-426614174002',
        score: 0.8,
        feedback: 'Great response',
        updated_at: '2022-01-01T00:00:00.000Z', // Should be rejected
      };

      expect(() => FeedbackCreateParams.parse(inputData)).toThrow();
    });

    it('should reject objects with additional properties (strict mode)', () => {
      const inputData = {
        log_id: '123e4567-e89b-12d3-a456-426614174002',
        score: 0.8,
        feedback: 'Great response',
        extra_field: 'should be rejected',
      };

      expect(() => FeedbackCreateParams.parse(inputData)).toThrow();
    });

    it('should validate UUIDs for log_id', () => {
      const inputData = {
        log_id: 'invalid-uuid',
        score: 0.8,
        feedback: 'Great response',
      };

      expect(() => FeedbackCreateParams.parse(inputData)).toThrow();
    });

    it('should validate score range (0-1)', () => {
      const invalidScores = [-0.1, 1.1, 2.0, -1.0];

      for (const invalidScore of invalidScores) {
        const inputData = {
          log_id: '123e4567-e89b-12d3-a456-426614174002',
          score: invalidScore,
          feedback: 'Great response',
        };

        expect(() => FeedbackCreateParams.parse(inputData)).toThrow();
      }
    });

    it('should accept valid score values (0-1)', () => {
      const validScores = [0, 0.5, 1, 0.999, 0.001];

      for (const validScore of validScores) {
        const inputData = {
          log_id: '123e4567-e89b-12d3-a456-426614174002',
          score: validScore,
          feedback: 'Great response',
        };

        const result = FeedbackCreateParams.parse(inputData);
        expect(result.score).toBe(validScore);
      }
    });

    it('should require all required fields', () => {
      const incompleteDataTests = [
        {
          // Missing log_id
          score: 0.8,
          feedback: 'Great response',
        },
        {
          // Missing score
          log_id: '123e4567-e89b-12d3-a456-426614174002',
          feedback: 'Great response',
        },
      ];

      for (const incompleteData of incompleteDataTests) {
        expect(() => FeedbackCreateParams.parse(incompleteData)).toThrow();
      }
    });

    it('should handle empty feedback string', () => {
      const inputData = {
        log_id: '123e4567-e89b-12d3-a456-426614174002',
        score: 0.8,
        feedback: '',
      };

      const result = FeedbackCreateParams.parse(inputData);
      expect(result.feedback).toBe('');
    });

    it('should handle long feedback strings', () => {
      const longFeedback = 'A'.repeat(1000);
      const inputData = {
        log_id: '123e4567-e89b-12d3-a456-426614174002',
        score: 0.8,
        feedback: longFeedback,
      };

      const result = FeedbackCreateParams.parse(inputData);
      expect(result.feedback).toBe(longFeedback);
    });

    it('should reject non-string feedback values', () => {
      const nonStringValues = [123, true, null, {}, []];

      for (const nonStringValue of nonStringValues) {
        const inputData = {
          log_id: '123e4567-e89b-12d3-a456-426614174002',
          score: 0.8,
          feedback: nonStringValue,
        };

        expect(() => FeedbackCreateParams.parse(inputData)).toThrow();
      }
    });
  });

  describe('FeedbackQueryParams Validation', () => {
    it('should validate optional id as UUID', () => {
      const validParams = {
        id: '123e4567-e89b-12d3-a456-426614174000',
      };

      const result = FeedbackQueryParams.parse(validParams);
      expect(result.id).toBe(validParams.id);
    });

    /**
     * The ids travel as a URL twice: from the browser, and again as
     * PostgREST's `log_id=in.(...)`. A uuid and its encoded comma is 39
     * characters, so an uncapped list is a request line a proxy refuses --
     * and refusing it here is what makes a caller batch instead.
     */
    it('takes a list of logs up to the cap, and no more', () => {
      const ids = (count: number): string[] =>
        Array.from(
          { length: count },
          (_, i) => `123e4567-e89b-12d3-a456-${String(i).padStart(12, '0')}`,
        );

      const full = ids(FEEDBACK_LOG_IDS_LIMIT);
      expect(FeedbackQueryParams.parse({ log_ids: full }).log_ids).toEqual(
        full,
      );
      // Read back out of the query string the same way.
      expect(
        FeedbackQueryParams.parse({ log_ids: full.join(',') }).log_ids,
      ).toEqual(full);

      expect(() =>
        FeedbackQueryParams.parse({ log_ids: ids(FEEDBACK_LOG_IDS_LIMIT + 1) }),
      ).toThrow();
      // An empty list is every verdict on the deployment, not a filter.
      expect(() => FeedbackQueryParams.parse({ log_ids: [] })).toThrow();
    });

    it('should validate optional log_id as UUID', () => {
      const validParams = {
        log_id: '123e4567-e89b-12d3-a456-426614174003',
      };

      const result = FeedbackQueryParams.parse(validParams);
      expect(result.log_id).toBe(validParams.log_id);
    });

    it('should reject invalid UUID for id', () => {
      const invalidParams = {
        id: 'not-a-uuid',
      };

      expect(() => FeedbackQueryParams.parse(invalidParams)).toThrow();
    });

    it('should reject invalid UUID for log_id', () => {
      const invalidParams = {
        log_id: 'invalid-uuid-format',
      };

      expect(() => FeedbackQueryParams.parse(invalidParams)).toThrow();
    });

    it('should validate limit as positive integer', () => {
      const validParams = {
        limit: 50,
      };

      const result = FeedbackQueryParams.parse(validParams);
      expect(result.limit).toBe(50);
    });

    it('should coerce string numbers to integers for limit', () => {
      const validParams = {
        limit: '25',
      };

      const result = FeedbackQueryParams.parse(validParams);
      expect(result.limit).toBe(25);
    });

    it('should reject negative limit', () => {
      const invalidParams = {
        limit: -10,
      };

      expect(() => FeedbackQueryParams.parse(invalidParams)).toThrow();
    });

    it('should reject zero limit', () => {
      const invalidParams = {
        limit: 0,
      };

      expect(() => FeedbackQueryParams.parse(invalidParams)).toThrow();
    });

    it('should validate offset as non-negative integer', () => {
      const validParams = {
        offset: 20,
      };

      const result = FeedbackQueryParams.parse(validParams);
      expect(result.offset).toBe(20);
    });

    it('should coerce string numbers to integers for offset', () => {
      const validParams = {
        offset: '15',
      };

      const result = FeedbackQueryParams.parse(validParams);
      expect(result.offset).toBe(15);
    });

    it('should allow zero offset', () => {
      const validParams = {
        offset: 0,
      };

      const result = FeedbackQueryParams.parse(validParams);
      expect(result.offset).toBe(0);
    });

    it('should reject negative offset', () => {
      const invalidParams = {
        offset: -5,
      };

      expect(() => FeedbackQueryParams.parse(invalidParams)).toThrow();
    });

    it('should accept empty query params', () => {
      const emptyParams = {};

      const result = FeedbackQueryParams.parse(emptyParams);
      expect(result).toEqual({});
    });

    it('should accept all valid params together', () => {
      const validParams = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        log_id: '123e4567-e89b-12d3-a456-426614174003',
        limit: 25,
        offset: 10,
      };

      const result = FeedbackQueryParams.parse(validParams);
      expect(result).toEqual(validParams);
    });

    it('should reject objects with additional properties (strict mode)', () => {
      const inputData = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        extra_param: 'should be rejected',
      };

      expect(() => FeedbackQueryParams.parse(inputData)).toThrow();
    });

    it('should reject non-integer values for limit and offset', () => {
      const invalidLimitParams = {
        limit: 'not-a-number',
      };

      const invalidOffsetParams = {
        offset: 'not-a-number',
      };

      expect(() => FeedbackQueryParams.parse(invalidLimitParams)).toThrow();
      expect(() => FeedbackQueryParams.parse(invalidOffsetParams)).toThrow();
    });

    it('should reject float values for limit and offset', () => {
      const floatLimitParams = {
        limit: 10.5,
      };

      const floatOffsetParams = {
        offset: 5.7,
      };

      expect(() => FeedbackQueryParams.parse(floatLimitParams)).toThrow();
      expect(() => FeedbackQueryParams.parse(floatOffsetParams)).toThrow();
    });
  });

  describe('FeedbackSchema Validation', () => {
    it('should validate complete feedback object', () => {
      const validFeedback: Feedback = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        log_id: '123e4567-e89b-12d3-a456-426614174002',
        score: 0.8,
        feedback: 'Great response',
        created_at: '2023-01-01T00:00:00.000Z',
        updated_at: '2023-01-01T00:00:00.000Z',
      };

      const result = Feedback.parse(validFeedback);
      expect(result).toEqual(validFeedback);
    });

    it('should validate feedback object without optional feedback field', () => {
      const validFeedback = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        log_id: '123e4567-e89b-12d3-a456-426614174002',
        score: 0.8,
        created_at: '2023-01-01T00:00:00.000Z',
        updated_at: '2023-01-01T00:00:00.000Z',
      };

      const result = Feedback.parse(validFeedback);
      expect(result).toEqual(validFeedback);
    });

    it('should validate datetime strings with timezone offset', () => {
      const validFeedback = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        log_id: '123e4567-e89b-12d3-a456-426614174002',
        score: 0.8,
        feedback: 'Great response',
        created_at: '2023-01-01T00:00:00.000+00:00',
        updated_at: '2023-01-02T12:30:45.123-05:00',
      };

      const result = Feedback.parse(validFeedback);
      expect(result.created_at).toBe('2023-01-01T00:00:00.000+00:00');
      expect(result.updated_at).toBe('2023-01-02T12:30:45.123-05:00');
    });

    it('should reject invalid datetime format', () => {
      const invalidFeedback = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        log_id: '123e4567-e89b-12d3-a456-426614174002',
        score: 0.8,
        feedback: 'Great response',
        created_at: 'invalid-date',
        updated_at: '2023-01-01T00:00:00.000Z',
      };

      expect(() => Feedback.parse(invalidFeedback)).toThrow();
    });

    it('should reject invalid UUID formats', () => {
      const invalidFeedbackTests = [
        {
          id: 'not-a-uuid',
          log_id: '123e4567-e89b-12d3-a456-426614174002',
          score: 0.8,
          feedback: 'Great response',
          created_at: '2023-01-01T00:00:00.000Z',
          updated_at: '2023-01-01T00:00:00.000Z',
        },
        {
          id: '123e4567-e89b-12d3-a456-426614174000',
          log_id: 'invalid-uuid',
          score: 0.8,
          feedback: 'Great response',
          created_at: '2023-01-01T00:00:00.000Z',
          updated_at: '2023-01-01T00:00:00.000Z',
        },
      ];

      for (const invalidFeedback of invalidFeedbackTests) {
        expect(() => Feedback.parse(invalidFeedback)).toThrow();
      }
    });

    it('should reject invalid score values', () => {
      const invalidScores = [-0.1, 1.1, 2.0, -1.0, 'not-a-number'];

      for (const invalidScore of invalidScores) {
        const invalidFeedback = {
          id: '123e4567-e89b-12d3-a456-426614174000',
          log_id: '123e4567-e89b-12d3-a456-426614174002',
          score: invalidScore,
          feedback: 'Great response',
          created_at: '2023-01-01T00:00:00.000Z',
          updated_at: '2023-01-01T00:00:00.000Z',
        };

        expect(() => Feedback.parse(invalidFeedback)).toThrow();
      }
    });

    it('should require all required fields', () => {
      const requiredFields = [
        'id',
        'log_id',
        'score',
        'created_at',
        'updated_at',
      ];

      for (const missingField of requiredFields) {
        const incompleteFeedback = {
          id: '123e4567-e89b-12d3-a456-426614174000',
          log_id: '123e4567-e89b-12d3-a456-426614174002',
          score: 0.8,
          feedback: 'Great response',
          created_at: '2023-01-01T00:00:00.000Z',
          updated_at: '2023-01-01T00:00:00.000Z',
        };

        // Remove the field to test validation
        if (missingField in incompleteFeedback) {
          delete incompleteFeedback[
            missingField as keyof typeof incompleteFeedback
          ];
        }

        expect(() => Feedback.parse(incompleteFeedback)).toThrow();
      }
    });

    it('should reject objects with additional properties (strict mode)', () => {
      const invalidFeedback = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        log_id: '123e4567-e89b-12d3-a456-426614174002',
        score: 0.8,
        feedback: 'Great response',
        created_at: '2023-01-01T00:00:00.000Z',
        updated_at: '2023-01-01T00:00:00.000Z',
        extra_field: 'should be rejected',
      };

      expect(() => Feedback.parse(invalidFeedback)).toThrow();
    });

    it('should accept edge case valid values', () => {
      const edgeCaseFeedback = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        log_id: '123e4567-e89b-12d3-a456-426614174002',
        score: 0, // Minimum valid score
        feedback: '', // Empty string
        created_at: '2023-01-01T00:00:00.000Z',
        updated_at: '2023-01-01T00:00:00.000Z',
      };

      const result = Feedback.parse(edgeCaseFeedback);
      expect(result).toEqual(edgeCaseFeedback);
    });

    it('should accept maximum valid score', () => {
      const maxScoreFeedback = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        log_id: '123e4567-e89b-12d3-a456-426614174002',
        score: 1, // Maximum valid score
        feedback: 'Perfect score',
        created_at: '2023-01-01T00:00:00.000Z',
        updated_at: '2023-01-01T00:00:00.000Z',
      };

      const result = Feedback.parse(maxScoreFeedback);
      expect(result).toEqual(maxScoreFeedback);
    });
  });
});
