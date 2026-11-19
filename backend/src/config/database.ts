import { setTimeout as delay } from 'node:timers/promises';
import mongoose from 'mongoose';
import type { Logger } from '../utils/logger';
import { redactConnectionStrings } from '../utils/redact';

export type PingResult = { ok: true; latencyMs: number } | { ok: false; reason: string };

/** The part of the database the health checks depend on. Lets tests substitute a fake. */
export interface DatabaseHealthProbe {
  readonly isConfigured: boolean;
  ping(timeoutMs?: number): Promise<PingResult>;
}

export interface Database extends DatabaseHealthProbe {
  /** Single connection attempt. Rejects if MongoDB cannot be reached. */
  connect(): Promise<void>;
  /**
   * Keep trying to connect with exponential backoff until it succeeds or the signal aborts.
   * The HTTP server starts before this resolves, so liveness keeps working during outages.
   */
  connectWithRetry(options?: { signal?: AbortSignal }): Promise<void>;
  disconnect(): Promise<void>;
}

export interface DatabaseOptions {
  uri: string | undefined;
  logger: Logger;
  /** Build indexes automatically. False in production (see docs/architecture.md, "Database"). */
  autoIndex: boolean;
  serverSelectionTimeoutMS?: number;
  maxRetryDelayMs?: number;
}

const DEFAULT_PING_TIMEOUT_MS = 2_000;
const CONNECTED = mongoose.ConnectionStates.connected;

// Fail fast instead of queueing queries while disconnected, and reject unknown query filters.
mongoose.set('bufferCommands', false);
mongoose.set('strictQuery', true);

function describeError(error: unknown): string {
  if (error instanceof Error) return redactConnectionStrings(`${error.name}: ${error.message}`);
  return 'Unknown error';
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${timeoutMs} ms`)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * MongoDB connection utility built on Mongoose's default connection, so models
 * registered with `mongoose.model()` use it automatically.
 */
export function createDatabase(options: DatabaseOptions): Database {
  const {
    uri,
    logger,
    autoIndex,
    serverSelectionTimeoutMS = 10_000,
    maxRetryDelayMs = 30_000,
  } = options;
  const connection = mongoose.connection;
  let listenersAttached = false;
  // Before the first successful connection, connectWithRetry already logs each failure;
  // the driver's own disconnected/error events would only repeat it.
  let hasConnected = false;

  const onConnected = () => {
    hasConnected = true;
    logger.info('database.connected');
  };
  const onDisconnected = () => {
    if (hasConnected) logger.warn('database.disconnected');
  };
  const onReconnected = () => logger.info('database.reconnected');
  const onError = (error: unknown) => {
    if (hasConnected) logger.error('database.error', { error: describeError(error) });
  };

  const attachListeners = () => {
    if (listenersAttached) return;
    connection.on('connected', onConnected);
    connection.on('disconnected', onDisconnected);
    connection.on('reconnected', onReconnected);
    connection.on('error', onError);
    listenersAttached = true;
  };

  const detachListeners = () => {
    connection.off('connected', onConnected);
    connection.off('disconnected', onDisconnected);
    connection.off('reconnected', onReconnected);
    connection.off('error', onError);
    listenersAttached = false;
  };

  const connect = async () => {
    if (!uri) throw new Error('MONGODB_URI is not configured');
    if (connection.readyState === CONNECTED) return;
    attachListeners();
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS,
      maxPoolSize: 10,
      autoIndex,
      autoCreate: autoIndex,
    });
  };

  return {
    isConfigured: uri !== undefined,

    connect,

    async connectWithRetry({ signal } = {}) {
      if (!uri) {
        logger.warn('database.not_configured', {
          detail: 'MONGODB_URI is not set; readiness reports the database as not_configured',
        });
        return;
      }
      let attempt = 0;
      while (!signal?.aborted) {
        attempt += 1;
        try {
          await connect();
          return;
        } catch (error) {
          const retryInMs = Math.min(1_000 * 2 ** (attempt - 1), maxRetryDelayMs);
          logger.error('database.connect_failed', {
            attempt,
            retryInMs,
            error: describeError(error),
          });
          try {
            await delay(retryInMs, undefined, { signal });
          } catch {
            return; // aborted during shutdown
          }
        }
      }
    },

    async ping(timeoutMs = DEFAULT_PING_TIMEOUT_MS) {
      const db = connection.db;
      if (connection.readyState !== CONNECTED || !db) {
        return { ok: false, reason: 'not_connected' };
      }
      const startedAt = performance.now();
      try {
        await withTimeout(db.command({ ping: 1 }), timeoutMs);
        return { ok: true, latencyMs: Math.round((performance.now() - startedAt) * 10) / 10 };
      } catch (error) {
        return { ok: false, reason: describeError(error) };
      }
    },

    async disconnect() {
      await mongoose.disconnect();
      detachListeners();
    },
  };
}
