import { readinessResponseSchema } from '@metaflow/shared';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createDatabase } from '../src/config/database';
import { createLogger } from '../src/utils/logger';
import { buildTestApp, silentLogger } from './helpers';

/**
 * These tests use the real MongoDB driver.
 *
 * - "unreachable" always runs: it points at a closed local port, so no server is needed.
 * - "live" runs only when MONGODB_TEST_URI is set (a disposable database, e.g. an Atlas
 *   test cluster). It is skipped otherwise.
 */

describe('database utility against an unreachable MongoDB', () => {
  const logged: string[] = [];
  const database = createDatabase({
    uri: 'mongodb://metaflow:not-a-real-password@127.0.0.1:1/metaflow-test',
    logger: createLogger({ level: 'debug', write: (line) => logged.push(line) }),
    autoIndex: false,
    serverSelectionTimeoutMS: 300,
    maxRetryDelayMs: 50,
  });

  afterAll(async () => {
    await database.disconnect();
  });

  it('reports itself as configured', () => {
    expect(database.isConfigured).toBe(true);
  });

  it('rejects a single connection attempt', async () => {
    await expect(database.connect()).rejects.toThrow();
  });

  it('reports a failed ping instead of throwing', async () => {
    await expect(database.ping()).resolves.toEqual({ ok: false, reason: 'not_connected' });
  });

  it('makes readiness return 503 while liveness stays 200', async () => {
    const app = buildTestApp({ database });

    const ready = await request(app).get('/api/health/ready');
    expect(ready.status).toBe(503);
    expect(readinessResponseSchema.parse(ready.body).checks.database.status).toBe('down');

    const live = await request(app).get('/api/health');
    expect(live.status).toBe(200);
  });

  it('keeps retrying until aborted, and never logs the password', async () => {
    logged.length = 0;
    const controller = new AbortController();
    const retrying = database.connectWithRetry({ signal: controller.signal });
    await new Promise((resolve) => setTimeout(resolve, 900));
    controller.abort();
    await retrying;

    const failures = logged.filter((line) => line.includes('database.connect_failed'));
    expect(failures.length).toBeGreaterThanOrEqual(2);
    expect(logged.join('\n')).not.toContain('not-a-real-password');
  });
});

describe('database utility without MONGODB_URI', () => {
  it('reports not configured and skips connecting', async () => {
    const database = createDatabase({ uri: undefined, logger: silentLogger, autoIndex: false });
    expect(database.isConfigured).toBe(false);
    await expect(database.connectWithRetry()).resolves.toBeUndefined();
    await expect(database.connect()).rejects.toThrow('MONGODB_URI is not configured');
  });
});

const liveUri = process.env.MONGODB_TEST_URI;

describe.runIf(liveUri)('database utility against a live MongoDB (MONGODB_TEST_URI)', () => {
  const database = createDatabase({ uri: liveUri, logger: silentLogger, autoIndex: false });

  afterAll(async () => {
    await database.disconnect();
  });

  it('connects and pings successfully', async () => {
    await database.connect();
    const ping = await database.ping();
    expect(ping.ok).toBe(true);
  });

  it('makes readiness return 200 with database up', async () => {
    const response = await request(buildTestApp({ database })).get('/api/health/ready');
    expect(response.status).toBe(200);
    const body = readinessResponseSchema.parse(response.body);
    expect(body.checks.database.status).toBe('up');
    expect(body.checks.database.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('reports down after disconnecting', async () => {
    await database.disconnect();
    expect((await database.ping()).ok).toBe(false);
  });
});
