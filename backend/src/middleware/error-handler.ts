import type { ApiErrorResponse } from '@metaflow/shared';
import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { toValidationIssues } from '../validators/parse-request';
import { AppError } from '../utils/app-error';
import type { Logger } from '../utils/logger';

/** Shape of errors raised by Express's body parser (http-errors). */
interface BodyParserError {
  type: string;
  status: number;
}

function isBodyParserError(error: unknown): error is BodyParserError {
  return (
    error instanceof Error &&
    typeof (error as Partial<BodyParserError>).type === 'string' &&
    typeof (error as Partial<BodyParserError>).status === 'number'
  );
}

const DATABASE_UNAVAILABLE_ERRORS = new Set([
  'MongooseServerSelectionError',
  'MongoServerSelectionError',
  'MongoNetworkError',
  'MongoNetworkTimeoutError',
  'MongoNotConnectedError',
]);

/**
 * True when MongoDB is unreachable rather than the request being wrong. With bufferCommands
 * off, Mongoose fails fast with a MongooseError naming the missing initial connection.
 */
function isDatabaseUnavailable(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (DATABASE_UNAVAILABLE_ERRORS.has(error.name)) return true;
  return error.name === 'MongooseError' && /initial connection|bufferCommands/i.test(error.message);
}

/** Map anything thrown in the app to a client-safe AppError. */
export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;

  if (isDatabaseUnavailable(error)) {
    return new AppError(
      'SERVICE_UNAVAILABLE',
      'The service is temporarily unavailable. Try again shortly.',
      {
        cause: error,
      },
    );
  }

  if (error instanceof ZodError) {
    return AppError.validation(toValidationIssues(error));
  }

  if (isBodyParserError(error)) {
    switch (error.type) {
      case 'entity.parse.failed':
        return new AppError('BAD_REQUEST', 'Request body is not valid JSON', { cause: error });
      case 'entity.too.large':
        return new AppError('PAYLOAD_TOO_LARGE', 'Request body is too large', { cause: error });
      default:
        if (error.status >= 400 && error.status < 500) {
          return new AppError('BAD_REQUEST', 'Request could not be processed', { cause: error });
        }
    }
  }

  return new AppError('INTERNAL_ERROR', 'An unexpected error occurred', { cause: error });
}

/**
 * Central error handler. Every error response uses the shared envelope:
 *   { "error": { "code", "message", "requestId", "details"? } }
 * Internal error messages and stack traces are logged server-side, never sent to clients.
 */
export function createErrorHandler(logger: Logger): ErrorRequestHandler {
  return (error: unknown, req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }

    const appError = toAppError(error);
    const requestId = res.locals.requestId;

    if (appError.status >= 500) {
      logger.error('http.unhandled_error', {
        requestId,
        method: req.method,
        path: req.path,
        error,
      });
    }

    const body: ApiErrorResponse = {
      error: {
        code: appError.code,
        message: appError.message,
        requestId,
        ...(appError.details ? { details: appError.details } : {}),
      },
    };
    res.status(appError.status).json(body);
  };
}
