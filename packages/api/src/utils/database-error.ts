/**
 * Database error handling utilities
 *
 * Parses PostgreSQL/PostgREST and SQLite/libSQL error responses and converts
 * them to user-friendly messages. SQLite errors are translated into the
 * PostgreSQL codes below so that both storage backends produce the same
 * messages and the same HTTP status codes.
 * PostgreSQL error codes: https://www.postgresql.org/docs/current/errcodes-appendix.html
 */

/** PostgreSQL error codes mapped to user-friendly messages */
const PG_ERROR_MESSAGES: Record<string, string> = {
  // Class 23 - Integrity Constraint Violation
  '23000': 'A database constraint was violated.',
  '23001': 'Cannot delete or update due to existing references.',
  '23502': 'A required field is missing.',
  '23503': 'The referenced record does not exist.',
  '23505': 'A record with this value already exists.',
  '23514': 'The value does not meet the required constraints.',
  '23P01': 'Cannot delete or update due to existing references.',

  // Class 22 - Data Exception
  '22000': 'Invalid data provided.',
  '22001': 'The value is too long for this field.',
  '22003': 'The number is out of range.',
  '22007': 'Invalid date or time format.',
  '22008': 'Date or time value is out of range.',
  '22012': 'Cannot divide by zero.',
  '22P02': 'Invalid data format.',

  // Class 42 - Syntax Error or Access Rule Violation
  '42000': 'Database operation failed.',
  '42501': 'You do not have permission to perform this action.',
  '42601': 'Invalid request syntax.',
  '42703': 'Unknown field specified.',
  '42P01': 'The requested resource does not exist.',

  // Class 08 - Connection Exception
  '08000': 'Unable to connect to the database.',
  '08003': 'Database connection was lost.',
  '08006': 'Database connection failed.',

  // Class 53 - Insufficient Resources
  '53000': 'The server is temporarily overloaded.',
  '53100': 'The server is out of disk space.',
  '53200': 'The server is out of memory.',
  '53300': 'Too many connections to the database.',

  // Class 40 - Transaction Rollback
  '40000': 'The operation was rolled back.',
  '40001': 'The operation conflicted with another operation. Please try again.',
  '40P01': 'A deadlock was detected. Please try again.',
};

/** Common constraint name patterns mapped to user-friendly messages */
const CONSTRAINT_MESSAGES: Record<string, string> = {
  // Primary key violations
  _pkey: 'A record with this ID already exists.',

  // Unique constraint violations
  _unique: 'This value must be unique.',
  _key: 'This value must be unique.',

  // Foreign key violations
  _fkey: 'The referenced record does not exist or cannot be deleted.',

  // Check constraint violations
  _check: 'The value does not meet the required constraints.',

  // Not null violations
  _not_null: 'This field is required.',
};

/** Entity-specific error messages for common operations */
const ENTITY_MESSAGES: Record<string, Record<string, string>> = {
  agents: {
    '23505': 'An agent with this name already exists.',
    '23503': 'Cannot delete this agent because it has associated skills.',
  },
  skills: {
    '23505': 'A skill with this name already exists for this agent.',
    '23503':
      'Cannot delete this skill because it has associated data (logs, evaluations, etc.).',
  },
  models: {
    '23505':
      'A model with this name already exists for the selected AI provider.',
    '23503':
      'Cannot delete this model because it is being used by one or more skills.',
  },
  ai_provider_api_keys: {
    '23505': 'An API key with this name already exists.',
    '23503':
      'Cannot delete this API key because it has associated models. Delete the models first.',
  },
  skill_optimization_evaluations: {
    '23505': 'This evaluation already exists for this skill.',
    '23503': 'The referenced skill or model does not exist.',
  },
  system_settings: {
    '23503': 'The selected model does not exist.',
  },
  feedback: {
    '23503': 'The referenced log does not exist.',
  },
  improved_responses: {
    '23503': 'The referenced log does not exist.',
  },
};

