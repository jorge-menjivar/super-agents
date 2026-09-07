import {
  Agent,
  AgentCreateParams,
  AgentQueryParams,
  AgentUpdateParams,
} from '@shared/types/data/agent';
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

describe('Agent Data Transforms and Validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('AgentCreateParams Transform', () => {
    it('should default metadata to empty object', () => {
      const inputData = {
        name: 'test-agent',
        description: 'A test agent with sufficient description length',
      };

      const result = AgentCreateParams.parse(inputData);

      expect(result.metadata).toEqual({});
    });

    it('should accept custom metadata', () => {
      const customMetadata = {
        model: 'gpt-4',
        temperature: 0.7,
        max_tokens: 1000,
      };

      const inputData = {
        name: 'test-agent',
        description: 'A test agent with sufficient description length',
        metadata: customMetadata,
      };

      const result = AgentCreateParams.parse(inputData);

      expect(result.metadata).toEqual(customMetadata);
    });

    it('should require description field with minimum 25 characters', () => {
      const inputDataTooShort = {
        name: 'test-agent',
        description: 'Too short',
      };

      expect(() => AgentCreateParams.parse(inputDataTooShort)).toThrow();

      const inputDataValid = {
        name: 'test-agent',
        description: 'This has exactly 25 chars',
      };

      const result = AgentCreateParams.parse(inputDataValid);
      expect(result.description).toBe('This has exactly 25 chars');
    });

    it('should reject description exceeding maximum length', () => {
      const inputData = {
        name: 'test-agent',
        description: 'x'.repeat(10001),
      };

      expect(() => AgentCreateParams.parse(inputData)).toThrow();
    });

    it('should reject null description', () => {
      const inputData = {
        name: 'test-agent',
        description: null,
      };

      expect(() => AgentCreateParams.parse(inputData)).toThrow();
    });

    it('should validate name with lowercase letters, numbers, underscores, and hyphens only', () => {
      const validNames = [
        'test-agent',
        'test_agent',
        'testagent123',
        'test-agent_123',
      ];

      for (const name of validNames) {
        const inputData = {
          name,
          description: 'A test agent with sufficient description length',
        };
        const result = AgentCreateParams.parse(inputData);
        expect(result.name).toBe(name);
      }
    });

    it('should reject name with uppercase letters', () => {
      const inputData = {
        name: 'TestAgent',
        description: 'A test agent with sufficient description length',
      };

      expect(() => AgentCreateParams.parse(inputData)).toThrow();
    });

    it('should reject name with spaces', () => {
      const inputData = {
        name: 'test agent',
        description: 'A test agent with sufficient description length',
      };

      expect(() => AgentCreateParams.parse(inputData)).toThrow();
    });

    it('should reject name with special characters', () => {
      const invalidNames = [
        'test@agent',
        'test.agent',
        'test!agent',
        'test#agent',
      ];

      for (const name of invalidNames) {
        const inputData = {
          name,
          description: 'A test agent with sufficient description length',
        };
        expect(() => AgentCreateParams.parse(inputData)).toThrow();
      }
    });

    it('should reject name shorter than 3 characters', () => {
      const inputData = {
        name: 'ab',
        description: 'A test agent with sufficient description length',
      };

      expect(() => AgentCreateParams.parse(inputData)).toThrow();
    });

    it('should accept name with exactly 3 characters', () => {
      const inputData = {
        name: 'abc',
        description: 'A test agent with sufficient description length',
      };

      const result = AgentCreateParams.parse(inputData);
      expect(result.name).toBe('abc');
    });

    it('should reject name longer than 100 characters', () => {
      const inputData = {
        name: 'a'.repeat(101),
        description: 'A test agent with sufficient description length',
      };

      expect(() => AgentCreateParams.parse(inputData)).toThrow();
    });

    it('should reject reserved agent names', () => {
      const reservedNames = ['super-agents'];

      for (const name of reservedNames) {
        const inputData = {
          name,
          description: 'A test agent with sufficient description length',
        };

        expect(() => AgentCreateParams.parse(inputData)).toThrow();
      }
    });

    it('should accept super-agent name (not reserved)', () => {
      const inputData = {
        name: 'super-agent',
        description: 'A test agent with sufficient description length',
      };

      const result = AgentCreateParams.parse(inputData);
      expect(result.name).toBe('super-agent');
    });

    it('should accept name with exactly 100 characters', () => {
      const inputData = {
        name: 'a'.repeat(100),
        description: 'A test agent with sufficient description length',
      };

      const result = AgentCreateParams.parse(inputData);
      expect(result.name).toBe('a'.repeat(100));
    });

    it('should prevent users from overriding id field (strict mode)', () => {
      const inputData = {
        name: 'test-agent',
        description: 'A test agent with sufficient description length',
        id: 'user-provided-id', // Should be rejected
      };

      expect(() => AgentCreateParams.parse(inputData)).toThrow();
    });

    it('should prevent users from overriding created_at field (strict mode)', () => {
      const inputData = {
        name: 'test-agent',
        description: 'A test agent with sufficient description length',
        created_at: '2022-01-01T00:00:00.000Z', // Should be rejected
      };

      expect(() => AgentCreateParams.parse(inputData)).toThrow();
    });

    it('should prevent users from overriding updated_at field (strict mode)', () => {
      const inputData = {
        name: 'test-agent',
        description: 'A test agent with sufficient description length',
        updated_at: '2022-01-01T00:00:00.000Z', // Should be rejected
      };

      expect(() => AgentCreateParams.parse(inputData)).toThrow();
    });

    it('should reject objects with additional properties (strict mode)', () => {
      const inputData = {
        name: 'test-agent',
        description: 'A test agent with sufficient description length',
        extra_field: 'should be rejected',
      };

      expect(() => AgentCreateParams.parse(inputData)).toThrow();
    });

    it('should require all required fields', () => {
      const incompleteData = {
        // Missing name and description
      };

      expect(() => AgentCreateParams.parse(incompleteData)).toThrow();
    });

    it('should reject empty strings for name', () => {
      const inputData = {
        name: '',
        description: 'A test agent with sufficient description length',
      };

      expect(() => AgentCreateParams.parse(inputData)).toThrow();
    });

    it('should handle complex metadata objects', () => {
      const complexMetadata = {
        models: ['gpt-4', 'gpt-3.5-turbo'],
        config: {
          temperature: 0.7,
          max_tokens: 1000,
          stop: ['\n', '###'],
        },
        features: {
          streaming: true,
          functions: false,
        },
        nested: {
          deep: {
            value: 'test',
            number: 42,
            array: [1, 2, 3],
          },
        },
      };

      const inputData = {
        name: 'test-agent',
        description: 'A test agent with sufficient description length',
        metadata: complexMetadata,
      };

      const result = AgentCreateParams.parse(inputData);

      expect(result.metadata).toEqual(complexMetadata);
    });
  });

  describe('AgentUpdateParams Transform', () => {
    it('should not allow extra parameters', () => {
      const inputData = {
        description: 'Updated description',
        id: '123e4567-e89b-12d3-a456-426614174000',
      };

      expect(() => AgentUpdateParams.parse(inputData)).toThrow(
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

    it('should accept updates with description only', () => {
      const inputData = {
        description: 'Updated description',
      };

      const result = AgentUpdateParams.parse(inputData);

      expect(result.description).toBe('Updated description');
      expect(result.metadata).toBeUndefined();
    });

    it('should accept updates with metadata only', () => {
      const newMetadata = { updated: true };
      const inputData = {
        metadata: newMetadata,
      };

      const result = AgentUpdateParams.parse(inputData);

      expect(result.metadata).toEqual(newMetadata);
      expect(result.description).toBeUndefined();
    });

    it('should accept updates with all fields', () => {
      const inputData = {
        description: 'Updated description',
        metadata: { updated: true },
      };

      const result = AgentUpdateParams.parse(inputData);

      expect(result).toEqual({
        description: 'Updated description',
        metadata: { updated: true },
      });
    });

    it('should accept null description', () => {
      const inputData = {
        description: null,
      };

      const result = AgentUpdateParams.parse(inputData);

      expect(result.description).toBeNull();
    });
  });

  describe('AgentQueryParams Validation', () => {
    it('should validate optional id as UUID', () => {
      const validParams = {
        id: '123e4567-e89b-12d3-a456-426614174000',
      };

      const result = AgentQueryParams.parse(validParams);
      expect(result.id).toBe(validParams.id);
    });

    it('should validate optional name with regex pattern', () => {
      const validParams = {
        name: 'test-agent',
      };

      const result = AgentQueryParams.parse(validParams);
      expect(result.name).toBe('test-agent');
    });

    it('should reject name with uppercase letters', () => {
      const invalidParams = {
        name: 'TestAgent',
      };

      expect(() => AgentQueryParams.parse(invalidParams)).toThrow();
    });

    it('should reject name with spaces', () => {
      const invalidParams = {
        name: 'test agent',
      };

      expect(() => AgentQueryParams.parse(invalidParams)).toThrow();
    });

    it('should reject name shorter than 3 characters', () => {
      const invalidParams = {
        name: 'ab',
      };

      expect(() => AgentQueryParams.parse(invalidParams)).toThrow();
    });

    it('should reject name longer than 100 characters', () => {
      const invalidParams = {
        name: 'a'.repeat(101),
      };

      expect(() => AgentQueryParams.parse(invalidParams)).toThrow();
    });

    it('should validate limit as positive integer', () => {
      const validParams = {
        limit: 50,
      };

      const result = AgentQueryParams.parse(validParams);
      expect(result.limit).toBe(50);
    });

    it('should validate offset as non-negative integer', () => {
      const validParams = {
        offset: 20,
      };

      const result = AgentQueryParams.parse(validParams);
      expect(result.offset).toBe(20);
    });

    it('should reject invalid UUID for id', () => {
      const invalidParams = {
        id: 'not-a-uuid',
      };

      expect(() => AgentQueryParams.parse(invalidParams)).toThrow();
    });

    it('should reject negative limit', () => {
      const invalidParams = {
        limit: -10,
      };

      expect(() => AgentQueryParams.parse(invalidParams)).toThrow();
    });

    it('should reject zero limit', () => {
      const invalidParams = {
        limit: 0,
      };

      expect(() => AgentQueryParams.parse(invalidParams)).toThrow();
    });

    it('should reject negative offset', () => {
      const invalidParams = {
        offset: -5,
      };

      expect(() => AgentQueryParams.parse(invalidParams)).toThrow();
    });

    it('should allow zero offset', () => {
      const validParams = {
        offset: 0,
      };

      const result = AgentQueryParams.parse(validParams);
      expect(result.offset).toBe(0);
    });

    it('should reject objects with additional properties (strict mode)', () => {
      const inputData = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        extra_param: 'should be rejected',
      };

      expect(() => AgentQueryParams.parse(inputData)).toThrow();
    });

    it('should accept empty query params', () => {
      const emptyParams = {};

      const result = AgentQueryParams.parse(emptyParams);
      expect(result).toEqual({});
    });

    it('should accept all valid params together', () => {
      const validParams = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        name: 'test-agent',
        limit: 25,
        offset: 10,
      };

      const result = AgentQueryParams.parse(validParams);
      expect(result).toEqual(validParams);
    });
  });

  describe('Agent Schema Validation', () => {
    it('should validate complete agent object', () => {
      const validAgent: Agent = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        name: 'test-agent',
        description: 'A test agent with sufficient description length',
        metadata: { model: 'gpt-4' },
        created_at: '2023-01-01T00:00:00.000Z',
        updated_at: '2023-01-01T00:00:00.000Z',
        auto_create_skills: true,
        skill_match_threshold: 0.8,
        max_auto_created_skills: 10,
        skill_arbiter_model_id: null,
        skill_arbiter_timeout_ms: null,
        reviewer_agent_id: null,
        review_fail_closed: false,
        review_expose_reason: false,
      };

      const result = Agent.parse(validAgent);
      expect(result).toEqual(validAgent);
    });

    it('should validate datetime strings with timezone offset', () => {
      const validAgent = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        name: 'test-agent',
        description: 'A test agent with sufficient description length',
        metadata: {},
        auto_create_skills: true,
        skill_match_threshold: 0.8,
        max_auto_created_skills: 10,
        skill_arbiter_model_id: null,
        skill_arbiter_timeout_ms: null,
        reviewer_agent_id: null,
        review_fail_closed: false,
        review_expose_reason: false,
        created_at: '2023-01-01T00:00:00.000+00:00',
        updated_at: '2023-01-02T12:30:45.123-05:00',
      };

      const result = Agent.parse(validAgent);
      expect(result.created_at).toBe('2023-01-01T00:00:00.000+00:00');
      expect(result.updated_at).toBe('2023-01-02T12:30:45.123-05:00');
    });

    it('should reject invalid datetime format', () => {
      const invalidAgent = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        name: 'test-agent',
        description: 'A test agent with sufficient description length',
        metadata: {},
        created_at: 'invalid-date',
        updated_at: '2023-01-01T00:00:00.000Z',
      };

      expect(() => Agent.parse(invalidAgent)).toThrow();
    });

    it('should reject invalid UUID formats', () => {
      const invalidAgent = {
        id: 'not-a-uuid',
        name: 'test-agent',
        description: 'A test agent with sufficient description length',
        metadata: {},
        created_at: '2023-01-01T00:00:00.000Z',
        updated_at: '2023-01-01T00:00:00.000Z',
      };

      expect(() => Agent.parse(invalidAgent)).toThrow();
    });

    it('should require all required fields', () => {
      const incompleteAgent = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        // Missing other required fields
      };

      expect(() => Agent.parse(incompleteAgent)).toThrow();
    });

    it('should allow empty strings for name and description from database', () => {
      // Note: Agent schema (for reading from DB) allows empty strings,
      // but AgentCreateParams (for creation) does not
      const agentWithEmptyFields = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        name: '',
        description: '',
        metadata: {},
        auto_create_skills: true,
        skill_match_threshold: 0.8,
        max_auto_created_skills: 10,
        skill_arbiter_model_id: null,
        skill_arbiter_timeout_ms: null,
        reviewer_agent_id: null,
        review_fail_closed: false,
        review_expose_reason: false,
        created_at: '2023-01-01T00:00:00.000Z',
        updated_at: '2023-01-01T00:00:00.000Z',
      };

      const result = Agent.parse(agentWithEmptyFields);
      expect(result.name).toBe('');
      expect(result.description).toBe('');
    });

    it('should handle complex metadata objects', () => {
      const complexMetadata = {
        models: ['gpt-4', 'gpt-3.5-turbo'],
        config: {
          temperature: 0.7,
          max_tokens: 1000,
        },
        features: {
          streaming: true,
        },
      };

      const validAgent = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        name: 'test-agent',
        description: 'A test agent with sufficient description length',
        metadata: complexMetadata,
        auto_create_skills: true,
        skill_match_threshold: 0.8,
        max_auto_created_skills: 10,
        skill_arbiter_model_id: null,
        skill_arbiter_timeout_ms: null,
        reviewer_agent_id: null,
        review_fail_closed: false,
        review_expose_reason: false,
        created_at: '2023-01-01T00:00:00.000Z',
        updated_at: '2023-01-01T00:00:00.000Z',
      };

      const result = Agent.parse(validAgent);
      expect(result.metadata).toEqual(complexMetadata);
    });
  });
});

