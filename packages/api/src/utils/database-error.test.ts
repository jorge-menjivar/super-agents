import {
  DatabaseError,
  getEntityErrorMessage,
  isDatabaseError,
  parseDatabaseError,
} from '@api/utils/database-error';
import { describe, expect, it } from 'vitest';

describe('parseDatabaseError', () => {
  describe('null and undefined inputs', () => {
    it('should return default error for null', () => {
      const result = parseDatabaseError(null);
      expect(result.message).toBe(
        'An unexpected database error occurred. Please try again.',
      );
      expect(result.statusCode).toBe(500);
    });

    it('should return default error for undefined', () => {
      const result = parseDatabaseError(undefined);
      expect(result.message).toBe(
        'An unexpected database error occurred. Please try again.',
      );
      expect(result.statusCode).toBe(500);
    });
  });

  describe('PostgreSQL error codes', () => {
    it('should parse unique constraint violation (23505)', () => {
      const error = new Error('Error 23505: duplicate key violation');
      const result = parseDatabaseError(error);
      expect(result.code).toBe('23505');
      expect(result.message).toBe('A record with this value already exists.');
      expect(result.statusCode).toBe(409);
    });

    it('should parse foreign key violation (23503)', () => {
      const error = new Error('Error 23503: foreign key constraint');
      const result = parseDatabaseError(error);
      expect(result.code).toBe('23503');
      expect(result.message).toBe('The referenced record does not exist.');
      expect(result.statusCode).toBe(409);
    });

    it('should parse not null violation (23502)', () => {
      const error = new Error('Error 23502: null value not allowed');
      const result = parseDatabaseError(error);
      expect(result.code).toBe('23502');
      expect(result.message).toBe('A required field is missing.');
      expect(result.statusCode).toBe(400);
    });

    it('should parse check constraint violation (23514)', () => {
      const error = new Error('Error 23514: check constraint violation');
      const result = parseDatabaseError(error);
      expect(result.code).toBe('23514');
      expect(result.message).toBe(
        'The value does not meet the required constraints.',
      );
      expect(result.statusCode).toBe(409);
    });

    it('should parse permission denied (42501)', () => {
      const error = new Error('Error 42501: permission denied');
      const result = parseDatabaseError(error);
      expect(result.code).toBe('42501');
      expect(result.message).toBe(
        'You do not have permission to perform this action.',
      );
      // Internal code is 403, but public code maps to 409
      expect(result.internalStatusCode).toBe(403);
      expect(result.statusCode).toBe(409);
    });

    it('should parse connection exception (08006)', () => {
      const error = new Error('Error 08006: connection failure');
      const result = parseDatabaseError(error);
      expect(result.code).toBe('08006');
      expect(result.message).toBe('Database connection failed.');
      // Internal code is 503, but public code maps to 500
      expect(result.internalStatusCode).toBe(503);
      expect(result.statusCode).toBe(500);
    });

    it('should parse deadlock detected (40P01) from JSON', () => {
      // Note: 40P01 contains a letter, so regex won't catch it from plain message
      // It needs to be in JSON format to be parsed correctly
      const pgError = { code: '40P01', message: 'deadlock detected' };
      const error = new Error(`PostgREST error: ${JSON.stringify(pgError)}`);
      const result = parseDatabaseError(error);
      expect(result.code).toBe('40P01');
      expect(result.message).toBe('A deadlock was detected. Please try again.');
      expect(result.statusCode).toBe(409);
    });
  });

  /**
   * A trigger refusing a write -- a model of the wrong type in a slot, a type
   * changed while in use -- used to reach the client as a 500 on both
   * backends. Its own message says what is wrong with the request.
   */
  describe('trigger refusals', () => {
    it('makes a SQLite trigger refusal a 400 in its own words', () => {
      const error = Object.assign(
        new Error(
          'SQLITE_CONSTRAINT: judge_model_id must reference a text model',
        ),
        {
          code: 'SQLITE_CONSTRAINT',
          extendedCode: 'SQLITE_CONSTRAINT_TRIGGER',
        },
      );

      expect(parseDatabaseError(error)).toEqual({
        message: 'judge_model_id must reference a text model',
        code: 'P0001',
        internalStatusCode: 400,
        statusCode: 400,
      });
    });

    it('knows one by its message when the extended code is lost', () => {
      const result = parseDatabaseError(
        new Error(
          'SQLITE_CONSTRAINT: cannot change model_type while the model is referenced',
        ),
      );

      expect(result.statusCode).toBe(400);
      expect(result.message).toBe(
        'cannot change model_type while the model is referenced',
      );
    });

    // The built-in constraint failures keep their own codes and messages.
    it('leaves the built-in constraint failures alone', () => {
      const result = parseDatabaseError(
        Object.assign(
          new Error('SQLITE_CONSTRAINT: UNIQUE constraint failed: agents.name'),
          { extendedCode: 'SQLITE_CONSTRAINT_UNIQUE' },
        ),
      );

      expect(result.code).toBe('23505');
      expect(result.statusCode).toBe(409);
    });

    // As the Supabase connector throws it: the status line, then the body.
    it('finds the refusal in what the Supabase connector throws', () => {
      const result = parseDatabaseError(
        new Error(
          `Failed to update in PostgREST:\n400 - Bad Request\n${JSON.stringify({
            code: 'P0001',
            details: null,
            hint: null,
            message: 'judge_model_id must reference a text model',
          })}`,
        ),
      );

      expect(result.statusCode).toBe(400);
      expect(result.message).toBe('judge_model_id must reference a text model');
    });

    it('makes a Postgres RAISE EXCEPTION a 400 in its own words', () => {
      const pgError = {
        code: 'P0001',
        message: 'judge_model_id must reference a text model',
        details: null,
        hint: null,
      };

      const result = parseDatabaseError(
        new Error(`PostgREST error: ${JSON.stringify(pgError)}`),
      );

      expect(result.statusCode).toBe(400);
      expect(result.message).toBe('judge_model_id must reference a text model');
    });
  });

  describe('SQLite / libSQL constraint errors', () => {
    // The libSQL backend reports constraint violations in SQLite's wording,
    // which shares nothing with PostgreSQL's SQLSTATE codes. Before these were
    // translated, every one of them surfaced to the client as a 500.
    it('should map a UNIQUE violation to 409 with the entity message', () => {
      const result = parseDatabaseError(
        new Error('SQLITE_CONSTRAINT: UNIQUE constraint failed: agents.name'),
      );

      expect(result.code).toBe('23505');
      expect(result.statusCode).toBe(409);
      expect(result.table).toBe('agents');
      expect(result.column).toBe('name');
      expect(result.message).toBe('An agent with this name already exists.');
    });

    it('should map a FOREIGN KEY violation to 409', () => {
      // SQLite names no table or column for this one.
      const result = parseDatabaseError(
        new Error('SQLITE_CONSTRAINT: FOREIGN KEY constraint failed'),
      );

      expect(result.code).toBe('23503');
      expect(result.statusCode).toBe(409);
      expect(result.message).toBe('The referenced record does not exist.');
    });

    it('should map a NOT NULL violation to 400 naming the column', () => {
      const result = parseDatabaseError(
        new Error(
          'SQLITE_CONSTRAINT: NOT NULL constraint failed: skills.agent_id',
        ),
      );

      expect(result.code).toBe('23502');
      expect(result.statusCode).toBe(400);
      expect(result.message).toBe('The field "agent_id" is required.');
    });

    it('should map a CHECK violation to 409', () => {
      const result = parseDatabaseError(
        new Error('SQLITE_CONSTRAINT: CHECK constraint failed: logs'),
      );

      expect(result.code).toBe('23514');
      expect(result.statusCode).toBe(409);
    });

    it('should reuse the skill entity message for a duplicate skill', () => {
      const result = parseDatabaseError(
        new Error('SQLITE_CONSTRAINT: UNIQUE constraint failed: skills.name'),
      );

      expect(result.message).toBe(
        'A skill with this name already exists for this agent.',
      );
    });

    it('should leave unrelated SQLite errors as a 500', () => {
      // Only constraint failures are safe to report as client errors; a
      // corrupt database or a missing table is genuinely the server's problem.
      const result = parseDatabaseError(
        new Error('SQLITE_ERROR: no such table: agents'),
      );

      expect(result.statusCode).toBe(500);
    });
  });

  describe('error message patterns', () => {
    it('should detect duplicate key in message', () => {
      const error = new Error('duplicate key value violates constraint');
      const result = parseDatabaseError(error);
      expect(result.message).toBe('A record with this value already exists.');
      expect(result.statusCode).toBe(409);
    });

    it('should detect unique constraint in message', () => {
      const error = new Error('unique constraint "users_email_key" violated');
      const result = parseDatabaseError(error);
      expect(result.message).toBe('A record with this value already exists.');
      expect(result.statusCode).toBe(409);
    });

    it('should detect foreign key constraint in message', () => {
      const error = new Error('violates foreign key constraint');
      const result = parseDatabaseError(error);
      expect(result.message).toBe(
        'The referenced record does not exist or cannot be modified.',
      );
      expect(result.statusCode).toBe(409);
    });

    it('should detect not-null constraint in message', () => {
      const error = new Error('not-null constraint violation');
      const result = parseDatabaseError(error);
      expect(result.message).toBe('A required field is missing.');
      expect(result.statusCode).toBe(400);
    });

    it('should detect 409 status in message', () => {
      const error = new Error('Request failed with status 409');
      const result = parseDatabaseError(error);
      expect(result.message).toBe(
        'The operation conflicts with existing data.',
      );
      expect(result.statusCode).toBe(409);
    });

    it('should detect 404 status in message', () => {
      const error = new Error('Request failed with status 404');
      const result = parseDatabaseError(error);
      expect(result.message).toBe('The requested resource was not found.');
      expect(result.statusCode).toBe(404);
    });
  });

  describe('PostgREST JSON errors', () => {
    it('should parse JSON error from Error message', () => {
      const pgError = {
        code: '23505',
        message: 'duplicate key value',
        constraint: 'users_email_key',
        table: 'users',
      };
      const error = new Error(`PostgREST error: ${JSON.stringify(pgError)}`);
      const result = parseDatabaseError(error);
      expect(result.code).toBe('23505');
      expect(result.constraint).toBe('users_email_key');
      expect(result.table).toBe('users');
      expect(result.statusCode).toBe(409);
    });

    it('should parse plain object error', () => {
      const pgError = {
        code: '23503',
        message: 'foreign key violation',
        table: 'skills',
      };
      const result = parseDatabaseError(pgError);
      expect(result.code).toBe('23503');
      expect(result.table).toBe('skills');
      expect(result.statusCode).toBe(409);
    });

    it('should use entity-specific message when available', () => {
      const pgError = {
        code: '23505',
        table: 'models',
      };
      const result = parseDatabaseError(pgError);
      expect(result.message).toBe(
        'A model with this name already exists for the selected AI provider.',
      );
    });

    it('should use entity-specific message for agents', () => {
      const pgError = {
        code: '23503',
        table: 'agents',
      };
      const result = parseDatabaseError(pgError);
      expect(result.message).toBe(
        'Cannot delete this agent because it has associated skills.',
      );
    });

    it('should add column context for not null violation', () => {
      const pgError = {
        code: '23502',
        column: 'model_name',
      };
      const result = parseDatabaseError(pgError);
      expect(result.message).toBe('The field "model_name" is required.');
    });
  });

  describe('constraint name patterns', () => {
    it('should recognize _pkey constraint', () => {
      const pgError = {
        code: '23505',
        constraint: 'users_pkey',
      };
      const result = parseDatabaseError(pgError);
      expect(result.message).toBe('A record with this ID already exists.');
    });

    it('should recognize _unique constraint', () => {
      const pgError = {
        code: '23505',
        constraint: 'users_email_unique',
      };
      const result = parseDatabaseError(pgError);
      expect(result.message).toBe('This value must be unique.');
    });

    it('should recognize _fkey constraint', () => {
      const pgError = {
        code: '23503',
        constraint: 'skills_agent_id_fkey',
      };
      const result = parseDatabaseError(pgError);
      expect(result.message).toBe(
        'The referenced record does not exist or cannot be deleted.',
      );
    });
  });
});

