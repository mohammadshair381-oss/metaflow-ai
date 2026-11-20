import type { PingResult, DatabaseHealthProbe } from '../src/config/database';
import { parseEnv, type Env } from '../src/config/env';
import { createApp, type AppDependencies } from '../src/app';
import type { AuthRepositories } from '../src/repositories/auth-repositories';
import { createLogger, type Logger } from '../src/utils/logger';
import { createInMemoryAuthRepositories } from './support/in-memory-auth-repositories';

export const FRONTEND_ORIGIN = 'http://localhost:3000';

export const silentLogger: Logger = createLogger({ level: 'silent' });

export function testEnv(overrides: NodeJS.ProcessEnv = {}): Env {
  return parseEnv({ NODE_ENV: 'test', CORS_ORIGINS: FRONTEND_ORIGIN, ...overrides });
}

export function fakeDatabase(
  ping: PingResult | (() => Promise<PingResult>),
  isConfigured = true,
): DatabaseHealthProbe {
  return {
    isConfigured,
    ping: typeof ping === 'function' ? ping : () => Promise.resolve(ping),
  };
}

export const notConfiguredDatabase = fakeDatabase({ ok: false, reason: 'not_configured' }, false);

export function buildTestApp(
  options: {
    database?: DatabaseHealthProbe;
    env?: Env;
    logger?: Logger;
    authRepositories?: AuthRepositories;
    authRateLimits?: AppDependencies['authRateLimits'];
    now?: () => Date;
  } = {},
) {
  return createApp({
    env: options.env ?? testEnv(),
    database: options.database ?? notConfiguredDatabase,
    logger: options.logger ?? silentLogger,
    authRepositories: options.authRepositories ?? createInMemoryAuthRepositories(),
    authRateLimits: options.authRateLimits,
    now: options.now,
  });
}
