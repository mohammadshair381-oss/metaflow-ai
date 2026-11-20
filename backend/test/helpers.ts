import type { PingResult, DatabaseHealthProbe } from '../src/config/database';
import { parseEnv, type Env } from '../src/config/env';
import { createApp, type AppDependencies } from '../src/app';
import type { AuthRepositories } from '../src/repositories/auth-repositories';
import type { WorkspaceRepository } from '../src/repositories/workspace-repositories';
import { createLogger, type Logger } from '../src/utils/logger';
import { createInMemoryAuthRepositories } from './support/in-memory-auth-repositories';
import { createInMemoryWorkspaceRepository } from './support/in-memory-workspace-repository';

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
    workspaceRepository?: WorkspaceRepository;
    authRateLimits?: AppDependencies['authRateLimits'];
    now?: () => Date;
  } = {},
) {
  const authRepositories = options.authRepositories ?? createInMemoryAuthRepositories();
  return createApp({
    env: options.env ?? testEnv(),
    database: options.database ?? notConfiguredDatabase,
    logger: options.logger ?? silentLogger,
    authRepositories,
    workspaceRepository:
      options.workspaceRepository ?? createInMemoryWorkspaceRepository(authRepositories.users),
    authRateLimits: options.authRateLimits,
    now: options.now,
  });
}
