import { API_PREFIX } from '@metaflow/shared';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { APP_VERSION } from './config/app-info';
import { createCorsOptions } from './config/cors';
import type { DatabaseHealthProbe } from './config/database';
import type { Env } from './config/env';
import { createSessionCookieConfig } from './config/session-cookie';
import { createAuthController } from './controllers/auth.controller';
import { createHealthController } from './controllers/health.controller';
import { createSocialAccountController } from './controllers/social-account.controller';
import { createWorkspaceController } from './controllers/workspace.controller';
import { createMetaClient, type MetaClient } from './integrations/meta/meta-client';
import { createRequireAuth } from './middleware/authenticate';
import { createErrorHandler } from './middleware/error-handler';
import { notFoundHandler } from './middleware/not-found';
import {
  createAuthRateLimiters,
  createIpRateLimiter,
  type AuthRateLimits,
} from './middleware/rate-limit';
import { requestId } from './middleware/request-id';
import { requestLogger } from './middleware/request-logger';
import { requireTrustedOrigin } from './middleware/trusted-origin';
import type { AuthRepositories } from './repositories/auth-repositories';
import type { SocialRepositories } from './repositories/social-repositories';
import type { WorkspaceRepository } from './repositories/workspace-repositories';
import { createApiRouter } from './routes';
import { createAuthService } from './services/auth.service';
import { createHealthService } from './services/health.service';
import {
  createSocialAccountService,
  type SocialIntegration,
} from './services/social-account.service';
import { createWorkspaceService } from './services/workspace.service';
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
  metaClient,
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
    }),
  );

  app.use(notFoundHandler);
  app.use(createErrorHandler(logger));

  return app;
}
