import { API_PREFIX } from '@metaflow/shared';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { APP_VERSION } from './config/app-info';
import { createCorsOptions } from './config/cors';
import type { DatabaseHealthProbe } from './config/database';
import type { Env } from './config/env';
import { createHealthController } from './controllers/health.controller';
import { createErrorHandler } from './middleware/error-handler';
import { notFoundHandler } from './middleware/not-found';
import { requestId } from './middleware/request-id';
import { requestLogger } from './middleware/request-logger';
import { createApiRouter } from './routes';
import { createHealthService } from './services/health.service';
import type { Logger } from './utils/logger';

export interface AppDependencies {
  env: Env;
  database: DatabaseHealthProbe;
  logger: Logger;
}

/** JSON bodies above this size are rejected with 413. Raise per-route when uploads arrive. */
const JSON_BODY_LIMIT = '100kb';

/**
 * Build the Express application. Has no side effects (no listening, no DB connection),
 * so tests can create isolated instances with fake dependencies.
 */
export function createApp({ env, database, logger }: AppDependencies): Express {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY);

  app.use(requestId());
  app.use(requestLogger(logger));
  app.use(helmet());
  app.use(cors(createCorsOptions(env.CORS_ORIGINS)));
  app.use(express.json({ limit: JSON_BODY_LIMIT }));

  const healthService = createHealthService({
    environment: env.NODE_ENV,
    version: APP_VERSION,
    commit: env.GIT_COMMIT,
    database,
  });

  app.use(API_PREFIX, createApiRouter({ health: createHealthController(healthService) }));

  app.use(notFoundHandler);
  app.use(createErrorHandler(logger));

  return app;
}