describe('getEntityErrorMessage', () => {
  it('should return entity-specific create error for agents', () => {
    const error = { code: '23505' };
    const result = getEntityErrorMessage('agents', 'create', error);
    expect(result).toBe('An agent with this name already exists.');
  });

  it('should return entity-specific delete error for agents', () => {
    const error = { code: '23503' };
    const result = getEntityErrorMessage('agents', 'delete', error);
    expect(result).toBe(
      'Cannot delete this agent because it has skills. Delete the skills first.',
    );
  });

  it('should return entity-specific create error for models', () => {
    const error = { code: '23505' };
    const result = getEntityErrorMessage('models', 'create', error);
    expect(result).toBe(
      'A model with this name already exists for the selected provider.',
    );
  });

  it('should return entity-specific delete error for models', () => {
    const error = { code: '23503' };
    const result = getEntityErrorMessage('models', 'delete', error);
    expect(result).toBe(
      'Cannot delete this model because it is used by skills. Remove it from all skills first.',
    );
  });

  it('should return default error for unknown entity', () => {
    const error = { code: '23505' };
    const result = getEntityErrorMessage('unknown_entity', 'create', error);
    expect(result).toBe('A record with this value already exists.');
  });

  it('should return default error for unknown operation', () => {
    const error = { code: '23505' };
    const result = getEntityErrorMessage('agents', 'update', error);
    expect(result).toBe('A record with this value already exists.');
  });
});