describe('automatic skill settings', () => {
  const minimal = { name: 'helper', description: 'x'.repeat(30) };

  it('default to creating skills, a 0.8 threshold and a cap of 10', () => {
    expect(AgentCreateParams.parse(minimal)).toMatchObject({
      auto_create_skills: true,
      skill_match_threshold: 0.8,
      max_auto_created_skills: 10,
    });
  });

  it('leave the arbiter to the system settings unless overridden', () => {
    const created = AgentCreateParams.parse(minimal);
    expect(created.skill_arbiter_model_id).toBeUndefined();
    expect(created.skill_arbiter_timeout_ms).toBeUndefined();
    expect(() =>
      AgentCreateParams.parse({ ...minimal, skill_arbiter_timeout_ms: 500 }),
    ).toThrow();
    expect(AgentUpdateParams.parse({ skill_arbiter_timeout_ms: null })).toEqual(
      { skill_arbiter_timeout_ms: null },
    );
  });

  it('keep the threshold between 0 and 1 and the cap a whole, non-negative number', () => {
    expect(() =>
      AgentCreateParams.parse({ ...minimal, skill_match_threshold: 1.5 }),
    ).toThrow();
    expect(() =>
      AgentCreateParams.parse({ ...minimal, max_auto_created_skills: -1 }),
    ).toThrow();
    expect(() =>
      AgentCreateParams.parse({ ...minimal, max_auto_created_skills: 2.5 }),
    ).toThrow();
    expect(
      AgentCreateParams.parse({ ...minimal, skill_match_threshold: 0 })
        .skill_match_threshold,
    ).toBe(0);
  });

  it('can be updated on their own', () => {
    expect(AgentUpdateParams.parse({ auto_create_skills: false })).toEqual({
      auto_create_skills: false,
    });
    expect(AgentUpdateParams.parse({ max_auto_created_skills: 0 })).toEqual({
      max_auto_created_skills: 0,
    });
  });

  it('are required on a stored agent', () => {
    expect(() =>
      Agent.parse({
        id: '123e4567-e89b-12d3-a456-426614174000',
        name: 'helper',
        description: 'x'.repeat(30),
        metadata: {},
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      }),
    ).toThrow();
  });
});

