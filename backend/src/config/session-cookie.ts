import type { CookieOptions } from 'express';
import type { Env } from './env';

export interface SessionCookieConfig {
  name: string;
  /** Lifetime of new sessions in milliseconds; the cookie expires with the session. */
  ttlMs: number;
  /** Attributes used both to set (plus `expires`) and to clear the cookie. */
  attributes: CookieOptions;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Session cookie: HttpOnly (unreadable by JavaScript), SameSite (configurable, default Lax),
 * Secure in production. In production the name uses the `__Host-` prefix, which makes the
 * browser enforce Secure, Path=/ and no Domain, so no other subdomain can set or read it.
 */
export function createSessionCookieConfig(
  env: Pick<Env, 'NODE_ENV' | 'SESSION_TTL_DAYS' | 'SESSION_COOKIE_SAMESITE'>,
): SessionCookieConfig {
  const secure = env.NODE_ENV === 'production';
  return {
    name: secure ? '__Host-metaflow_session' : 'metaflow_session',
    ttlMs: env.SESSION_TTL_DAYS * DAY_MS,
    attributes: { httpOnly: true, secure, sameSite: env.SESSION_COOKIE_SAMESITE, path: '/' },
  };
}