describe('DatabaseError class', () => {
  it('should create DatabaseError with all properties', () => {
    const originalError = {
      code: '23505',
      constraint: 'users_email_key',
      table: 'users',
      column: 'email',
    };
    const dbError = new DatabaseError(originalError, 'users');

    expect(dbError.name).toBe('DatabaseError');
    expect(dbError.code).toBe('23505');
    expect(dbError.constraint).toBe('users_email_key');
    expect(dbError.table).toBe('users');
    expect(dbError.column).toBe('email');
    expect(dbError.statusCode).toBe(409);
  });

  it('should use provided entity over parsed table', () => {
    const originalError = { code: '23505', table: 'users' };
    const dbError = new DatabaseError(originalError, 'custom_entity');
    expect(dbError.table).toBe('custom_entity');
  });

  it('should be an instance of Error', () => {
    const dbError = new DatabaseError({ code: '23505' });
    expect(dbError).toBeInstanceOf(Error);
  });

  it('should have userMessage property', () => {
    const dbError = new DatabaseError({ code: '23505' });
    expect(dbError.userMessage).toBe(
      'A record with this value already exists.',
    );
  });
});

describe('isDatabaseError', () => {
  it('should return true for DatabaseError instance', () => {
    const dbError = new DatabaseError({ code: '23505' });
    expect(isDatabaseError(dbError)).toBe(true);
  });

  it('should return false for regular Error', () => {
    const error = new Error('some error');
    expect(isDatabaseError(error)).toBe(false);
  });

  it('should return false for null', () => {
    expect(isDatabaseError(null)).toBe(false);
  });

  it('should return false for undefined', () => {
    expect(isDatabaseError(undefined)).toBe(false);
  });

  it('should return false for plain object', () => {
    const obj = { code: '23505', message: 'error' };
    expect(isDatabaseError(obj)).toBe(false);
  });
});

