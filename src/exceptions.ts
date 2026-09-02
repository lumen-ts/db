/** Machine-readable database error codes. */
export const DatabaseErrorCodes = {
  CONNECT_ERROR: 'DATABASE_CONNECT_ERROR',
  QUERY_ERROR: 'DATABASE_QUERY_ERROR',
  TRANSACTION_ERROR: 'DATABASE_TRANSACTION_ERROR',
  CONFIG_ERROR: 'DATABASE_CONFIG_ERROR',
  INVALID_IDENTIFIER: 'DATABASE_INVALID_IDENTIFIER',
  CONNECTION_NOT_FOUND: 'DATABASE_CONNECTION_NOT_FOUND',
  UNSUPPORTED_OPERATION: 'DATABASE_UNSUPPORTED_OPERATION',
} as const;

export type DatabaseErrorCode = (typeof DatabaseErrorCodes)[keyof typeof DatabaseErrorCodes];

/**
 * A framework-level error for database failures. Carries a machine-readable
 * code plus optional details (SQL, driver message, params) so middlewares can
 * normalize it into an `HttpException` payload.
 */
export class DatabaseException extends Error {
  constructor(
    message: string,
    public readonly code: DatabaseErrorCode = 'DATABASE_QUERY_ERROR',
    public readonly details?: unknown,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'DatabaseException';
  }

  toPayload(requestId?: string): { statusCode: number; code: string; message: string; details?: unknown; requestId?: string } {
    const payload: { statusCode: number; code: string; message: string; details?: unknown; requestId?: string } = {
      statusCode: 500,
      code: this.code,
      message: this.message,
    };
    if (this.details !== undefined) payload.details = this.details;
    if (requestId !== undefined) payload.requestId = requestId;
    return payload;
  }
}

/** Converts an arbitrary thrown value into a `DatabaseException` while preserving raw causes. */
export function toDatabaseException(
  error: unknown,
  fallback: DatabaseErrorCode,
  details?: unknown,
): DatabaseException {
  if (error instanceof DatabaseException) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new DatabaseException(message, fallback, details, { cause: error });
}