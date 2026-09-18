import {
  SKILL_SUMMARY_COLUMNS,
  Skill,
  SkillCreateParams,
  SkillQueryParams,
  SkillSummary,
  SkillUpdateParams,
} from '@shared/types/data/skill';
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

describe('Skill Data Transforms and Validation', () => {
  const testAgentId = '550e8400-e29b-41d4-a716-446655440000';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('SkillCreateParams Transform', () => {
    it('should accept valid skill creation parameters', () => {
      const inputData = {
        agent_id: testAgentId,
        name: 'test-skill',
        description: 'This is a test skill description with sufficient length',
        metadata: {},
        optimize: false,
      };

      const result = SkillCreateParams.parse(inputData);

      expect(result.metadata).toEqual({});
      expect(result.description).toBe(
        'This is a test skill description with sufficient length',
      );
    });

    it('should accept empty metadata (reserved for user-defined data)', () => {
      const inputData = {
        agent_id: testAgentId,
        name: 'test-skill',
        description: 'This is a test skill description with sufficient length',
        metadata: {},
        optimize: false,
      };

      const result = SkillCreateParams.parse(inputData);

      expect(result.metadata).toEqual({});
    });

    it('should reject description that is too short', () => {
      const inputData = {
        agent_id: testAgentId,
        name: 'Test Skill',
        description: 'Too short',
        metadata: {},
        optimize: false,
      };

      expect(() => SkillCreateParams.parse(inputData)).toThrow();
    });

    it('should accept minimum length description', () => {
      const inputData = {
        agent_id: testAgentId,
        name: 'test-skill',
        description: 'This has exactly 25 chars',
        metadata: {},
        optimize: false,
      };

      const result = SkillCreateParams.parse(inputData);

      expect(result.description).toBe('This has exactly 25 chars');
    });

    it('should prevent users from overriding id field (strict mode)', () => {
      const inputData = {
        agent_id: testAgentId,
        name: 'test-skill',
        description: 'This is a test skill description with sufficient length',
        metadata: {},
        optimize: false,
        id: '123e4567-e89b-12d3-a456-426614174000', // This should be ignored
      };

      expect(() => SkillCreateParams.parse(inputData)).toThrow();
    });

    it('should prevent users from overriding created_at field (strict mode)', () => {
      const inputData = {
        agent_id: testAgentId,
        name: 'test-skill',
        description: 'This is a test skill description with sufficient length',
        metadata: {},
        optimize: false,
        created_at: '2023-01-01T00:00:00.000Z', // This should be ignored
      };

      expect(() => SkillCreateParams.parse(inputData)).toThrow();
    });

    it('should prevent users from overriding updated_at field (strict mode)', () => {
      const inputData = {
        agent_id: testAgentId,
        name: 'test-skill',
        description: 'This is a test skill description with sufficient length',
        metadata: {},
        optimize: false,
        updated_at: '2023-01-01T00:00:00.000Z', // This should be ignored
      };

      expect(() => SkillCreateParams.parse(inputData)).toThrow();
    });

    it('should reject objects with additional properties (strict mode)', () => {
      const inputData = {
        agent_id: testAgentId,
        name: 'test-skill',
        description: 'This is a test skill description with sufficient length',
        metadata: {},
        optimize: false,
        extraField: 'should be rejected', // This should cause rejection
      };

      expect(() => SkillCreateParams.parse(inputData)).toThrow();
    });

    it('should require all required fields', () => {
      const inputData = {
        // Missing required fields
      };

      expect(() => SkillCreateParams.parse(inputData)).toThrow();
    });

    it('should validate name with lowercase letters, numbers, underscores, and hyphens only', () => {
      const validNames = [
        'test-skill',
        'test_skill',
        'testskill123',
        'test-skill_123',
      ];

      for (const name of validNames) {
        const inputData = {
          agent_id: testAgentId,
          name,
          description:
            'This is a test skill description with sufficient length',
          metadata: {},
          optimize: false,
        };
        const result = SkillCreateParams.parse(inputData);
        expect(result.name).toBe(name);
      }
    });

    it('should reject name with uppercase letters', () => {
      const inputData = {
        agent_id: testAgentId,
        name: 'TestSkill',
        description: 'This is a test skill description with sufficient length',
        metadata: {},
        optimize: false,
      };

      expect(() => SkillCreateParams.parse(inputData)).toThrow();
    });

    it('should reject name with spaces', () => {
      const inputData = {
        agent_id: testAgentId,
        name: 'test skill',
        description: 'This is a test skill description with sufficient length',
        metadata: {},
        optimize: false,
      };

      expect(() => SkillCreateParams.parse(inputData)).toThrow();
    });

    it('should reject name with special characters', () => {
      const invalidNames = [
        'test@skill',
        'test.skill',
        'test!skill',
        'test#skill',
      ];

      for (const name of invalidNames) {
        const inputData = {
          agent_id: testAgentId,
          name,
          description:
            'This is a test skill description with sufficient length',
          metadata: {},
          optimize: false,
        };
        expect(() => SkillCreateParams.parse(inputData)).toThrow();
      }
    });

    it('should reject name shorter than 3 characters', () => {
      const inputData = {
        agent_id: testAgentId,
        name: 'ab',
        description: 'This is a test skill description with sufficient length',
        metadata: {},
        optimize: false,
      };

      expect(() => SkillCreateParams.parse(inputData)).toThrow();
    });

    it('should accept name with exactly 3 characters', () => {
      const inputData = {
        agent_id: testAgentId,
        name: 'abc',
        description: 'This is a test skill description with sufficient length',
        metadata: {},
        optimize: false,
      };

      const result = SkillCreateParams.parse(inputData);
      expect(result.name).toBe('abc');
    });

    it('should reject name longer than 100 characters', () => {
      const inputData = {
        agent_id: testAgentId,
        name: 'a'.repeat(101),
        description: 'This is a test skill description with sufficient length',
        metadata: {},
        optimize: false,
      };

      expect(() => SkillCreateParams.parse(inputData)).toThrow();
    });

    it('should accept name with exactly 100 characters', () => {
      const inputData = {
        agent_id: testAgentId,
        name: 'a'.repeat(100),
        description: 'This is a test skill description with sufficient length',
        metadata: {},
        optimize: false,
      };

      const result = SkillCreateParams.parse(inputData);
      expect(result.name).toBe('a'.repeat(100));
    });

    it('should reject empty strings for name', () => {
      const inputData = {
        agent_id: testAgentId,
        name: '', // Empty string should be rejected
        description: 'This is a test skill description with sufficient length',
        metadata: {},
        optimize: false,
      };

      expect(() => SkillCreateParams.parse(inputData)).toThrow();
    });

    it('should reject metadata with restricted fields (state management fields moved to columns)', () => {
      const invalidMetadata = {
        last_clustering_at: '2023-01-01T00:00:00.000Z',
      };

      const inputData = {
        agent_id: testAgentId,
        name: 'test-skill',
        description: 'This is a test skill description with sufficient length',
        metadata: invalidMetadata,
        optimize: false,
      };

      expect(() => SkillCreateParams.parse(inputData)).toThrow();
    });

    it('should apply default values for optional configuration fields', () => {
      const inputData = {
        agent_id: testAgentId,
        name: 'test-skill',
        description: 'This is a test skill description with sufficient length',
        metadata: {},
        optimize: false,
      };

      const result = SkillCreateParams.parse(inputData);

      expect(result.configuration_count).toBe(3);
      expect(result.clustering_interval).toBe(15);
      expect(result.reflection_min_requests_per_arm).toBe(3);
    });
  });

  describe('SkillUpdateParams Transform', () => {
    it('should not allow extra parameters', () => {
      const inputData = {
        description: 'My skill description with sufficient length for testing',
        id: '123e4567-e89b-12d3-a456-426614174000',
      };

      expect(() => SkillUpdateParams.parse(inputData)).toThrow();
    });

    it('should reject objects with no update fields', () => {
      const inputData = {};

      expect(() => SkillUpdateParams.parse(inputData)).toThrow(
        'At least one field must be provided for update',
      );
    });

    it('should accept updates with description only', () => {
      const inputData = {
        description:
          'Updated description with sufficient length for validation',
      };

      const result = SkillUpdateParams.parse(inputData);

      expect(result.description).toBe(
        'Updated description with sufficient length for validation',
      );
      expect(result.metadata).toBeUndefined();
    });

    it('should accept updates with state management fields', () => {
      const inputData = {
        last_clustering_at: '2023-02-01T00:00:00.000Z',
        last_clustering_log_start_time: 1675209600,
      };

      const result = SkillUpdateParams.parse(inputData);

      expect(result.last_clustering_at).toEqual('2023-02-01T00:00:00.000Z');
      expect(result.last_clustering_log_start_time).toBe(1675209600);
      expect(result.description).toBeUndefined();
    });

    it('should accept partial updates with multiple fields', () => {
      const inputData = {
        description:
          'Updated description with sufficient length for validation',
        configuration_count: 5,
      };

      const result = SkillUpdateParams.parse(inputData);

      expect(result.description).toBe(
        'Updated description with sufficient length for validation',
      );
      expect(result.configuration_count).toBe(5);
      expect(result.metadata).toBeUndefined();
    });

    it('should reject description that is too short', () => {
      const inputData = {
        description: 'Too short',
      };

      expect(() => SkillUpdateParams.parse(inputData)).toThrow();
    });
  });

  describe('SkillQueryParams Transform', () => {
    it('should accept empty query params', () => {
      const inputData = {};

      const result = SkillQueryParams.parse(inputData);

      expect(result).toEqual({});
    });

    it('should accept id filter', () => {
      const inputData = {
        id: '123e4567-e89b-12d3-a456-426614174000',
      };

      const result = SkillQueryParams.parse(inputData);

      expect(result.id).toBe('123e4567-e89b-12d3-a456-426614174000');
    });

    it('should accept name filter with valid format', () => {
      const inputData = {
        name: 'test-skill',
      };

      const result = SkillQueryParams.parse(inputData);

      expect(result.name).toBe('test-skill');
    });

    it('should reject name with uppercase letters', () => {
      const invalidParams = {
        name: 'TestSkill',
      };

      expect(() => SkillQueryParams.parse(invalidParams)).toThrow();
    });

    it('should reject name with spaces', () => {
      const invalidParams = {
        name: 'test skill',
      };

      expect(() => SkillQueryParams.parse(invalidParams)).toThrow();
    });

    it('should reject name shorter than 3 characters', () => {
      const invalidParams = {
        name: 'ab',
      };

      expect(() => SkillQueryParams.parse(invalidParams)).toThrow();
    });

    it('should reject name longer than 100 characters', () => {
      const invalidParams = {
        name: 'a'.repeat(101),
      };

      expect(() => SkillQueryParams.parse(invalidParams)).toThrow();
    });

    it('should accept limit and offset', () => {
      const inputData = {
        limit: 10,
        offset: 20,
      };

      const result = SkillQueryParams.parse(inputData);

      expect(result.limit).toBe(10);
      expect(result.offset).toBe(20);
    });

    it('should reject negative offset', () => {
      const inputData = {
        offset: -1,
      };

      expect(() => SkillQueryParams.parse(inputData)).toThrow();
    });

    it('should reject zero or negative limit', () => {
      const inputDataZero = {
        limit: 0,
      };

      const inputDataNegative = {
        limit: -5,
      };

      expect(() => SkillQueryParams.parse(inputDataZero)).toThrow();
      expect(() => SkillQueryParams.parse(inputDataNegative)).toThrow();
    });

    it('should reject non-integer limit and offset', () => {
      const inputDataFloat = {
        limit: 10.5,
        offset: 5.2,
      };

      expect(() => SkillQueryParams.parse(inputDataFloat)).toThrow();
    });

    it('should reject invalid UUID for id', () => {
      const inputData = {
        id: 'invalid-uuid',
      };

      expect(() => SkillQueryParams.parse(inputData)).toThrow();
    });

    it('should reject empty name', () => {
      const inputData = {
        name: '',
      };

      expect(() => SkillQueryParams.parse(inputData)).toThrow();
    });

    it('should reject additional properties (strict mode)', () => {
      const inputData = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        extraField: 'should be rejected',
      };

      expect(() => SkillQueryParams.parse(inputData)).toThrow();
    });
  });

  describe('Skill Schema Validation', () => {
    it('should validate a complete skill object', () => {
      const skillData = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        agent_id: testAgentId,
        name: 'test-skill',
        description: 'A test skill with sufficient description length',
        metadata: {},
        optimize: false,
        configuration_count: 10,
        clustering_interval: 15,
        reflection_min_requests_per_arm: 3,
        exploration_temperature: 1.0,
        last_clustering_at: null,
        last_clustering_log_start_time: null,
        evaluations_regenerated_at: null,
        evaluation_lock_acquired_at: null,
        total_requests: 0,
        allowed_template_variables: [],
        auto_created: false,
        seed_system_prompt: null,
        created_at: '2023-01-01T00:00:00.000Z',
        updated_at: '2023-01-01T00:00:00.000Z',
      };

      const result = Skill.parse(skillData);

      expect(result).toEqual(skillData);
    });

    it('should validate skill with state management fields', () => {
      const skillData = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        agent_id: testAgentId,
        name: 'test-skill',
        description: 'A test skill with sufficient description length',
        metadata: {},
        optimize: false,
        configuration_count: 10,
        clustering_interval: 15,
        reflection_min_requests_per_arm: 3,
        exploration_temperature: 1.0,
        last_clustering_at: '2023-01-01T00:00:00.000Z',
        last_clustering_log_start_time: 1234567890,
        evaluations_regenerated_at: '2023-01-01T00:00:00.000Z',
        evaluation_lock_acquired_at: null,
        total_requests: 0,
        allowed_template_variables: ['datetime'],
        auto_created: false,
        seed_system_prompt: null,
        created_at: '2023-01-01T00:00:00.000Z',
        updated_at: '2023-01-01T00:00:00.000Z',
      };

      const result = Skill.parse(skillData);

      expect(result.last_clustering_at).toBe('2023-01-01T00:00:00.000Z');
      expect(result.last_clustering_log_start_time).toBe(1234567890);
      expect(result.evaluations_regenerated_at).toBe(
        '2023-01-01T00:00:00.000Z',
      );
    });

    it('should require description field', () => {
      const skillData = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        agent_id: testAgentId,
        name: 'test-skill',
        metadata: {},
        optimize: false,
        configuration_count: 10,
        clustering_interval: 15,
        reflection_min_requests_per_arm: 3,
        exploration_temperature: 1.0,
        last_clustering_at: null,
        last_clustering_log_start_time: null,
        evaluations_regenerated_at: null,
        evaluation_lock_acquired_at: null,
        total_requests: 0,
        created_at: '2023-01-01T00:00:00.000Z',
        updated_at: '2023-01-01T00:00:00.000Z',
      };

      expect(() => Skill.parse(skillData)).toThrow();
    });

    it('should reject invalid UUIDs', () => {
      const skillData = {
        id: 'invalid-uuid',
        agent_id: testAgentId,
        name: 'test-skill',
        description: 'A test skill with sufficient description length',
        metadata: {},
        optimize: false,
        configuration_count: 10,
        clustering_interval: 15,
        reflection_min_requests_per_arm: 3,
        exploration_temperature: 1.0,
        last_clustering_at: null,
        last_clustering_log_start_time: null,
        evaluations_regenerated_at: null,
        evaluation_lock_acquired_at: null,
        total_requests: 0,
        created_at: '2023-01-01T00:00:00.000Z',
        updated_at: '2023-01-01T00:00:00.000Z',
      };

      expect(() => Skill.parse(skillData)).toThrow();
    });

    it('should accept empty name from database', () => {
      // Note: Skill schema (for reading from DB) allows empty names,
      // but SkillCreateParams (for creation) does not
      const skillData = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        agent_id: testAgentId,
        name: '',
        description: 'A test skill with sufficient description length',
        metadata: {},
        optimize: false,
        configuration_count: 10,
        clustering_interval: 15,
        reflection_min_requests_per_arm: 3,
        exploration_temperature: 1.0,
        last_clustering_at: null,
        last_clustering_log_start_time: null,
        evaluations_regenerated_at: null,
        evaluation_lock_acquired_at: null,
        total_requests: 0,
        allowed_template_variables: [],
        auto_created: false,
        seed_system_prompt: null,
        created_at: '2023-01-01T00:00:00.000Z',
        updated_at: '2023-01-01T00:00:00.000Z',
      };

      const result = Skill.parse(skillData);

      expect(result.name).toBe('');
    });

    it('should reject invalid datetime strings', () => {
      const skillData = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        agent_id: testAgentId,
        name: 'test-skill',
        description: 'A test skill with sufficient description length',
        metadata: {},
        optimize: false,
        configuration_count: 10,
        clustering_interval: 15,
        reflection_min_requests_per_arm: 3,
        exploration_temperature: 1.0,
        last_clustering_at: null,
        last_clustering_log_start_time: null,
        evaluations_regenerated_at: null,
        evaluation_lock_acquired_at: null,
        total_requests: 0,
        created_at: 'invalid-date',
        updated_at: '2023-01-01T00:00:00.000Z',
      };

      expect(() => Skill.parse(skillData)).toThrow();
    });

    it('should require timezone offset in datetime strings', () => {
      const skillData = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        agent_id: testAgentId,
        name: 'test-skill',
        description: 'A test skill with sufficient description length',
        metadata: {},
        optimize: false,
        configuration_count: 10,
        clustering_interval: 15,
        reflection_min_requests_per_arm: 3,
        exploration_temperature: 1.0,
        last_clustering_at: null,
        last_clustering_log_start_time: null,
        evaluations_regenerated_at: null,
        evaluation_lock_acquired_at: null,
        total_requests: 0,
        created_at: '2023-01-01T00:00:00', // Missing timezone offset
        updated_at: '2023-01-01T00:00:00.000Z',
      };

      expect(() => Skill.parse(skillData)).toThrow();
    });
  });
});

