import type { RequestHandler } from 'express';
import type { SessionCookieConfig } from '../config/session-cookie';
import type { AuthService } from '../services/auth.service';
import { AppError } from '../utils/app-error';
import { readCookie } from '../utils/cookies';

/**
 * Rejects requests without a valid session (401 UNAUTHENTICATED) and exposes the verified
 * user as `res.locals.auth`. Identity always comes from the server-side session, never from
 * IDs supplied by the client.
 */
export function createRequireAuth(
  authService: AuthService,
  cookie: SessionCookieConfig,
): RequestHandler {
  return async (req, res, next) => {
    const token = readCookie(req.headers.cookie, cookie.name);
    const auth = await authService.authenticate(token);
    if (!auth) {
      // A stale or tampered cookie is cleared so the browser stops sending it.
      if (token !== undefined) res.clearCookie(cookie.name, cookie.attributes);
      throw new AppError('UNAUTHENTICATED', 'Sign in to continue');
    }
    res.locals.auth = auth;
    next();
  };
}