/**
 * SQLite constraint failures, keyed by the PostgreSQL code they correspond to.
 *
 * The libSQL backend reports violations in SQLite's wording -- "UNIQUE
 * constraint failed: agents.name" -- which shares no vocabulary with
 * PostgreSQL's SQLSTATE codes. Translating here rather than at each call site
 * keeps one set of messages and status codes for both backends. Without it
 * every constraint violation on libSQL falls through to a 500, because the
 * message checks further down look for PostgreSQL's lowercase phrasing
 * ("unique constraint") and SQLite shouts its own ("UNIQUE constraint").
 */
const SQLITE_CONSTRAINT_CODES: ReadonlyArray<readonly [RegExp, string]> = [
  [/UNIQUE constraint failed/i, '23505'],
  [/FOREIGN KEY constraint failed/i, '23503'],
  [/NOT NULL constraint failed/i, '23502'],
  [/CHECK constraint failed/i, '23514'],
];

/**
 * SQLite names the offending column as `table.column`, which is enough to
 * reuse the same entity-specific messages the PostgREST path produces. A
 * foreign key failure reports no target at all, so both stay optional.
 */
function parseSqliteError(message: string): DatabaseErrorInfo | undefined {
  const matched = SQLITE_CONSTRAINT_CODES.find(([pattern]) =>
    pattern.test(message),
  );
  if (!matched) {
    return undefined;
  }

  const target = message.match(
    /constraint failed:\s*([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)/,
  );

  return parsePostgrestError({
    code: matched[1],
    table: target?.[1],
    column: target?.[2],
  });
}

/**
 * The SQLSTATE of a `RAISE EXCEPTION` that names none, which is how every
 * trigger and function in `supabase/migrations/` refuses a write.
 */
const RAISED_EXCEPTION = 'P0001';

/**
 * A trigger's refusal: `RAISE(ABORT, ...)` on SQLite, `RAISE EXCEPTION` on
 * Postgres. It is the schema saying why a write cannot happen -- a model of
 * the wrong type in a slot, a type changed while in use -- in words written
 * for whoever asked for it, so it is the caller's request that is wrong: a
 * 400, and the trigger's own message, the same on both backends.
 */
function raisedByTrigger(message: string): DatabaseErrorInfo {
  return {
    message,
    code: RAISED_EXCEPTION,
    internalStatusCode: 400,
    statusCode: 400,
  };
}

/**
 * A SQLite trigger's refusal. libSQL reports it as `SQLITE_CONSTRAINT` with
 * the trigger's message and an extended code to say it was a trigger; the
 * message alone also says so, once the four built-in constraint failures
 * have been ruled out.
 */
function parseSqliteTrigger(error: Error): DatabaseErrorInfo | undefined {
  const prefix = /^SQLITE_CONSTRAINT(?:_TRIGGER)?:\s*/;
  const extendedCode = (error as { extendedCode?: unknown }).extendedCode;
  if (
    extendedCode !== 'SQLITE_CONSTRAINT_TRIGGER' &&
    !prefix.test(error.message)
  ) {
    return undefined;
  }
  const message = error.message.replace(prefix, '').trim();
  return message ? raisedByTrigger(message) : undefined;
}

/** Public HTTP status codes for API responses */
export type PublicStatusCode = 400 | 404 | 409 | 500;

export interface DatabaseErrorInfo {
  /** User-friendly error message */
  message: string;
  /** Original error code (if available) - internal use only */
  code?: string;
  /** Constraint name (if available) - internal use only */
  constraint?: string;
  /** Table name (if available) - internal use only */
  table?: string;
  /** Column name (if available) - internal use only */
  column?: string;
  /** Internal status code for logging */
  internalStatusCode: number;
  /** Public HTTP status code to return to clients */
  statusCode: PublicStatusCode;
}

interface PostgrestError {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
  constraint?: string;
  table?: string;
  column?: string;
}

/**
 * Convert internal status code to public status code
 * Maps detailed internal codes to a simplified public set
 */
function toPublicStatusCode(internalCode: number): PublicStatusCode {
  switch (internalCode) {
    case 400:
      return 400; // Bad Request (validation errors)
    case 404:
      return 404; // Not Found
    case 403:
    case 409:
      return 409; // Conflict (constraint violations, permission issues mapped to conflict)
    default:
      return 500; // Internal Server Error (connection issues, unknown errors, 503)
  }
}

/**
 * Parse a PostgreSQL/PostgREST error and return user-friendly information
 */
export function parseDatabaseError(error: unknown): DatabaseErrorInfo {
  // Default error info
  const defaultError: DatabaseErrorInfo = {
    message: 'An unexpected database error occurred. Please try again.',
    internalStatusCode: 500,
    statusCode: 500,
  };

  if (!error) {
    return defaultError;
  }

  // Handle Error objects
  if (error instanceof Error) {
    const errorMessage = error.message;

    // Checked before the PostgREST parsing below: a SQLite message carries no
    // JSON and no SQLSTATE, so it would otherwise reach the generic patterns
    // and be reported as an unexplained 500.
    const sqliteError = parseSqliteError(errorMessage);
    if (sqliteError) {
      return sqliteError;
    }
    const sqliteTrigger = parseSqliteTrigger(error);
    if (sqliteTrigger) {
      return sqliteTrigger;
    }

    // Try to extract JSON error from PostgREST response
    const jsonMatch = errorMessage.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const pgError = JSON.parse(jsonMatch[0]) as PostgrestError;
        return parsePostgrestError(pgError);
      } catch {
        // JSON parsing failed, continue with string parsing
      }
    }

    // Try to extract error code from message
    const codeMatch = errorMessage.match(/\b([0-9]{5})\b/);
    if (codeMatch) {
      const code = codeMatch[1];
      const internalCode = getStatusCodeForPgCode(code);
      return {
        message: PG_ERROR_MESSAGES[code] || defaultError.message,
        code,
        internalStatusCode: internalCode,
        statusCode: toPublicStatusCode(internalCode),
      };
    }

    // Check for common error patterns in the message
    if (
      errorMessage.includes('duplicate key') ||
      errorMessage.includes('unique constraint')
    ) {
      return {
        message: 'A record with this value already exists.',
        code: '23505',
        internalStatusCode: 409,
        statusCode: 409,
      };
    }

    if (
      errorMessage.includes('foreign key constraint') ||
      errorMessage.includes('violates foreign key')
    ) {
      return {
        message: 'The referenced record does not exist or cannot be modified.',
        code: '23503',
        internalStatusCode: 409,
        statusCode: 409,
      };
    }

    if (
      errorMessage.includes('not-null constraint') ||
      errorMessage.includes('null value')
    ) {
      return {
        message: 'A required field is missing.',
        code: '23502',
        internalStatusCode: 400,
        statusCode: 400,
      };
    }

    if (errorMessage.includes('409')) {
      return {
        message: 'The operation conflicts with existing data.',
        internalStatusCode: 409,
        statusCode: 409,
      };
    }

    if (errorMessage.includes('404')) {
      return {
        message: 'The requested resource was not found.',
        internalStatusCode: 404,
        statusCode: 404,
      };
    }

    return defaultError;
  }

  // Handle plain objects (e.g., parsed JSON)
  if (typeof error === 'object') {
    return parsePostgrestError(error as PostgrestError);
  }

  return defaultError;
}

