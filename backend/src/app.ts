import { API_PREFIX } from '@metaflow/shared';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { APP_VERSION } from './config/app-info';
import { createCorsOptions } from './config/cors';
import type { DatabaseHealthProbe } from './config/database';
import type { Env } from './config/env';
import { createSessionCookieConfig } from './config/session-cookie';
import { createAiStudioController } from './controllers/ai-studio.controller';
import { createAuthController } from './controllers/auth.controller';
import { createHealthController } from './controllers/health.controller';
import { createMediaController } from './controllers/media.controller';
import { createPostController } from './controllers/post.controller';
import { createSocialAccountController } from './controllers/social-account.controller';
import { createWorkspaceController } from './controllers/workspace.controller';
import { createEnvModelResolver } from './integrations/ai/ai-model-resolver';
import type { AiProvider } from './integrations/ai/ai-provider';
import { createMetaClient, type MetaClient } from './integrations/meta/meta-client';
import { createRequireAuth } from './middleware/authenticate';
import { createErrorHandler } from './middleware/error-handler';
import { createMediaUploadParser } from './middleware/media-upload';
import { notFoundHandler } from './middleware/not-found';
import {
  createAuthRateLimiters,
  createIpRateLimiter,
  createUserRateLimiter,
  DEFAULT_AI_RATE_LIMITS,
  DEFAULT_MEDIA_UPLOAD_RATE_LIMITS,
  type AuthRateLimits,
  type UserRateLimits,
} from './middleware/rate-limit';
import { requestId } from './middleware/request-id';
import { requestLogger } from './middleware/request-logger';
import { requireTrustedOrigin } from './middleware/trusted-origin';
import type { AiRepositories } from './repositories/ai-repositories';
import type { AuthRepositories } from './repositories/auth-repositories';
import type { MediaRepository } from './repositories/media-repositories';
import type { PostRepository } from './repositories/post-repositories';
import type { SocialRepositories } from './repositories/social-repositories';
import type { WorkspaceRepository } from './repositories/workspace-repositories';
import { createApiRouter } from './routes';
import { createAiStudioService } from './services/ai-studio.service';
import { createAuthService } from './services/auth.service';
import { createHealthService } from './services/health.service';
import { createMediaService } from './services/media.service';
import { createPostService } from './services/post.service';
import {
  createSocialAccountService,
  type SocialIntegration,
} from './services/social-account.service';
import { createWorkspaceService } from './services/workspace.service';
import { createLocalMediaStorage } from './storage/local-media-storage';
import type { MediaStorage } from './storage/media-storage';
import { readCookie } from './utils/cookies';
import type { Logger } from './utils/logger';
import { createSecretBox } from './utils/secret-box';

export interface AppDependencies {
  env: Env;
  database: DatabaseHealthProbe;
  logger: Logger;
  /** MongoDB-backed in the server; in-memory in tests. */
  authRepositories: AuthRepositories;
  workspaceRepository: WorkspaceRepository;
  socialRepositories: SocialRepositories;
  aiRepositories: AiRepositories;
  postRepository: PostRepository;
  mediaRepository: MediaRepository;
  /** Override only in tests (undefined: built from `env.MEDIA.storage`; null: no storage). */
  mediaStorage?: MediaStorage | null;
  /** Override only in tests; production uses DEFAULT_MEDIA_UPLOAD_RATE_LIMITS. */
  mediaUploadRateLimits?: UserRateLimits;
  /** Override only in tests; otherwise the OS temporary directory. */
  mediaUploadTempDir?: string;
  /** Override only in tests; otherwise built from the AI settings in `env.AI`. */
  aiProvider?: AiProvider;
  /** Override only in tests; production uses DEFAULT_AI_RATE_LIMITS. */
  aiRateLimits?: UserRateLimits;
  /** Override only in tests; otherwise built from the Meta settings in `env.SOCIAL`. */
  metaClient?: MetaClient;
  /** Override only in tests; production uses DEFAULT_AUTH_RATE_LIMITS. */
  authRateLimits?: AuthRateLimits;
  now?: () => Date;
}

/** JSON bodies above this size are rejected with 413. Raise per-route when uploads arrive. */
const JSON_BODY_LIMIT = '100kb';

/**
 * Build the Express application. Has no side effects (no listening, no DB connection),
 * so tests can create isolated instances with fake dependencies.
 */
