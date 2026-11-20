import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { createApp } from './app';
import { createDatabase } from './config/database';
import { EnvValidationError, parseEnv, type Env } from './config/env';
import { createMongoAuthRepositories } from './repositories/mongo-auth-repositories';
import { createMongoWorkspaceRepository } from './repositories/mongo-workspace-repositories';
import { createLogger } from './utils/logger';

const SHUTDOWN_TIMEOUT_MS = 10_000;

/** Local development convenience: load backend/.env if present. Never used in production. */
function loadLocalEnvFile(): void {
  if (process.env.NODE_ENV !== 'production' && existsSync('.env')) {
    process.loadEnvFile('.env');
  }
}

function loadEnv(): Env {
  try {
    return parseEnv(process.env);
  } catch (error) {
    if (error instanceof EnvValidationError) {
      // Logger is not available yet; the message lists variable names only, never values.
      process.stderr.write(`${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }
}

function main(): void {
  loadLocalEnvFile();
  const env = loadEnv();
  const logger = createLogger({ level: env.LOG_LEVEL });

  const database = createDatabase({
    uri: env.MONGODB_URI,
    logger,
    autoIndex: env.NODE_ENV !== 'production',
  });

  const app = createApp({
    env,
    database,
    logger,
    authRepositories: createMongoAuthRepositories(),
    workspaceRepository: createMongoWorkspaceRepository(),
  });
  const server = createServer(app);
  const shutdownController = new AbortController();

  server.on('error', (error) => {
    logger.error('server.error', { error });
    process.exit(1);
  });

  server.listen(env.PORT, () => {
    logger.info('server.listening', {
      port: env.PORT,
      environment: env.NODE_ENV,
      corsOrigins: env.CORS_ORIGINS,
      databaseConfigured: database.isConfigured,
    });
  });

  // Connect in the background: /api/health answers immediately, /api/health/ready
  // reports not_ready until MongoDB is reachable.
  void database.connectWithRetry({ signal: shutdownController.signal });

  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('server.shutting_down', { signal });
    shutdownController.abort();

    const forceExit = setTimeout(() => {
      logger.error('server.shutdown_timeout');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceExit.unref();

    server.close(() => {
      database
        .disconnect()
        .catch((error: unknown) => logger.error('database.disconnect_failed', { error }))
        .finally(() => {
          logger.info('server.stopped');
          process.exit(0);
        });
    });
    server.closeIdleConnections();
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  process.on('unhandledRejection', (reason) => {
    logger.error('process.unhandled_rejection', { error: reason });
  });
  process.on('uncaughtException', (error) => {
    logger.error('process.uncaught_exception', { error });
    process.exit(1);
  });
}

main();
