import { emailSchema } from '@metaflow/shared';
import type { RequestHandler } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { AppError } from '../utils/app-error';

export interface AuthRateLimits {
  windowMs: number;
  /** Register + login attempts per client IP per window. */
  perIp: number;
  /** FAILED login attempts per account per window (successful logins do not count). */
  failedLoginsPerAccount: number;
}

export const DEFAULT_AUTH_RATE_LIMITS: AuthRateLimits = {
  windowMs: 15 * 60 * 1000,
  perIp: 30,
  failedLoginsPerAccount: 10,
};

export interface AuthRateLimiters {
  perIp: RequestHandler;
  failedLoginsPerAccount: RequestHandler;
}

const rejectWith429: RequestHandler = (_req, _res, next) => {
  next(new AppError('RATE_LIMITED', 'Too many attempts. Wait a few minutes and try again.'));
};

/**
 * In-memory limiters: correct for a single backend instance (the current deployment).
 * Counters reset on restart. Running several instances needs a shared store (e.g. Redis).
 * Client IPs are only accurate when TRUST_PROXY matches the proxy setup (Render: 1).
 */
export function createAuthRateLimiters(
  limits: AuthRateLimits = DEFAULT_AUTH_RATE_LIMITS,
): AuthRateLimiters {
  return {
    perIp: rateLimit({
      windowMs: limits.windowMs,
      limit: limits.perIp,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      keyGenerator: (req) => `ip:${ipKeyGenerator(req.ip ?? 'unknown')}`,
      handler: rejectWith429,
    }),
    failedLoginsPerAccount: rateLimit({
      windowMs: limits.windowMs,
      limit: limits.failedLoginsPerAccount,
      skipSuccessfulRequests: true,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      // Keyed by the normalized email, so guessing one account's password from many IPs is
      // still capped. The body is validated, not trusted: invalid input shares one bucket.
      keyGenerator: (req) => {
        const email = emailSchema.safeParse((req.body as { email?: unknown } | undefined)?.email);
        return `login:${email.success ? email.data : '(invalid)'}`;
      },
      handler: rejectWith429,
    }),
  };
}