/**
 * Parse a PostgREST error object
 */
function parsePostgrestError(pgError: PostgrestError): DatabaseErrorInfo {
  const { code, constraint, table, column, message, details } = pgError;

  if (code === RAISED_EXCEPTION && message) {
    return { ...raisedByTrigger(message), table, column };
  }

  const internalCode = code ? getStatusCodeForPgCode(code) : 500;
  const result: DatabaseErrorInfo = {
    message: 'An unexpected database error occurred.',
    code,
    constraint,
    table,
    column,
    internalStatusCode: internalCode,
    statusCode: toPublicStatusCode(internalCode),
  };

  // Try entity-specific message first
  if (code && table && ENTITY_MESSAGES[table]?.[code]) {
    result.message = ENTITY_MESSAGES[table][code];
    return result;
  }

  // Try constraint-specific message
  if (constraint) {
    for (const [pattern, msg] of Object.entries(CONSTRAINT_MESSAGES)) {
      if (constraint.includes(pattern)) {
        result.message = msg;
        return result;
      }
    }
  }

  // Try error code message
  if (code && PG_ERROR_MESSAGES[code]) {
    result.message = PG_ERROR_MESSAGES[code];

    // Add column context if available
    if (column && code === '23502') {
      result.message = `The field "${column}" is required.`;
    }

    return result;
  }

  // Use original message if it's user-friendly enough
  if (message && !message.includes('ERROR:') && message.length < 200) {
    result.message = message;
    return result;
  }

  // Use details if available and user-friendly
  if (details && !details.includes('Key (') && details.length < 200) {
    result.message = details;
    return result;
  }

  return result;
}

