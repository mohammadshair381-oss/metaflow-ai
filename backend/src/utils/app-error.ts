import type { ErrorCode, ValidationIssue } from '@metaflow/shared';

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  VALIDATION_ERROR: 400,
  NOT_FOUND: 404,
  PAYLOAD_TOO_LARGE: 413,
  INTERNAL_ERROR: 500,
};

/**
 * An error that is safe to show to API clients. Services and controllers throw it;
 * the central error handler turns it into the shared error envelope.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: ValidationIssue[] | undefined;

  constructor(
    code: ErrorCode,
    message: string,
    options: { details?: ValidationIssue[]; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = options.details;
  }

  static validation(details: ValidationIssue[]): AppError {
    return new AppError('VALIDATION_ERROR', 'Request validation failed', { details });
  }
}
