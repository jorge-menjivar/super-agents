import {
  Model,
  ModelCreateParams,
  ModelQueryParams,
  ModelUpdateParams,
} from '@shared/types/data/model';
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

describe('Model Data Transforms and Validation', () => {
  const testApiKeyId = '550e8400-e29b-41d4-a716-446655440000';
  const testModelId = '123e4567-e89b-12d3-a456-426614174000';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('ModelCreateParams Transform', () => {
    it('should validate required fields', () => {
      const inputData = {
        ai_provider_id: testApiKeyId,
        model_name: 'gpt-4',
      };

      const result = ModelCreateParams.parse(inputData);

      expect(result.ai_provider_id).toBe(testApiKeyId);
      expect(result.model_name).toBe('gpt-4');
    });

    it('should reject empty model name', () => {
      const inputData = {
        ai_provider_id: testApiKeyId,
        model_name: '',
      };

      expect(() => ModelCreateParams.parse(inputData)).toThrow();
    });

    it('should accept a decision model, which has no embedding dimensions', () => {
      expect(
        ModelCreateParams.parse({
          ai_provider_id: testApiKeyId,
          model_name: 'jev-latest',
          model_type: 'decision',
        }),
      ).toMatchObject({ model_type: 'decision' });
      expect(() =>
        ModelCreateParams.parse({
          ai_provider_id: testApiKeyId,
          model_name: 'jev-latest',
          model_type: 'decision',
          embedding_dimensions: 768,
        }),
      ).toThrow();
    });

    it('should reject invalid UUID for ai_provider_id', () => {
      const inputData = {
        ai_provider_id: 'invalid-uuid',
        model_name: 'gpt-4',
      };

      expect(() => ModelCreateParams.parse(inputData)).toThrow();
    });

    it('should reject missing ai_provider_id', () => {
      const inputData = {
        model_name: 'gpt-4',
      };

      expect(() => ModelCreateParams.parse(inputData)).toThrow();
    });

    it('should reject missing model_name', () => {
      const inputData = {
        ai_provider_id: testApiKeyId,
      };

      expect(() => ModelCreateParams.parse(inputData)).toThrow();
    });

    it('should prevent users from overriding id field (strict mode)', () => {
      const inputData = {
        ai_provider_id: testApiKeyId,
        model_name: 'gpt-4',
        id: testModelId,
      };

      expect(() => ModelCreateParams.parse(inputData)).toThrow();
    });

    it('should prevent users from overriding created_at field (strict mode)', () => {
      const inputData = {
        ai_provider_id: testApiKeyId,
        model_name: 'gpt-4',
        created_at: '2023-01-01T00:00:00.000Z',
      };

      expect(() => ModelCreateParams.parse(inputData)).toThrow();
    });

    it('should prevent users from overriding updated_at field (strict mode)', () => {
      const inputData = {
        ai_provider_id: testApiKeyId,
        model_name: 'gpt-4',
        updated_at: '2023-01-01T00:00:00.000Z',
      };

      expect(() => ModelCreateParams.parse(inputData)).toThrow();
    });

    it('should reject objects with additional properties (strict mode)', () => {
      const inputData = {
        ai_provider_id: testApiKeyId,
        model_name: 'gpt-4',
        extraField: 'should be rejected',
      };

      expect(() => ModelCreateParams.parse(inputData)).toThrow();
    });

    it('should handle various model names', () => {
      const modelNames = [
        'gpt-4',
        'gpt-3.5-turbo',
        'claude-3-opus-20240229',
        'gemini-pro',
        'llama-2-70b-chat',
      ];

      for (const modelName of modelNames) {
        const inputData = {
          ai_provider_id: testApiKeyId,
          model_name: modelName,
        };

        const result = ModelCreateParams.parse(inputData);
        expect(result.model_name).toBe(modelName);
      }
    });
  });

  describe('ModelUpdateParams Transform', () => {
    it('should accept updates with model_name', () => {
      const inputData = {
        model_name: 'gpt-4-turbo',
      };

      const result = ModelUpdateParams.parse(inputData);

      expect(result.model_name).toBe('gpt-4-turbo');
    });

    it('should reject empty model_name', () => {
      const inputData = {
        model_name: '',
      };

      expect(() => ModelUpdateParams.parse(inputData)).toThrow();
    });

    it('should reject objects with no update fields', () => {
      const inputData = {};

      expect(() => ModelUpdateParams.parse(inputData)).toThrow(
        'At least one field must be provided for update',
      );
    });

    it('should not allow extra parameters', () => {
      const inputData = {
        model_name: 'gpt-4',
        id: testModelId,
      };

      expect(() => ModelUpdateParams.parse(inputData)).toThrow(
        `\
[
  {
    "code": "unrecognized_keys",
    "keys": [
      "id"
    ],
    "path": [],
    "message": "Unrecognized key: \\"id\\""
  }
]`,
      );
    });

    it('should not allow ai_provider_id updates', () => {
      const inputData = {
        model_name: 'gpt-4',
        ai_provider_id: testApiKeyId,
      };

      expect(() => ModelUpdateParams.parse(inputData)).toThrow();
    });

    it('should not allow created_at updates', () => {
      const inputData = {
        model_name: 'gpt-4',
        created_at: '2023-01-01T00:00:00.000Z',
      };

      expect(() => ModelUpdateParams.parse(inputData)).toThrow();
    });

    it('should not allow updated_at updates', () => {
      const inputData = {
        model_name: 'gpt-4',
        updated_at: '2023-01-01T00:00:00.000Z',
      };

      expect(() => ModelUpdateParams.parse(inputData)).toThrow();
    });

    describe('model_type and embedding_dimensions validation', () => {
      it('should accept model_type embed with embedding_dimensions', () => {
        const inputData = {
          model_type: 'embed',
          embedding_dimensions: 1536,
        };

        const result = ModelUpdateParams.parse(inputData);

        expect(result.model_type).toBe('embed');
        expect(result.embedding_dimensions).toBe(1536);
      });

      it('should reject model_type embed without embedding_dimensions', () => {
        const inputData = {
          model_type: 'embed',
        };

        expect(() => ModelUpdateParams.parse(inputData)).toThrow(
          'embedding_dimensions is required when changing model_type to embed',
        );
      });

      it('should reject model_type embed with null embedding_dimensions', () => {
        const inputData = {
          model_type: 'embed',
          embedding_dimensions: null,
        };

        expect(() => ModelUpdateParams.parse(inputData)).toThrow(
          'embedding_dimensions is required when changing model_type to embed',
        );
      });

      it('should accept model_type text without embedding_dimensions', () => {
        const inputData = {
          model_type: 'text',
        };

        const result = ModelUpdateParams.parse(inputData);

        expect(result.model_type).toBe('text');
      });

      it('should accept model_type text with null embedding_dimensions', () => {
        const inputData = {
          model_type: 'text',
          embedding_dimensions: null,
        };

        const result = ModelUpdateParams.parse(inputData);

        expect(result.model_type).toBe('text');
        expect(result.embedding_dimensions).toBeNull();
      });

      it('should reject model_type text with positive embedding_dimensions', () => {
        const inputData = {
          model_type: 'text',
          embedding_dimensions: 1536,
        };

        expect(() => ModelUpdateParams.parse(inputData)).toThrow(
          'embedding_dimensions must not be set when changing model_type to anything but embed',
        );
      });

      it('should reject model_type decision with positive embedding_dimensions', () => {
        expect(() =>
          ModelUpdateParams.parse({
            model_type: 'decision',
            embedding_dimensions: 1536,
          }),
        ).toThrow(
          'embedding_dimensions must not be set when changing model_type to anything but embed',
        );
      });

      it('should accept model_type decision without embedding_dimensions', () => {
        expect(ModelUpdateParams.parse({ model_type: 'decision' })).toEqual({
          model_type: 'decision',
        });
      });

      it('should reject embedding_dimensions without model_type', () => {
        const inputData = {
          embedding_dimensions: 1536,
        };

        expect(() => ModelUpdateParams.parse(inputData)).toThrow();
      });

      it('should accept clearing embedding_dimensions to null without model_type', () => {
        const inputData = {
          embedding_dimensions: null,
        };

        const result = ModelUpdateParams.parse(inputData);

        expect(result.embedding_dimensions).toBeNull();
      });

      it('should accept model_name update with model_type embed and dimensions', () => {
        const inputData = {
          model_name: 'text-embedding-3-large',
          model_type: 'embed',
          embedding_dimensions: 3072,
        };

        const result = ModelUpdateParams.parse(inputData);

        expect(result.model_name).toBe('text-embedding-3-large');
        expect(result.model_type).toBe('embed');
        expect(result.embedding_dimensions).toBe(3072);
      });

      it('should reject zero embedding_dimensions', () => {
        const inputData = {
          model_type: 'embed',
          embedding_dimensions: 0,
        };

        expect(() => ModelUpdateParams.parse(inputData)).toThrow();
      });

      it('should reject negative embedding_dimensions', () => {
        const inputData = {
          model_type: 'embed',
          embedding_dimensions: -1536,
        };

        expect(() => ModelUpdateParams.parse(inputData)).toThrow();
      });

      it('should reject non-integer embedding_dimensions', () => {
        const inputData = {
          model_type: 'embed',
          embedding_dimensions: 1536.5,
        };

        expect(() => ModelUpdateParams.parse(inputData)).toThrow();
      });
    });
  });

  describe('ModelQueryParams Transform', () => {
    it('should accept empty query params', () => {
      const inputData = {};

      const result = ModelQueryParams.parse(inputData);

      expect(result).toEqual({});
    });

    it('should accept id filter', () => {
      const inputData = {
        id: testModelId,
      };

      const result = ModelQueryParams.parse(inputData);

      expect(result.id).toBe(testModelId);
    });

    it('should accept ai_provider_id filter', () => {
      const inputData = {
        ai_provider_id: testApiKeyId,
      };

      const result = ModelQueryParams.parse(inputData);

      expect(result.ai_provider_id).toBe(testApiKeyId);
    });

    it('should accept model_name filter', () => {
      const inputData = {
        model_name: 'gpt-4',
      };

      const result = ModelQueryParams.parse(inputData);

      expect(result.model_name).toBe('gpt-4');
    });

    it('should accept limit and offset', () => {
      const inputData = {
        limit: 10,
        offset: 20,
      };

      const result = ModelQueryParams.parse(inputData);

      expect(result.limit).toBe(10);
      expect(result.offset).toBe(20);
    });

    it('should reject negative offset', () => {
      const inputData = {
        offset: -1,
      };

      expect(() => ModelQueryParams.parse(inputData)).toThrow();
    });

    it('should reject zero or negative limit', () => {
      const inputDataZero = {
        limit: 0,
      };

      const inputDataNegative = {
        limit: -5,
      };

      expect(() => ModelQueryParams.parse(inputDataZero)).toThrow();
      expect(() => ModelQueryParams.parse(inputDataNegative)).toThrow();
    });

    it('should reject non-integer limit and offset', () => {
      const inputDataFloat = {
        limit: 10.5,
        offset: 5.2,
      };

      expect(() => ModelQueryParams.parse(inputDataFloat)).toThrow();
    });

    it('should reject invalid UUID for id', () => {
      const inputData = {
        id: 'invalid-uuid',
      };

      expect(() => ModelQueryParams.parse(inputData)).toThrow();
    });

    it('should reject invalid UUID for ai_provider_id', () => {
      const inputData = {
        ai_provider_id: 'invalid-uuid',
      };

      expect(() => ModelQueryParams.parse(inputData)).toThrow();
    });

    it('should reject empty model_name', () => {
      const inputData = {
        model_name: '',
      };

      expect(() => ModelQueryParams.parse(inputData)).toThrow();
    });

    it('should reject additional properties (strict mode)', () => {
      const inputData = {
        id: testModelId,
        extraField: 'should be rejected',
      };

      expect(() => ModelQueryParams.parse(inputData)).toThrow();
    });

    it('should coerce string numbers to integers for limit and offset', () => {
      const inputData = {
        limit: '10',
        offset: '20',
      };

      const result = ModelQueryParams.parse(inputData);

      expect(result.limit).toBe(10);
      expect(result.offset).toBe(20);
    });

    it('should handle multiple filters together', () => {
      const inputData = {
        ai_provider_id: testApiKeyId,
        model_name: 'gpt-4',
        limit: 5,
        offset: 10,
      };

      const result = ModelQueryParams.parse(inputData);

      expect(result.ai_provider_id).toBe(testApiKeyId);
      expect(result.model_name).toBe('gpt-4');
      expect(result.limit).toBe(5);
      expect(result.offset).toBe(10);
    });
  });

  describe('Model Schema Validation', () => {
    it('should validate a complete model object', () => {
      const modelData = {
        id: testModelId,
        ai_provider_id: testApiKeyId,
        model_name: 'gpt-4',
        model_type: 'text',
        embedding_dimensions: null,
        created_at: '2023-01-01T00:00:00.000Z',
        updated_at: '2023-01-01T00:00:00.000Z',
      };

      const result = Model.parse(modelData);

      expect(result).toEqual(modelData);
    });

    it('should validate an embedding model object', () => {
      const modelData = {
        id: testModelId,
        ai_provider_id: testApiKeyId,
        model_name: 'text-embedding-ada-002',
        model_type: 'embed',
        embedding_dimensions: 1536,
        created_at: '2023-01-01T00:00:00.000Z',
        updated_at: '2023-01-01T00:00:00.000Z',
      };

      const result = Model.parse(modelData);

      expect(result).toEqual(modelData);
    });

    it('should reject invalid UUIDs for id', () => {
      const modelData = {
        id: 'invalid-uuid',
        ai_provider_id: testApiKeyId,
        model_name: 'gpt-4',
        model_type: 'text',
        embedding_dimensions: null,
        created_at: '2023-01-01T00:00:00.000Z',
        updated_at: '2023-01-01T00:00:00.000Z',
      };

      expect(() => Model.parse(modelData)).toThrow();
    });

    it('should reject invalid UUIDs for ai_provider_id', () => {
      const modelData = {
        id: testModelId,
        ai_provider_id: 'invalid-uuid',
        model_name: 'gpt-4',
        model_type: 'text',
        embedding_dimensions: null,
        created_at: '2023-01-01T00:00:00.000Z',
        updated_at: '2023-01-01T00:00:00.000Z',
      };

      expect(() => Model.parse(modelData)).toThrow();
    });

    it('should reject empty model_name', () => {
      const modelData = {
        id: testModelId,
        ai_provider_id: testApiKeyId,
        model_name: '',
        model_type: 'text',
        embedding_dimensions: null,
        created_at: '2023-01-01T00:00:00.000Z',
        updated_at: '2023-01-01T00:00:00.000Z',
      };

      expect(() => Model.parse(modelData)).toThrow();
    });

    it('should reject invalid datetime strings', () => {
      const modelData = {
        id: testModelId,
        ai_provider_id: testApiKeyId,
        model_name: 'gpt-4',
        model_type: 'text',
        embedding_dimensions: null,
        created_at: 'invalid-date',
        updated_at: '2023-01-01T00:00:00.000Z',
      };

      expect(() => Model.parse(modelData)).toThrow();
    });

    it('should require timezone offset in datetime strings', () => {
      const modelData = {
        id: testModelId,
        ai_provider_id: testApiKeyId,
        model_name: 'gpt-4',
        model_type: 'text',
        embedding_dimensions: null,
        created_at: '2023-01-01T00:00:00', // Missing timezone offset
        updated_at: '2023-01-01T00:00:00.000Z',
      };

      expect(() => Model.parse(modelData)).toThrow();
    });

    it('should reject missing required fields', () => {
      const modelDataMissingId = {
        ai_provider_id: testApiKeyId,
        model_name: 'gpt-4',
        model_type: 'text',
        embedding_dimensions: null,
        created_at: '2023-01-01T00:00:00.000Z',
        updated_at: '2023-01-01T00:00:00.000Z',
      };

      const modelDataMissingApiKeyId = {
        id: testModelId,
        model_name: 'gpt-4',
        model_type: 'text',
        embedding_dimensions: null,
        created_at: '2023-01-01T00:00:00.000Z',
        updated_at: '2023-01-01T00:00:00.000Z',
      };

      const modelDataMissingModelName = {
        id: testModelId,
        ai_provider_id: testApiKeyId,
        model_type: 'text',
        embedding_dimensions: null,
        created_at: '2023-01-01T00:00:00.000Z',
        updated_at: '2023-01-01T00:00:00.000Z',
      };

      expect(() => Model.parse(modelDataMissingId)).toThrow();
      expect(() => Model.parse(modelDataMissingApiKeyId)).toThrow();
      expect(() => Model.parse(modelDataMissingModelName)).toThrow();
    });

    it('should handle various real-world model names', () => {
      const modelNames = [
        'gpt-4',
        'gpt-4-turbo',
        'gpt-3.5-turbo',
        'claude-3-opus-20240229',
        'claude-3-sonnet-20240229',
        'claude-3-haiku-20240307',
        'gemini-pro',
        'gemini-1.5-pro',
        'llama-2-70b-chat',
        'mistral-7b-instruct',
        'text-davinci-003',
      ];

      for (const modelName of modelNames) {
        const modelData = {
          id: testModelId,
          ai_provider_id: testApiKeyId,
          model_name: modelName,
          model_type: 'text',
          embedding_dimensions: null,
          created_at: '2023-01-01T00:00:00.000Z',
          updated_at: '2023-01-01T00:00:00.000Z',
        };

        const result = Model.parse(modelData);
        expect(result.model_name).toBe(modelName);
      }
    });
  });
});