describe('skills the gateway creates', () => {
  const minimal = {
    agent_id: '123e4567-e89b-12d3-a456-426614174000',
    name: 'concierge',
    description: 'y'.repeat(30),
    metadata: {},
    optimize: true,
  };

  it('are hand-made unless said otherwise', () => {
    const parsed = SkillCreateParams.parse(minimal);
    expect(parsed.auto_created).toBe(false);
    expect(parsed.seed_system_prompt).toBeUndefined();
  });

  it('keep the caller prompt they were seeded with', () => {
    const parsed = SkillCreateParams.parse({
      ...minimal,
      auto_created: true,
      seed_system_prompt: 'You are the concierge.',
    });
    expect(parsed.auto_created).toBe(true);
    expect(parsed.seed_system_prompt).toBe('You are the concierge.');
  });

  it('can have the seed prompt cleared on its own', () => {
    expect(SkillUpdateParams.parse({ seed_system_prompt: null })).toEqual({
      seed_system_prompt: null,
    });
  });

  it('carry both fields once stored', () => {
    expect(() =>
      Skill.parse({
        id: '123e4567-e89b-12d3-a456-426614174001',
        ...minimal,
        configuration_count: 3,
        clustering_interval: 15,
        reflection_min_requests_per_arm: 3,
        exploration_temperature: 1,
        last_clustering_at: null,
        last_clustering_log_start_time: null,
        evaluations_regenerated_at: null,
        evaluation_lock_acquired_at: null,
        total_requests: 0,
        allowed_template_variables: [],
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      }),
    ).toThrow();
  });
});

