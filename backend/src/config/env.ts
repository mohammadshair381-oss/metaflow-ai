import { APP_ENVIRONMENTS } from '@metaflow/shared';
import { z } from 'zod';

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const DEVELOPMENT_CORS_ORIGINS = ['http://localhost:3000'];

/** Treat unset and blank values the same, so `KEY=` in a .env file means "not configured". */
const blankToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const rawEnvSchema = z.object({
  NODE_ENV: z.enum(APP_ENVIRONMENTS).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  MONGODB_URI: z.preprocess(
    blankToUndefined,
    z
      .string()
      .trim()
      .regex(/^mongodb(\+srv)?:\/\//, 'must start with mongodb:// or mongodb+srv://')
      .optional(),
  ),
  CORS_ORIGINS: z.preprocess(blankToUndefined, z.string().optional()),
  /** Number of reverse-proxy hops to trust for client IP and protocol. Render needs 1. */
  TRUST_PROXY: z.coerce.number().int().min(0).max(10).default(0),
  /** Set automatically by Render; used to report which build is running. */
  RENDER_GIT_COMMIT: z.preprocess(blankToUndefined, z.string().optional()),
});

export interface Env {
  NODE_ENV: (typeof APP_ENVIRONMENTS)[number];
  PORT: number;
  LOG_LEVEL: LogLevel;
  /** Undefined means "database not configured" (allowed outside production only). */
  MONGODB_URI: string | undefined;
  /** Exact origins allowed to make credentialed cross-origin requests. */
  CORS_ORIGINS: string[];
  TRUST_PROXY: number;
  GIT_COMMIT: string | null;
}

export class EnvValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(
      `Invalid environment configuration:\n${issues.map((issue) => `  - ${issue}`).join('\n')}`,
    );
    this.name = 'EnvValidationError';
  }
}

/**
 * Parse an origin such as "https://app.example.com".
 * Returns the normalized origin, or an error message. Never echoes the input back.
 */
function parseOrigin(value: string): { origin: string } | { error: string } {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { error: 'is not a valid URL' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { error: 'must use http or https' };
  }
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '' || value.endsWith('/')) {
    return {
      error: 'must be an origin only (scheme://host[:port]) with no path or trailing slash',
    };
  }
  return { origin: url.origin };
}

/**
 * Validate and normalize environment variables. Throws EnvValidationError listing every problem.
 * Error messages name the variable but never include its value, so secrets cannot leak into logs.
 */
export function parseEnv(source: NodeJS.ProcessEnv): Env {
  const parsed = rawEnvSchema.safeParse(source);
  if (!parsed.success) {
    throw new EnvValidationError(
      parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    );
  }

  const raw = parsed.data;
  const isProduction = raw.NODE_ENV === 'production';
  const issues: string[] = [];

  if (isProduction && !raw.MONGODB_URI) {
    issues.push('MONGODB_URI: is required in production');
  }

  let corsOrigins: string[] = [];
  if (raw.CORS_ORIGINS === undefined) {
    if (isProduction) {
      issues.push('CORS_ORIGINS: is required in production (comma-separated frontend origins)');
    } else {
      corsOrigins = DEVELOPMENT_CORS_ORIGINS;
    }
  } else {
    const entries = raw.CORS_ORIGINS.split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry !== '');
    if (entries.length === 0) {
      issues.push('CORS_ORIGINS: must list at least one origin');
    }
    entries.forEach((entry, index) => {
      if (entry === '*') {
        issues.push(
          `CORS_ORIGINS[${index}]: wildcard is not allowed with credentialed requests; list exact origins`,
        );
        return;
      }
      const result = parseOrigin(entry);
      if ('error' in result) {
        issues.push(`CORS_ORIGINS[${index}]: ${result.error}`);
      } else if (isProduction && !result.origin.startsWith('https://')) {
        issues.push(`CORS_ORIGINS[${index}]: must use https in production`);
      } else {
        corsOrigins.push(result.origin);
      }
    });
  }

  if (issues.length > 0) {
    throw new EnvValidationError(issues);
  }

  return {
    NODE_ENV: raw.NODE_ENV,
    PORT: raw.PORT,
    LOG_LEVEL: raw.LOG_LEVEL,
    MONGODB_URI: raw.MONGODB_URI,
    CORS_ORIGINS: [...new Set(corsOrigins)],
    TRUST_PROXY: raw.TRUST_PROXY,
    GIT_COMMIT: raw.RENDER_GIT_COMMIT ? raw.RENDER_GIT_COMMIT.slice(0, 7) : null,
  };
}
