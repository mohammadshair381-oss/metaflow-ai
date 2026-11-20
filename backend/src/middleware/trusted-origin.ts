import type { RequestHandler } from 'express';
import { AppError } from '../utils/app-error';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence for cookie-authenticated requests: a state-changing request (POST, PUT, PATCH,
 * DELETE) that carries an Origin header must come from an allowed origin. Browsers always send
 * Origin on such requests, so a forged cross-site form or fetch is refused with 403 even if it
 * would carry the session cookie. Requests without Origin (curl, server-to-server) carry no
 * browser cookies by accident and are passed through. Works together with SameSite cookies.
 */
export function requireTrustedOrigin(allowedOrigins: readonly string[]): RequestHandler {
  const allowed = new Set(allowedOrigins);
  return (req, _res, next) => {
    if (SAFE_METHODS.has(req.method)) return next();
    const origin = req.get('origin');
    if (origin === undefined || allowed.has(origin)) return next();
    next(new AppError('FORBIDDEN', 'Request origin is not allowed'));
  };
}
