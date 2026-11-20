import type { ErrorCode, ValidationIssue } from '@metaflow/shared';

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  INVALID_CREDENTIALS: 401,
  FORBIDDEN: 403,
  PERMISSION_DENIED: 403,
  NOT_FOUND: 404,
  EMAIL_TAKEN: 409,
  LIMIT_REACHED: 409,
  PAYLOAD_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  INTEGRATION_ERROR: 502,
  INTEGRATION_NOT_CONFIGURED: 503,
  SERVICE_UNAVAILABLE: 503,
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
