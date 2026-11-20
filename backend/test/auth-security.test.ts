import { apiErrorResponseSchema } from '@metaflow/shared';
import request, { type Response } from 'supertest';
import { describe, expect, it } from 'vitest';
import type { AuthRateLimits } from '../src/middleware/rate-limit';
import type { AuthRepositories } from '../src/repositories/auth-repositories';
import { FRONTEND_ORIGIN, buildTestApp, testEnv } from './helpers';
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
  const IP_A = '203.0.113.10';
  const IP_B = '198.51.100.20';
  const IP_C = '192.0.2.30';
  const IP_D = '203.0.113.40';
  const UNKNOWN_EMAIL = 'nobody@example.com';

  /** Trusts one proxy hop, so each request's X-Forwarded-For header sets its client IP. */
  async function appWithLimits(limits: Partial<AuthRateLimits>) {
    const app = buildTestApp({
      env: testEnv({ TRUST_PROXY: '1' }),
      authRateLimits: {
        windowMs: 60_000,
        perIp: 100,
        failedLoginsPerAccountAndIp: 100,
        failedLoginsPerAccount: 100,
        ...limits,
      },
    });
    for (const email of [ADA.email, 'grace@example.com']) {
      expect(
        (
          await request(app)
            .post('/api/auth/register')
            .send({ ...ADA, email })
        ).status,
      ).toBe(201);
    }
    const loginFrom = (ip: string, email: string, password: string) =>
      request(app).post('/api/auth/login').set('X-Forwarded-For', ip).send({ email, password });
    return { app, loginFrom };
  }

  it('limits register/login attempts per client IP with 429 and RateLimit headers', async () => {
    const app = buildTestApp({
      authRateLimits: {
        windowMs: 60_000,
        perIp: 3,
        failedLoginsPerAccountAndIp: 100,
        failedLoginsPerAccount: 100,
      },
    });
    const attempt = () =>
      request(app).post('/api/auth/login').send({ email: UNKNOWN_EMAIL, password: 'x' });

    for (let i = 0; i < 3; i += 1) expect((await attempt()).status).toBe(401);
    const limited = await attempt();

    expect(limited.status).toBe(429);
    expect(errorCode(limited)).toBe('RATE_LIMITED');
    expect(limited.headers.ratelimit ?? limited.headers['ratelimit-policy']).toBeDefined();
  });

  it('keeps one IP limited for an account after repeated failures, even with the right password', async () => {
    const { loginFrom } = await appWithLimits({ failedLoginsPerAccountAndIp: 2 });

    expect((await loginFrom(IP_A, ADA.email, 'wrong password one')).status).toBe(401);
    expect((await loginFrom(IP_A, 'ADA@example.com', 'wrong password two')).status).toBe(401);
    for (let i = 0; i < 3; i += 1) {
      const blocked = await loginFrom(IP_A, ADA.email, PASSWORD);
      expect(blocked.status).toBe(429);
      expect(errorCode(blocked)).toBe('RATE_LIMITED');
    }

    // Another account from the same IP is unaffected.
    expect((await loginFrom(IP_A, 'grace@example.com', PASSWORD)).status).toBe(200);
  });

  it('does not let failures from one IP block the account from another IP', async () => {
    const { loginFrom } = await appWithLimits({
      failedLoginsPerAccountAndIp: 2,
      failedLoginsPerAccount: 3,
    });

    // 2 failures counted, then 8 rejected for this IP before reaching the account-wide count.
    const statuses: number[] = [];
    for (let i = 0; i < 10; i += 1) {
      statuses.push((await loginFrom(IP_A, ADA.email, `wrong password ${i}`)).status);
    }
    expect(statuses).toEqual([401, 401, ...Array<number>(8).fill(429)]);

    expect((await loginFrom(IP_B, ADA.email, PASSWORD)).status).toBe(200);
  });

  it('still caps an account across many IPs with the higher account-wide limit', async () => {
    const { loginFrom } = await appWithLimits({
      failedLoginsPerAccountAndIp: 2,
      failedLoginsPerAccount: 5,
    });

    const statuses: number[] = [];
    for (const ip of [IP_A, IP_B, IP_C]) {
      for (let i = 0; i < 2; i += 1) {
        statuses.push((await loginFrom(ip, ADA.email, `wrong password ${ip} ${i}`)).status);
      }
    }
    // 5 failures allowed in total, then the 6th (from a third IP) is rejected.
    expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);

    // A fresh IP is refused for this account too, but other accounts still work.
    const blocked = await loginFrom(IP_D, ADA.email, PASSWORD);
    expect(blocked.status).toBe(429);
    expect(errorCode(blocked)).toBe('RATE_LIMITED');
    expect((await loginFrom(IP_D, 'grace@example.com', PASSWORD)).status).toBe(200);
  });

  it('lets a legitimate login through while the limits are not exceeded', async () => {
    const { loginFrom } = await appWithLimits({
      failedLoginsPerAccountAndIp: 3,
      failedLoginsPerAccount: 5,
    });

    expect((await loginFrom(IP_A, ADA.email, 'typo one')).status).toBe(401);
    expect((await loginFrom(IP_A, ADA.email, 'typo two')).status).toBe(401);
    const response = await loginFrom(IP_A, ADA.email, PASSWORD);
    expect(response.status).toBe(200);
    expect(response.headers['set-cookie']).toBeDefined();
  });

  it('does not count successful logins toward either login limit', async () => {
    const { loginFrom } = await appWithLimits({
      failedLoginsPerAccountAndIp: 2,
      failedLoginsPerAccount: 2,
    });
    for (let i = 0; i < 4; i += 1) {
      expect((await loginFrom(IP_A, ADA.email, PASSWORD)).status).toBe(200);
    }
  });

  it('limits unknown accounts exactly like existing ones', async () => {
    const { loginFrom } = await appWithLimits({
      failedLoginsPerAccountAndIp: 2,
      failedLoginsPerAccount: 3,
    });
    const run = async (email: string) => {
      const responses: Response[] = [];
      for (const ip of [IP_A, IP_A, IP_A, IP_B, IP_B]) {
        responses.push(await loginFrom(ip, email, 'wrong password'));
      }
      return responses;
    };

    const known = await run(ADA.email);
    const unknown = await run(UNKNOWN_EMAIL);

    // Everything a client can observe, except the per-request ID.
    const observable = (response: Response) => {
      const { code, message } = apiErrorResponseSchema.parse(response.body).error;
      return { status: response.status, code, message };
    };
    expect(known.map((r) => r.status)).toEqual([401, 401, 429, 401, 429]);
    expect(unknown.map(observable)).toEqual(known.map(observable));
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
