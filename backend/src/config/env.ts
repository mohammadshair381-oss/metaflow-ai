import { APP_ENVIRONMENTS, META_OAUTH_CALLBACK_PATH } from '@metaflow/shared';
import { z } from 'zod';

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export const COOKIE_SAME_SITE_VALUES = ['lax', 'strict', 'none'] as const;
export type CookieSameSite = (typeof COOKIE_SAME_SITE_VALUES)[number];

export const DEFAULT_META_GRAPH_API_VERSION = 'v27.0';
const TOKEN_KEY_BYTES = 32;

/** Meta app credentials and the keys that encrypt stored social tokens. All secret. */
export interface SocialConfig {
  metaAppId: string;
  metaAppSecret: string;
  /** Must be registered in the Meta app as a valid OAuth redirect URI. */
  metaRedirectUri: string;
  metaGraphApiVersion: string;
  /** 32-byte keys. The first encrypts; all of them decrypt (key rotation). */
  tokenEncryptionKeys: Buffer[];
}

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
  /** Absolute session lifetime. A session is never extended; signing in again starts a new one. */
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(7),
  /**
   * SameSite attribute of the session cookie. "lax" works when the web app and API share a site
   * (localhost, or app./api. subdomains of one domain). "none" is only for a cross-site setup and
   * needs Secure cookies; see docs/architecture.md, "Cross-site cookies".
   */
  SESSION_COOKIE_SAMESITE: z.preprocess(
    (value) => (typeof value === 'string' ? value.trim().toLowerCase() || undefined : value),
    z.enum(COOKIE_SAME_SITE_VALUES).default('lax'),
  ),
  /**
   * Social account connection (Meta). Optional as a group: with none of the four set, the API
   * starts and reports the integration as not configured. With only some set, startup fails.
   */
  META_APP_ID: z.preprocess(blankToUndefined, z.string().trim().optional()),
  META_APP_SECRET: z.preprocess(blankToUndefined, z.string().trim().optional()),
  META_REDIRECT_URI: z.preprocess(blankToUndefined, z.string().trim().optional()),
  SOCIAL_TOKEN_ENCRYPTION_KEYS: z.preprocess(blankToUndefined, z.string().trim().optional()),
  META_GRAPH_API_VERSION: z.preprocess(
    blankToUndefined,
    z
      .string()
      .trim()
      .regex(/^v\d{1,3}\.\d{1,2}$/, 'must look like v27.0')
      .default(DEFAULT_META_GRAPH_API_VERSION),
  ),
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
  SESSION_TTL_DAYS: number;
  SESSION_COOKIE_SAMESITE: CookieSameSite;
  /** Null until the Meta app and token encryption keys are configured. */
  SOCIAL: SocialConfig | null;
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

/** All-or-nothing: partial configuration is an error, never a silent "not configured". */
function parseSocialConfig(
  raw: z.infer<typeof rawEnvSchema>,
  isProduction: boolean,
  issues: string[],
): SocialConfig | null {
  const required = {
    META_APP_ID: raw.META_APP_ID,
    META_APP_SECRET: raw.META_APP_SECRET,
    META_REDIRECT_URI: raw.META_REDIRECT_URI,
    SOCIAL_TOKEN_ENCRYPTION_KEYS: raw.SOCIAL_TOKEN_ENCRYPTION_KEYS,
  };
  const missing = Object.entries(required).filter(([, value]) => value === undefined);
  if (missing.length === Object.keys(required).length) return null;
  for (const [name] of missing) {
    issues.push(`${name}: is required when social account connection is configured`);
  }
  const before = issues.length;

  if (required.META_APP_ID !== undefined && !/^\d{5,32}$/.test(required.META_APP_ID)) {
    issues.push('META_APP_ID: must be the numeric app ID from the Meta app dashboard');
  }

  if (required.META_REDIRECT_URI !== undefined) {
    let url: URL | undefined;
    try {
      url = new URL(required.META_REDIRECT_URI);
    } catch {
      issues.push('META_REDIRECT_URI: is not a valid URL');
    }
    if (url) {
      if (url.pathname !== META_OAUTH_CALLBACK_PATH || url.search !== '' || url.hash !== '') {
        issues.push(
          `META_REDIRECT_URI: must end with ${META_OAUTH_CALLBACK_PATH} and have no query`,
        );
      } else if (isProduction && url.protocol !== 'https:') {
        issues.push('META_REDIRECT_URI: must use https in production');
      }
    }
  }

  const keys: Buffer[] = [];
  if (required.SOCIAL_TOKEN_ENCRYPTION_KEYS !== undefined) {
    const entries = required.SOCIAL_TOKEN_ENCRYPTION_KEYS.split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry !== '');
    if (entries.length === 0) issues.push('SOCIAL_TOKEN_ENCRYPTION_KEYS: must contain a key');
    entries.forEach((entry, index) => {
      const key = /^[A-Za-z0-9+/_-]+={0,2}$/.test(entry) ? Buffer.from(entry, 'base64') : null;
      if (key?.length === TOKEN_KEY_BYTES) keys.push(key);
      else {
        issues.push(
          `SOCIAL_TOKEN_ENCRYPTION_KEYS[${index}]: must be ${TOKEN_KEY_BYTES} random bytes, base64-encoded`,
        );
      }
    });
  }

  if (missing.length > 0 || issues.length > before) return null;
  return {
    metaAppId: required.META_APP_ID as string,
    metaAppSecret: required.META_APP_SECRET as string,
    metaRedirectUri: required.META_REDIRECT_URI as string,
    metaGraphApiVersion: raw.META_GRAPH_API_VERSION,
    tokenEncryptionKeys: keys,
  };
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

  if (raw.SESSION_COOKIE_SAMESITE === 'none' && !isProduction) {
    issues.push(
      'SESSION_COOKIE_SAMESITE: "none" needs Secure cookies, which are only enabled in production',
    );
  }

  const social = parseSocialConfig(raw, isProduction, issues);

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
    SESSION_TTL_DAYS: raw.SESSION_TTL_DAYS,
    SESSION_COOKIE_SAMESITE: raw.SESSION_COOKIE_SAMESITE,
    SOCIAL: social,
  };
}
