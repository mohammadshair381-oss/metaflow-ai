import { loginRequestSchema, registerRequestSchema, type AuthUserResponse } from '@metaflow/shared';
import type { RequestHandler, Response } from 'express';
import type { SessionCookieConfig } from '../config/session-cookie';
import { toAuthUser, type AuthService, type IssuedSession } from '../services/auth.service';
import { AppError } from '../utils/app-error';
import { readCookie } from '../utils/cookies';
import { parseRequest } from '../validators/parse-request';

export interface AuthController {
  register: RequestHandler;
  login: RequestHandler;
  logout: RequestHandler;
  logoutAll: RequestHandler;
  me: RequestHandler;
}

/** HTTP adapter for the auth service: validation, cookies and status codes only. */
export function createAuthController(
  service: AuthService,
  cookie: SessionCookieConfig,
): AuthController {
  // The cookie expires exactly when the server-side session does.
  const setSessionCookie = (res: Response, session: IssuedSession) => {
    res.cookie(cookie.name, session.token, { ...cookie.attributes, expires: session.expiresAt });
  };
  const clearSessionCookie = (res: Response) => res.clearCookie(cookie.name, cookie.attributes);
  const currentUser = (res: Response) => {
    const auth = res.locals.auth;
    if (!auth) throw new AppError('UNAUTHENTICATED', 'Sign in to continue');
    return auth.user;
  };

  return {
    register: async (req, res) => {
      const { body } = parseRequest(req, { body: registerRequestSchema });
      const session = await service.register(body);
      setSessionCookie(res, session);
      const payload: AuthUserResponse = { user: toAuthUser(session.user) };
      res.status(201).json(payload);
    },

    login: async (req, res) => {
      const { body } = parseRequest(req, { body: loginRequestSchema });
      const previousToken = readCookie(req.headers.cookie, cookie.name);
      const session = await service.login(body, { previousToken });
      setSessionCookie(res, session);
      const payload: AuthUserResponse = { user: toAuthUser(session.user) };
      res.status(200).json(payload);
    },

    logout: async (req, res) => {
      await service.logout(readCookie(req.headers.cookie, cookie.name));
      clearSessionCookie(res);
      res.status(204).end();
    },

    logoutAll: async (_req, res) => {
      await service.logoutAll(currentUser(res).id);
      clearSessionCookie(res);
      res.status(204).end();
    },

    me: (_req, res) => {
      const payload: AuthUserResponse = { user: toAuthUser(currentUser(res)) };
      res.status(200).json(payload);
    },
  };
}