export function createApp({
  env,
  database,
  logger,
  authRepositories,
  workspaceRepository,
  socialRepositories,
  aiRepositories,
  postRepository,
  mediaRepository,
  mediaStorage,
  mediaUploadRateLimits = DEFAULT_MEDIA_UPLOAD_RATE_LIMITS,
  mediaUploadTempDir,
  metaClient,
  aiProvider,
  aiRateLimits = DEFAULT_AI_RATE_LIMITS,
  authRateLimits,
  now,
}: AppDependencies): Express {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY);

  app.use(requestId());
  app.use(requestLogger(logger));
  app.use(helmet());
  app.use(cors(createCorsOptions(env.CORS_ORIGINS)));
  app.use(requireTrustedOrigin(env.CORS_ORIGINS));
  app.use(express.json({ limit: JSON_BODY_LIMIT }));

  const healthService = createHealthService({
    environment: env.NODE_ENV,
    version: APP_VERSION,
    commit: env.GIT_COMMIT,
    database,
  });

  const sessionCookie = createSessionCookieConfig(env);
  const authService = createAuthService({
    repositories: authRepositories,
    sessionTtlMs: sessionCookie.ttlMs,
    now,
  });

  const requireAuth = createRequireAuth(authService, sessionCookie);
  const workspaceService = createWorkspaceService({ repository: workspaceRepository, now });

  // Without Meta credentials and encryption keys the integration stays off: accounts can be
  // listed (there are none) but nothing can be connected, and no token is ever stored.
  const socialIntegration: SocialIntegration | null = env.SOCIAL
    ? {
        meta:
          metaClient ??
          createMetaClient({
            appId: env.SOCIAL.metaAppId,
            appSecret: env.SOCIAL.metaAppSecret,
            redirectUri: env.SOCIAL.metaRedirectUri,
            graphApiVersion: env.SOCIAL.metaGraphApiVersion,
          }),
        secretBox: createSecretBox(env.SOCIAL.tokenEncryptionKeys),
      }
    : null;
  const socialAccountService = createSocialAccountService({
    workspaces: workspaceService,
    repositories: socialRepositories,
    integration: socialIntegration,
    logger,
    now,
  });

  // Without an AI provider, model and key the resolver answers "not configured": brand voice,
  // history and drafts work, generation answers 503 INTEGRATION_NOT_CONFIGURED.
  const aiStudioService = createAiStudioService({
    workspaces: workspaceService,
    workspaceRepository,
    repositories: aiRepositories,
    models: createEnvModelResolver(env.AI, aiProvider),
    logger,
    now,
  });
  const postService = createPostService({
    workspaces: workspaceService,
    posts: postRepository,
    media: mediaRepository,
    socialAccounts: socialRepositories.accounts,
    generations: aiRepositories.generations,
    now,
  });

  // Without storage the library can be listed but nothing can be uploaded or served (503).
  const storage =
    mediaStorage === undefined
      ? env.MEDIA.storage && createLocalMediaStorage(env.MEDIA.storage.localDir)
      : mediaStorage;
  const mediaService = createMediaService({
    workspaces: workspaceService,
    workspaceRepository,
    media: mediaRepository,
    posts: postRepository,
    storage,
    maxImageBytes: env.MEDIA.maxImageBytes,
    maxVideoBytes: env.MEDIA.maxVideoBytes,
    logger,
  });

  app.use(
    API_PREFIX,
    createApiRouter({
      health: createHealthController(healthService),
      auth: {
        controller: createAuthController(authService, sessionCookie),
        requireAuth,
        limiters: createAuthRateLimiters(authRateLimits),
      },
      workspaces: { controller: createWorkspaceController(workspaceService), requireAuth },
      social: {
        controller: createSocialAccountController({
          service: socialAccountService,
          sessionUserId: async (req) => {
            const token = readCookie(req.headers.cookie, sessionCookie.name);
            return (await authService.authenticate(token))?.user.id ?? null;
          },
          // The first allowed origin is the web app's public address.
          appOrigin: env.CORS_ORIGINS[0] ?? 'http://localhost:3000',
        }),
        requireAuth,
        connectLimiter: createIpRateLimiter({ windowMs: 15 * 60 * 1000, limit: 20 }),
      },
      ai: {
        controller: createAiStudioController(aiStudioService),
        requireAuth,
        generationLimiter: createUserRateLimiter(aiRateLimits),
      },
      posts: { controller: createPostController(postService), requireAuth },
      media: {
        controller: createMediaController(mediaService, logger),
        requireAuth,
        uploadLimiter: createUserRateLimiter(mediaUploadRateLimits),
        uploadParser: createMediaUploadParser({
          maxFileBytes: Math.max(env.MEDIA.maxImageBytes, env.MEDIA.maxVideoBytes),
          tempDir: mediaUploadTempDir,
        }),
      },
    }),
  );

  app.use(notFoundHandler);
  app.use(createErrorHandler(logger));

  return app;
}