describe('reviewer_agent_id', () => {
  const minimal = {
    name: 'reviewed',
    description: 'An agent whose answers another agent reviews first.',
  };
  const reviewer = '6f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f';

  it('is optional on creation and may name an agent or nothing', () => {
    expect(AgentCreateParams.parse(minimal).reviewer_agent_id).toBeUndefined();
    expect(
      AgentCreateParams.parse({ ...minimal, reviewer_agent_id: reviewer })
        .reviewer_agent_id,
    ).toBe(reviewer);
    expect(
      AgentCreateParams.parse({ ...minimal, reviewer_agent_id: null })
        .reviewer_agent_id,
    ).toBeNull();
  });

  it('has to be an agent id', () => {
    expect(() =>
      AgentCreateParams.parse({ ...minimal, reviewer_agent_id: 'guard' }),
    ).toThrow();
  });

  it('fails open unless told otherwise', () => {
    expect(AgentCreateParams.parse(minimal).review_fail_closed).toBe(false);
    expect(
      AgentCreateParams.parse({ ...minimal, review_fail_closed: true })
        .review_fail_closed,
    ).toBe(true);
    expect(
      AgentUpdateParams.parse({ review_fail_closed: true }).review_fail_closed,
    ).toBe(true);
  });

  it('keeps the reason to the log unless told otherwise', () => {
    expect(AgentCreateParams.parse(minimal).review_expose_reason).toBe(false);
    expect(
      AgentCreateParams.parse({ ...minimal, review_expose_reason: true })
        .review_expose_reason,
    ).toBe(true);
    expect(
      AgentUpdateParams.parse({ review_expose_reason: true })
        .review_expose_reason,
    ).toBe(true);
  });

  it('is enough on its own to make an update', () => {
    expect(
      AgentUpdateParams.parse({ reviewer_agent_id: null }).reviewer_agent_id,
    ).toBeNull();
    expect(
      AgentUpdateParams.parse({ reviewer_agent_id: reviewer })
        .reviewer_agent_id,
    ).toBe(reviewer);
  });
});
