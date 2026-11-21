import {
  AI_PROVIDERS,
  APP_ENVIRONMENTS,
  META_OAUTH_CALLBACK_PATH,
  type AiProviderId,
} from '@metaflow/shared';
import { isAbsolute, resolve } from 'node:path';
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

/** Prices in US dollars per million tokens, used only to estimate costs. */
export interface AiPricing {
  inputPerMillionTokensUsd: number;
  outputPerMillionTokensUsd: number;
}

/** The AI provider and model the server uses. Secret: holds the provider's API key. */
export interface AiConfig {
  provider: AiProviderId;
  model: string;
  apiKey: string;
  /** Null unless both prices are configured: costs are then not estimated. */
  pricing: AiPricing | null;
}

export const MEDIA_STORAGE_DRIVERS = ['local'] as const;
export type MediaStorageDriver = (typeof MEDIA_STORAGE_DRIVERS)[number];

/** Where uploaded media files are kept. Only a local directory today; S3-style storage later. */
export interface MediaStorageConfig {
  driver: MediaStorageDriver;
  /** Absolute path of the directory that holds the files. Never sent to clients. */
  localDir: string;
}

export interface MediaConfig {
  /** Null when no storage is configured: the library can be listed, uploads answer 503. */
  storage: MediaStorageConfig | null;
  maxImageBytes: number;
  maxVideoBytes: number;
}

/** Development default for MEDIA_LOCAL_DIR, relative to the backend folder (git-ignored). */
export const DEVELOPMENT_MEDIA_DIR = '.data/media';

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
  /**
   * AI generation. Optional as a group: with none of AI_PROVIDER, AI_MODEL and AI_API_KEY set,
   * the API starts and reports AI generation as not configured. With only some set, it fails.
   */
  AI_PROVIDER: z.preprocess(
    (value) => (typeof value === 'string' ? value.trim().toLowerCase() || undefined : value),
    z.enum(AI_PROVIDERS).optional(),
  ),
  AI_MODEL: z.preprocess(blankToUndefined, z.string().trim().optional()),
  AI_API_KEY: z.preprocess(blankToUndefined, z.string().trim().optional()),
  AI_PRICE_INPUT_PER_MTOK_USD: z.preprocess(
    blankToUndefined,
    z.coerce.number().min(0).max(10_000).optional(),
  ),
  AI_PRICE_OUTPUT_PER_MTOK_USD: z.preprocess(
    blankToUndefined,
    z.coerce.number().min(0).max(10_000).optional(),
  ),
  /**
   * Media library storage. In development, files go to backend/.data/media unless set. In test
   * and production, storage stays off (uploads answer 503) until MEDIA_LOCAL_DIR is set.
   */
  MEDIA_STORAGE_DRIVER: z.preprocess(
    (value) => (typeof value === 'string' ? value.trim().toLowerCase() || undefined : value),
    z.enum(MEDIA_STORAGE_DRIVERS).optional(),
  ),
  MEDIA_LOCAL_DIR: z.preprocess(blankToUndefined, z.string().trim().optional()),
  MEDIA_MAX_IMAGE_MB: z.preprocess(
    blankToUndefined,
    z.coerce.number().int().min(1).max(50).default(10),
  ),
  MEDIA_MAX_VIDEO_MB: z.preprocess(
    blankToUndefined,
    z.coerce.number().int().min(1).max(1024).default(100),
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
  /** Null until an AI provider, model and API key are configured. */
  AI: AiConfig | null;
  MEDIA: MediaConfig;
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

/** A model ID such as claude-opus-5-5: letters, digits and . _ : / @ - only. */
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,99}$/;

/** All-or-nothing, like the social configuration. Messages never include a value. */
function parseAiConfig(raw: z.infer<typeof rawEnvSchema>, issues: string[]): AiConfig | null {
  const required = {
    AI_PROVIDER: raw.AI_PROVIDER,
    AI_MODEL: raw.AI_MODEL,
    AI_API_KEY: raw.AI_API_KEY,
  };
  const missing = Object.entries(required).filter(([, value]) => value === undefined);
  const pricingSet = [raw.AI_PRICE_INPUT_PER_MTOK_USD, raw.AI_PRICE_OUTPUT_PER_MTOK_USD].filter(
    (value) => value !== undefined,
  ).length;
  if (missing.length === Object.keys(required).length) {
    if (pricingSet > 0)
      issues.push('AI_PRICE_*: pricing is set but AI generation is not configured');
    return null;
  }
  for (const [name] of missing) {
    issues.push(`${name}: is required when AI generation is configured`);
  }
  const before = issues.length;

  if (required.AI_MODEL !== undefined && !MODEL_ID.test(required.AI_MODEL)) {
    issues.push("AI_MODEL: must be the provider's model ID, for example claude-opus-5-5");
  }
  if (required.AI_API_KEY !== undefined && /\s/.test(required.AI_API_KEY)) {
    issues.push('AI_API_KEY: must not contain spaces or line breaks');
  }
  if (pricingSet === 1) {
    issues.push(
      'AI_PRICE_INPUT_PER_MTOK_USD, AI_PRICE_OUTPUT_PER_MTOK_USD: set both prices, or neither',
    );
  }

  if (missing.length > 0 || issues.length > before) return null;
  return {
    provider: required.AI_PROVIDER as AiProviderId,
    model: required.AI_MODEL as string,
    apiKey: required.AI_API_KEY as string,
    pricing:
      raw.AI_PRICE_INPUT_PER_MTOK_USD !== undefined &&
      raw.AI_PRICE_OUTPUT_PER_MTOK_USD !== undefined
        ? {
            inputPerMillionTokensUsd: raw.AI_PRICE_INPUT_PER_MTOK_USD,
            outputPerMillionTokensUsd: raw.AI_PRICE_OUTPUT_PER_MTOK_USD,
          }
        : null,
  };
}

function parseMediaConfig(
  raw: z.infer<typeof rawEnvSchema>,
  environment: (typeof APP_ENVIRONMENTS)[number],
  issues: string[],
): MediaConfig {
  const limits = {
    maxImageBytes: raw.MEDIA_MAX_IMAGE_MB * 1024 * 1024,
    maxVideoBytes: raw.MEDIA_MAX_VIDEO_MB * 1024 * 1024,
  };
  let dir = raw.MEDIA_LOCAL_DIR;
  if (dir === undefined) {
    if (environment === 'development') dir = DEVELOPMENT_MEDIA_DIR;
    else {
      if (raw.MEDIA_STORAGE_DRIVER !== undefined) {
        issues.push('MEDIA_LOCAL_DIR: is required when MEDIA_STORAGE_DRIVER is set');
      }
      return { storage: null, ...limits };
    }
  }
  if (environment === 'production' && !isAbsolute(dir)) {
    issues.push('MEDIA_LOCAL_DIR: must be an absolute path in production');
    return { storage: null, ...limits };
  }
  return {
    storage: { driver: raw.MEDIA_STORAGE_DRIVER ?? 'local', localDir: resolve(dir) },
    ...limits,
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
  const ai = parseAiConfig(raw, issues);
  const media = parseMediaConfig(raw, raw.NODE_ENV, issues);

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
    AI: ai,
    MEDIA: media,
  };
}
