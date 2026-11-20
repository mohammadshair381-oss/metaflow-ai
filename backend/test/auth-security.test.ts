import { apiErrorResponseSchema } from '@metaflow/shared';
import request, { type Response } from 'supertest';
import { describe, expect, it } from 'vitest';
import type { AuthRepositories } from '../src/repositories/auth-repositories';
import { FRONTEND_ORIGIN, buildTestApp } from './helpers';
import { createInMemoryAuthRepositories } from './support/in-memory-auth-repositories';

const PASSWORD = 'correct horse battery staple';
const ADA = { name: 'Ada Lovelace', email: 'ada@example.com', password: PASSWORD };
const errorCode = (response: Response) => apiErrorResponseSchema.parse(response.body).error.code;

describe('cross-site request forgery protection (Origin check)', () => {
  it('refuses state-changing requests from an origin that is not allowed', async () => {
    const repositories = createInMemoryAuthRepositories();
    const app = buildTestApp({ authRepositories: repositories });

    const response = await request(app)
      .post('/api/auth/register')
      .set('Origin', 'https://evil.example')
      .send(ADA);

    expect(response.status).toBe(403);
    expect(errorCode(response)).toBe('FORBIDDEN');
    expect(repositories.store.users.size).toBe(0);
  });

  it('refuses the "null" origin used by sandboxed frames and local files', async () => {
    const app = buildTestApp();
    const response = await request(app).post('/api/auth/logout').set('Origin', 'null');
    expect(response.status).toBe(403);
  });

  it('allows the configured frontend origin and non-browser clients without Origin', async () => {
    const app = buildTestApp();
    expect(
      (await request(app).post('/api/auth/register').set('Origin', FRONTEND_ORIGIN).send(ADA))
        .status,
    ).toBe(201);
    expect(
      (await request(app).post('/api/auth/login').send({ email: ADA.email, password: PASSWORD }))
        .status,
    ).toBe(200);
  });

  it('does not affect safe methods', async () => {
    const app = buildTestApp();
    const response = await request(app).get('/api/health').set('Origin', 'https://evil.example');
    expect(response.status).toBe(200);
  });
});

describe('rate limiting', () => {
  it('limits register/login attempts per client IP with 429 and RateLimit headers', async () => {
    const app = buildTestApp({
      authRateLimits: { windowMs: 60_000, perIp: 3, failedLoginsPerAccount: 100 },
    });
    const attempt = () =>
      request(app).post('/api/auth/login').send({ email: 'nobody@example.com', password: 'x' });

    for (let i = 0; i < 3; i += 1) expect((await attempt()).status).toBe(401);
    const limited = await attempt();

    expect(limited.status).toBe(429);
    expect(errorCode(limited)).toBe('RATE_LIMITED');
    expect(limited.headers.ratelimit ?? limited.headers['ratelimit-policy']).toBeDefined();
  });

  it('caps failed logins per account, even when the right password follows', async () => {
    const app = buildTestApp({
      authRateLimits: { windowMs: 60_000, perIp: 100, failedLoginsPerAccount: 2 },
    });
    await request(app).post('/api/auth/register').send(ADA);
    await request(app)
      .post('/api/auth/register')
      .send({ ...ADA, email: 'grace@example.com' });
    const login = (email: string, password: string) =>
      request(app).post('/api/auth/login').send({ email, password });

    expect((await login(ADA.email, 'wrong password one')).status).toBe(401);
    expect((await login('ADA@example.com', 'wrong password two')).status).toBe(401);
    const blocked = await login(ADA.email, PASSWORD);
    expect(blocked.status).toBe(429);

    // Another account is unaffected.
    expect((await login('grace@example.com', PASSWORD)).status).toBe(200);
  });

  it('does not count successful logins toward the per-account limit', async () => {
    const app = buildTestApp({
      authRateLimits: { windowMs: 60_000, perIp: 100, failedLoginsPerAccount: 2 },
    });
    await request(app).post('/api/auth/register').send(ADA);
    for (let i = 0; i < 4; i += 1) {
      const response = await request(app)
        .post('/api/auth/login')
        .send({ email: ADA.email, password: PASSWORD });
      expect(response.status).toBe(200);
    }
  });
});

describe('database outage', () => {
  function unavailableRepositories(): AuthRepositories {
    const outage = () => {
      const error = new Error('Server selection timed out after 10000 ms');
      error.name = 'MongooseServerSelectionError';
      return Promise.reject(error);
    };
    return {
      users: { create: outage, findCredentialsByEmail: outage, findById: outage },
      sessions: {
        create: outage,
        findByTokenHash: outage,
        revoke: outage,
        revokeAllForUser: outage,
      },
    };
  }

  it('answers 503 SERVICE_UNAVAILABLE instead of a generic 500', async () => {
    const app = buildTestApp({ authRepositories: unavailableRepositories() });

    const register = await request(app).post('/api/auth/register').send(ADA);
    expect(register.status).toBe(503);
    expect(errorCode(register)).toBe('SERVICE_UNAVAILABLE');
    expect(register.text).not.toContain('Server selection');

    const me = await request(app)
      .get('/api/auth/me')
      .set('Cookie', `metaflow_session=${'A'.repeat(43)}`);
    expect(me.status).toBe(503);
  });
});
