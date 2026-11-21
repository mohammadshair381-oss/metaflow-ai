import type { PingResult, DatabaseHealthProbe } from '../src/config/database';
import { parseEnv, type Env } from '../src/config/env';
import { createApp, type AppDependencies } from '../src/app';
import type { AiProvider } from '../src/integrations/ai/ai-provider';
import type { MetaClient } from '../src/integrations/meta/meta-client';
import type { AiRepositories } from '../src/repositories/ai-repositories';
import type { AuthRepositories } from '../src/repositories/auth-repositories';
import type { MediaRepository } from '../src/repositories/media-repositories';
import type { PostRepository } from '../src/repositories/post-repositories';
import type { SocialRepositories } from '../src/repositories/social-repositories';
import type { WorkspaceRepository } from '../src/repositories/workspace-repositories';
import { createLogger, type Logger } from '../src/utils/logger';
import { createInMemoryAiRepositories } from './support/in-memory-ai-repositories';
import { createInMemoryAuthRepositories } from './support/in-memory-auth-repositories';
import { createInMemoryMediaRepository } from './support/in-memory-media-repository';
import { createInMemoryPostRepository } from './support/in-memory-post-repository';
import { createInMemorySocialRepositories } from './support/in-memory-social-repositories';
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
    socialRepositories?: SocialRepositories;
    aiRepositories?: AiRepositories;
    postRepository?: PostRepository;
    mediaRepository?: MediaRepository;
    mediaStorage?: AppDependencies['mediaStorage'];
    mediaUploadRateLimits?: AppDependencies['mediaUploadRateLimits'];
    mediaUploadTempDir?: string;
    aiProvider?: AiProvider;
    aiRateLimits?: AppDependencies['aiRateLimits'];
    metaClient?: MetaClient;
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
    socialRepositories: options.socialRepositories ?? createInMemorySocialRepositories(),
    metaClient: options.metaClient,
    aiRepositories: options.aiRepositories ?? createInMemoryAiRepositories(),
    postRepository: options.postRepository ?? createInMemoryPostRepository(),
    mediaRepository: options.mediaRepository ?? createInMemoryMediaRepository(),
    mediaStorage: options.mediaStorage,
    mediaUploadRateLimits: options.mediaUploadRateLimits,
    mediaUploadTempDir: options.mediaUploadTempDir,
    aiProvider: options.aiProvider,
    aiRateLimits: options.aiRateLimits,
    authRateLimits: options.authRateLimits,
    now: options.now,
  });
}