describe('SkillSummary', () => {
  const whole = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    agent_id: '123e4567-e89b-12d3-a456-426614174001',
    name: 'concierge',
    description: 'z'.repeat(30),
    metadata: {},
    optimize: false,
    configuration_count: 3,
    clustering_interval: 15,
    reflection_min_requests_per_arm: 3,
    exploration_temperature: 3.0,
    last_clustering_at: null,
    last_clustering_log_start_time: null,
    evaluations_regenerated_at: null,
    evaluation_lock_acquired_at: null,
    total_requests: 0,
    allowed_template_variables: [],
    auto_created: true,
    seed_system_prompt: 'You are the concierge.',
    created_at: '2023-01-01T00:00:00.000Z',
    updated_at: '2023-01-01T00:00:00.000Z',
  };

  it('reads a row that left the seed prompt out', () => {
    const { seed_system_prompt, ...summary } = whole;
    expect(seed_system_prompt).toBe('You are the concierge.');

    const parsed = SkillSummary.parse(summary);
    expect(parsed.name).toBe('concierge');
    expect(parsed.seed_system_prompt).toBeUndefined();
  });

  it('accepts a whole skill too, so one type serves both reads', () => {
    const parsed = SkillSummary.parse(whole);
    expect(parsed.seed_system_prompt).toBe('You are the concierge.');
  });

  it('names every column of a skill but that one', () => {
    expect(SKILL_SUMMARY_COLUMNS).toEqual(
      Object.keys(Skill.shape).filter((key) => key !== 'seed_system_prompt'),
    );
    // Derived from the schema, so a column added to `Skill` is read without
    // anyone remembering to add it here.
    expect(SKILL_SUMMARY_COLUMNS).toHaveLength(
      Object.keys(Skill.shape).length - 1,
    );
  });
});
