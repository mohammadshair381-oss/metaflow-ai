import { healthResponseSchema, readinessResponseSchema } from '@metaflow/shared';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { buildTestApp, fakeDatabase } from './helpers';

describe('GET /api/health', () => {
  it('returns the liveness payload defined by the shared contract', async () => {
    const response = await request(buildTestApp()).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(response.headers['cache-control']).toBe('no-store');
    const body = healthResponseSchema.parse(response.body);
    expect(body).toMatchObject({ status: 'ok', service: 'metaflow-backend', environment: 'test' });
  });

  it('stays healthy while the database is down', async () => {
    const app = buildTestApp({ database: fakeDatabase({ ok: false, reason: 'not_connected' }) });
    const response = await request(app).get('/api/health');
    expect(response.status).toBe(200);
    expect(healthResponseSchema.parse(response.body).status).toBe('ok');
  });

  it('assigns a request ID and echoes a safe caller-supplied one', async () => {
    const app = buildTestApp();
    const generated = await request(app).get('/api/health');
    expect(generated.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);

    const supplied = await request(app).get('/api/health').set('X-Request-Id', 'trace-12345678');
    expect(supplied.headers['x-request-id']).toBe('trace-12345678');

    const unsafe = await request(app).get('/api/health').set('X-Request-Id', '<script>');
    expect(unsafe.headers['x-request-id']).not.toBe('<script>');
  });
});

describe('GET /api/health/ready', () => {
  it('is ready with database "not_configured" when no MONGODB_URI is set', async () => {
    const response = await request(buildTestApp()).get('/api/health/ready');

    expect(response.status).toBe(200);
    const body = readinessResponseSchema.parse(response.body);
    expect(body.status).toBe('ready');
    expect(body.checks.database).toEqual({ status: 'not_configured' });
  });

  it('is ready when the database ping succeeds', async () => {
    const app = buildTestApp({ database: fakeDatabase({ ok: true, latencyMs: 4.2 }) });
    const response = await request(app).get('/api/health/ready');

    expect(response.status).toBe(200);
    expect(readinessResponseSchema.parse(response.body).checks.database).toEqual({
      status: 'up',
      latencyMs: 4.2,
    });
  });

  it('returns 503 not_ready when the database ping fails', async () => {
    const app = buildTestApp({ database: fakeDatabase({ ok: false, reason: 'timeout' }) });
    const response = await request(app).get('/api/health/ready');

    expect(response.status).toBe(503);
    expect(response.headers['cache-control']).toBe('no-store');
    const body = readinessResponseSchema.parse(response.body);
    expect(body).toMatchObject({ status: 'not_ready', checks: { database: { status: 'down' } } });
  });

  it('returns 503 rather than 500 if the probe itself throws', async () => {
    const app = buildTestApp({
      database: fakeDatabase(() => Promise.reject(new Error('driver exploded'))),
    });
    const response = await request(app).get('/api/health/ready');

    expect(response.status).toBe(503);
    expect(JSON.stringify(response.body)).not.toContain('driver exploded');
  });
});