describe('HTTP status code mapping', () => {
  it('should return 400 for data exceptions (22xxx)', () => {
    const error = new Error('Error 22001: value too long');
    const result = parseDatabaseError(error);
    expect(result.internalStatusCode).toBe(400);
    expect(result.statusCode).toBe(400);
  });

  it('should return 409 for integrity constraints (23xxx)', () => {
    const error = new Error('Error 23000: constraint violation');
    const result = parseDatabaseError(error);
    expect(result.internalStatusCode).toBe(409);
    expect(result.statusCode).toBe(409);
  });

  it('should return 400 for not null violation (23502)', () => {
    const error = new Error('Error 23502: not null');
    const result = parseDatabaseError(error);
    expect(result.internalStatusCode).toBe(400);
    expect(result.statusCode).toBe(400);
  });

  it('should map 403 permission denied to 409 public code (42501)', () => {
    const error = new Error('Error 42501: permission denied');
    const result = parseDatabaseError(error);
    expect(result.internalStatusCode).toBe(403);
    expect(result.statusCode).toBe(409); // Public code maps 403 -> 409
  });

  it('should return 400 for other syntax errors (42xxx)', () => {
    const error = new Error('Error 42601: syntax error');
    const result = parseDatabaseError(error);
    expect(result.internalStatusCode).toBe(400);
    expect(result.statusCode).toBe(400);
  });

  it('should map 503 connection exceptions to 500 public code (08xxx)', () => {
    const error = new Error('Error 08000: connection exception');
    const result = parseDatabaseError(error);
    expect(result.internalStatusCode).toBe(503);
    expect(result.statusCode).toBe(500); // Public code maps 503 -> 500
  });

  it('should map 503 insufficient resources to 500 public code (53xxx)', () => {
    const error = new Error('Error 53000: insufficient resources');
    const result = parseDatabaseError(error);
    expect(result.internalStatusCode).toBe(503);
    expect(result.statusCode).toBe(500); // Public code maps 503 -> 500
  });

  it('should return 409 for transaction rollback (40xxx)', () => {
    const error = new Error('Error 40001: serialization failure');
    const result = parseDatabaseError(error);
    expect(result.internalStatusCode).toBe(409);
    expect(result.statusCode).toBe(409);
  });

  it('should return 500 for unknown error codes', () => {
    const error = new Error('Error 99999: unknown error');
    const result = parseDatabaseError(error);
    expect(result.internalStatusCode).toBe(500);
    expect(result.statusCode).toBe(500);
  });
});
