import type { RequestHandler } from 'express';
import { AppError } from '../utils/app-error';

/** Catch-all for unmatched routes; hands a NOT_FOUND error to the central error handler. */
export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(new AppError('NOT_FOUND', 'Route not found'));
};