/**
 * Get appropriate HTTP status code for a PostgreSQL error code
 */
function getStatusCodeForPgCode(code: string): number {
  const codeClass = code.substring(0, 2);

  switch (codeClass) {
    case '23': // Integrity Constraint Violation
      return code === '23502' ? 400 : 409; // Not null -> 400, others -> 409
    case '22': // Data Exception
      return 400;
    case '42': // Syntax Error or Access Rule Violation
      return code === '42501' ? 403 : 400;
    case '08': // Connection Exception
    case '53': // Insufficient Resources
      return 503;
    case '40': // Transaction Rollback
      return 409;
    default:
      return 500;
  }
}

/**
 * Get a user-friendly error message for a specific entity and operation
 */
export function getEntityErrorMessage(
  entity: string,
  operation: 'create' | 'update' | 'delete',
  error: unknown,
): string {
  const errorInfo = parseDatabaseError(error);

  // Entity-specific operation messages
  const operationMessages: Record<
    string,
    Record<string, Record<string, string>>
  > = {
    agents: {
      create: {
        '23505': 'An agent with this name already exists.',
        default: 'Failed to create agent. Please try again.',
      },
      delete: {
        '23503':
          'Cannot delete this agent because it has skills. Delete the skills first.',
        default: 'Failed to delete agent. Please try again.',
      },
    },
    skills: {
      create: {
        '23505': 'A skill with this name already exists for this agent.',
        default: 'Failed to create skill. Please try again.',
      },
      delete: {
        '23503':
          'Cannot delete this skill because it has associated data. Try archiving it instead.',
        default: 'Failed to delete skill. Please try again.',
      },
    },
    models: {
      create: {
        '23505':
          'A model with this name already exists for the selected provider.',
        default: 'Failed to create model. Please try again.',
      },
      delete: {
        '23503':
          'Cannot delete this model because it is used by skills. Remove it from all skills first.',
        default: 'Failed to delete model. Please try again.',
      },
    },
    ai_providers: {
      create: {
        '23505': 'An API key with this name already exists.',
        default: 'Failed to create API key. Please try again.',
      },
      delete: {
        '23503':
          'Cannot delete this API key because it has models. Delete the models first.',
        default: 'Failed to delete API key. Please try again.',
      },
    },
  };

  const entityMessages = operationMessages[entity]?.[operation];
  if (entityMessages) {
    if (errorInfo.code && entityMessages[errorInfo.code]) {
      return entityMessages[errorInfo.code];
    }
    return entityMessages.default || errorInfo.message;
  }

  return errorInfo.message;
}

/**
 * Custom error class for database errors with user-friendly messages
 */
export class DatabaseError extends Error {
  public readonly code?: string;
  public readonly constraint?: string;
  public readonly table?: string;
  public readonly column?: string;
  public readonly statusCode: PublicStatusCode;
  public readonly userMessage: string;

  constructor(error: unknown, entity?: string) {
    const errorInfo = parseDatabaseError(error);

    super(errorInfo.message);
    this.name = 'DatabaseError';
    this.code = errorInfo.code;
    this.constraint = errorInfo.constraint;
    this.table = entity || errorInfo.table;
    this.column = errorInfo.column;
    this.statusCode = errorInfo.statusCode;
    this.userMessage = errorInfo.message;

    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, DatabaseError);
    }
  }
}

/**
 * Check if an error is a database error
 */
export function isDatabaseError(error: unknown): error is DatabaseError {
  return error instanceof DatabaseError;
}
