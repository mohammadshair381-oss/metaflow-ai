import { emailSchema } from '@metaflow/shared';
import type { Request, RequestHandler } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { AppError } from '../utils/app-error';

export interface AuthRateLimits {
  windowMs: number;
  /** Register + login attempts per client IP per window. */
  perIp: number;
  /** FAILED logins per account from one client IP per window (successful logins do not count). */
  failedLoginsPerAccountAndIp: number;
  /**
   * FAILED logins per account from all IPs together per window. Higher than the per-IP value,
   * so one IP cannot lock an account out, but guessing from many IPs is still capped.
   */
  failedLoginsPerAccount: number;
}

export const DEFAULT_AUTH_RATE_LIMITS: AuthRateLimits = {
  windowMs: 15 * 60 * 1000,
  perIp: 30,
  failedLoginsPerAccountAndIp: 10,
  failedLoginsPerAccount: 50,
};

export interface AuthRateLimiters {
  perIp: RequestHandler;
  failedLoginsPerAccountAndIp: RequestHandler;
  failedLoginsPerAccount: RequestHandler;
}

const rejectWith429: RequestHandler = (_req, _res, next) => {
  next(new AppError('RATE_LIMITED', 'Too many attempts. Wait a few minutes and try again.'));
};

/** IPv6 clients are grouped by subnet, so rotating addresses within one allocation does not help. */
const clientIpKey = (req: Request) => ipKeyGenerator(req.ip ?? 'unknown');

/**
 * The normalized email from the body. The body is validated, not trusted: invalid input shares
 * one bucket. No database lookup, so known and unknown accounts are limited identically.
 */
const accountKey = (req: Request) => {
  const email = emailSchema.safeParse((req.body as { email?: unknown } | undefined)?.email);
  return email.success ? email.data : '(invalid)';
};

/** A plain per-client-IP limit for a sensitive endpoint. Answers 429 RATE_LIMITED. */
export function createIpRateLimiter(options: { windowMs: number; limit: number }): RequestHandler {
  return rateLimit({
    ...options,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req) => `ip:${clientIpKey(req)}`,
    handler: rejectWith429,
  });
}

/**
 * In-memory limiters: correct for a single backend instance (the current deployment).
 * Counters reset on restart. Running several instances needs a shared store (e.g. Redis).
 * Client IPs are only accurate when TRUST_PROXY matches the proxy setup (Render: 1).
 *
 * Login runs perIp -> failedLoginsPerAccountAndIp -> failedLoginsPerAccount. A request rejected
 * by the account+IP limiter never reaches the account-wide one, so a single IP adds at most
 * `failedLoginsPerAccountAndIp` failures per window to the account-wide count.
 */
export function createAuthRateLimiters(
  limits: AuthRateLimits = DEFAULT_AUTH_RATE_LIMITS,
): AuthRateLimiters {
  const common = {
    windowMs: limits.windowMs,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: rejectWith429,
  } as const;
  return {
    perIp: rateLimit({
      ...common,
      limit: limits.perIp,
      keyGenerator: (req) => `ip:${clientIpKey(req)}`,
    }),
    failedLoginsPerAccountAndIp: rateLimit({
      ...common,
      limit: limits.failedLoginsPerAccountAndIp,
      skipSuccessfulRequests: true,
      // IP first: IP keys never contain "|", so the key is unambiguous.
      keyGenerator: (req) => `ip:${clientIpKey(req)}|login:${accountKey(req)}`,
    }),
    failedLoginsPerAccount: rateLimit({
      ...common,
      limit: limits.failedLoginsPerAccount,
      skipSuccessfulRequests: true,
      keyGenerator: (req) => `login:${accountKey(req)}`,
    }),
  };
}
