import type { PingResult, DatabaseHealthProbe } from '../src/config/database';
import { parseEnv, type Env } from '../src/config/env';
import { createApp } from '../src/app';
import { createLogger, type Logger } from '../src/utils/logger';

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
  options: { database?: DatabaseHealthProbe; env?: Env; logger?: Logger } = {},
) {
  return createApp({
    env: options.env ?? testEnv(),
    database: options.database ?? notConfiguredDatabase,
    logger: options.logger ?? silentLogger,
  });
}
