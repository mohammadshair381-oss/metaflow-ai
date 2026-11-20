import { apiErrorResponseSchema, authUserResponseSchema } from '@metaflow/shared';
import request, { type Response } from 'supertest';
import { describe, expect, it } from 'vitest';
import { hashSessionToken } from '../src/utils/session-token';
import { FRONTEND_ORIGIN, buildTestApp, testEnv } from './helpers';
import { createInMemoryAuthRepositories } from './support/in-memory-auth-repositories';

const PASSWORD = 'correct horse battery staple';
const ADA = { name: 'Ada Lovelace', email: 'Ada@Example.com', password: PASSWORD };
const DAY_MS = 24 * 60 * 60 * 1000;

function setup(options: Parameters<typeof buildTestApp>[0] = {}) {
  const repositories = createInMemoryAuthRepositories();
  const app = buildTestApp({ authRepositories: repositories, ...options });
  return { app, repositories };
}

/** The session cookie set by a response, parsed into name, value and attributes. */
function sessionCookie(response: Response, name = 'metaflow_session') {
  const header = ([] as string[]).concat(response.headers['set-cookie'] ?? []);
  const raw = header.find((cookie) => cookie.startsWith(`${name}=`));
  if (!raw) return undefined;
  const [pair = '', ...attributes] = raw.split(';').map((part) => part.trim());
  return {
    raw,
    value: pair.slice(name.length + 1),
    attributes: attributes.map((a) => a.toLowerCase()),
  };
}

const errorCode = (response: Response) => apiErrorResponseSchema.parse(response.body).error.code;

describe('registration', () => {
  it('creates the account, starts a session and returns the public user', async () => {
    const { app, repositories } = setup();
    const response = await request(app)
      .post('/api/auth/register')
      .set('Origin', FRONTEND_ORIGIN)
      .send(ADA);

    expect(response.status).toBe(201);
    const { user } = authUserResponseSchema.parse(response.body);
    expect(user).toMatchObject({
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      status: 'active',
      emailVerified: false,
    });

    const cookie = sessionCookie(response);
    expect(cookie?.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(cookie?.attributes).toEqual(
      expect.arrayContaining(['httponly', 'path=/', 'samesite=lax']),
    );
    expect(cookie?.attributes.some((a) => a.startsWith('expires='))).toBe(true);
    expect(cookie?.attributes).not.toContain('secure'); // plain-http localhost in development

    const stored = [...repositories.store.users.values()][0];
    expect(stored?.passwordHash).toMatch(/^scrypt\$/);
    expect(stored?.passwordHash).not.toContain(PASSWORD);

    const [session] = [...repositories.store.sessions.values()];
    expect(session?.tokenHash).toBe(hashSessionToken(cookie?.value ?? ''));
    expect(session?.tokenHash).not.toBe(cookie?.value);
  });

  it('rejects a duplicate email regardless of case, without starting a session', async () => {
    const { app, repositories } = setup();
    await request(app).post('/api/auth/register').send(ADA);

    const response = await request(app)
      .post('/api/auth/register')
      .send({ ...ADA, name: 'Someone Else', email: '  ADA@example.COM ' });

    expect(response.status).toBe(409);
    expect(errorCode(response)).toBe('EMAIL_TAKEN');
    expect(sessionCookie(response)).toBeUndefined();
    expect(repositories.store.users.size).toBe(1);
  });

  it('rejects an invalid email with a field-level validation error', async () => {
    const { app, repositories } = setup();
    const response = await request(app)
      .post('/api/auth/register')
      .send({ ...ADA, email: 'not-an-email' });

    expect(response.status).toBe(400);
    const { error } = apiErrorResponseSchema.parse(response.body);
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.details?.map((issue) => issue.path)).toContain('body.email');
    expect(repositories.store.users.size).toBe(0);
  });

  it.each([
    ['too short', 'short1!'],
    ['common', '1234567890'],
    ['repetitive', 'aaaaaaaaaaaaaa'],
  ])('rejects a weak password (%s)', async (_label, password) => {
    const { app, repositories } = setup();
    const response = await request(app)
      .post('/api/auth/register')
      .send({ ...ADA, password });

    expect(response.status).toBe(400);
    const { error } = apiErrorResponseSchema.parse(response.body);
    expect(error.details?.map((issue) => issue.path)).toContain('body.password');
    expect(repositories.store.users.size).toBe(0);
  });

  it('rejects a request with missing fields', async () => {
    const { app } = setup();
    const response = await request(app).post('/api/auth/register').send({});
    expect(response.status).toBe(400);
    expect(errorCode(response)).toBe('VALIDATION_ERROR');
  });
});

describe('login', () => {
  it('signs in with the right password, case-insensitive email, and restores the session', async () => {
    const { app } = setup();
    await request(app).post('/api/auth/register').send(ADA);

    const agent = request.agent(app);
    const login = await agent
      .post('/api/auth/login')
      .send({ email: 'ADA@EXAMPLE.COM', password: PASSWORD });
    expect(login.status).toBe(200);
    expect(authUserResponseSchema.parse(login.body).user.email).toBe('ada@example.com');
    expect(sessionCookie(login)).toBeDefined();

    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(authUserResponseSchema.parse(me.body).user.email).toBe('ada@example.com');
  });

  it('gives the same generic answer for a wrong password and an unknown email', async () => {
    const { app } = setup();
    await request(app).post('/api/auth/register').send(ADA);

    const wrongPassword = await request(app)
      .post('/api/auth/login')
      .send({ email: ADA.email, password: 'wrong password entirely' });
    const unknownEmail = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: PASSWORD });

    for (const response of [wrongPassword, unknownEmail]) {
      expect(response.status).toBe(401);
      expect(apiErrorResponseSchema.parse(response.body).error).toMatchObject({
        code: 'INVALID_CREDENTIALS',
        message: 'Incorrect email or password',
      });
      expect(sessionCookie(response)).toBeUndefined();
    }
  });

  it('refuses a suspended account with the same generic error', async () => {
    const { app, repositories } = setup();
    await request(app).post('/api/auth/register').send(ADA);
    const [user] = [...repositories.store.users.values()];
    if (user) repositories.store.users.set(user.id, { ...user, status: 'suspended' });

    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: ADA.email, password: PASSWORD });
    expect(response.status).toBe(401);
    expect(errorCode(response)).toBe('INVALID_CREDENTIALS');
  });

  it('replaces the session already held by the browser (no session fixation)', async () => {
    const { app, repositories } = setup();
    const first = await request(app).post('/api/auth/register').send(ADA);
    const firstToken = sessionCookie(first)?.value ?? '';

    const second = await request(app)
      .post('/api/auth/login')
      .set('Cookie', `metaflow_session=${firstToken}`)
      .send({ email: ADA.email, password: PASSWORD });
    const secondToken = sessionCookie(second)?.value ?? '';

    expect(secondToken).not.toBe(firstToken);
    const old = [...repositories.store.sessions.values()].find(
      (session) => session.tokenHash === hashSessionToken(firstToken),
    );
    expect(old?.revokedReason).toBe('replaced');
    const replayed = await request(app)
      .get('/api/auth/me')
      .set('Cookie', `metaflow_session=${firstToken}`);
    expect(replayed.status).toBe(401);
  });
});

describe('logout and session revocation', () => {
  it('revokes the session server-side and clears the cookie', async () => {
    const { app, repositories } = setup();
    const registered = await request(app).post('/api/auth/register').send(ADA);
    const token = sessionCookie(registered)?.value ?? '';

    const logout = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', `metaflow_session=${token}`);
    expect(logout.status).toBe(204);
    const cleared = sessionCookie(logout);
    expect(cleared?.value).toBe('');
    expect(cleared?.attributes).toContain('expires=thu, 01 jan 1970 00:00:00 gmt');

    const [session] = [...repositories.store.sessions.values()];
    expect(session?.revokedReason).toBe('logout');

    // Replaying the old token (e.g. a copied cookie) no longer works.
    const me = await request(app).get('/api/auth/me').set('Cookie', `metaflow_session=${token}`);
    expect(me.status).toBe(401);
  });

  it('is idempotent when there is no session', async () => {
    const { app } = setup();
    expect((await request(app).post('/api/auth/logout')).status).toBe(204);
  });

  it('"sign out everywhere" revokes every session of the user only', async () => {
    const { app } = setup();
    await request(app).post('/api/auth/register').send(ADA);
    const laptop = request.agent(app);
    const phone = request.agent(app);
    await laptop.post('/api/auth/login').send({ email: ADA.email, password: PASSWORD });
    await phone.post('/api/auth/login').send({ email: ADA.email, password: PASSWORD });

    const grace = request.agent(app);
    await grace
      .post('/api/auth/register')
      .send({ ...ADA, name: 'Grace', email: 'grace@example.com' });

    expect(
      (await laptop.post('/api/auth/logout-all').send({ userId: 'someone-else' })).status,
    ).toBe(204);
    expect((await laptop.get('/api/auth/me')).status).toBe(401);
    expect((await phone.get('/api/auth/me')).status).toBe(401);
    // A user ID in the body is ignored: only the caller's own sessions were revoked.
    expect((await grace.get('/api/auth/me')).status).toBe(200);
  });

  it('rejects an expired session and clears the cookie', async () => {
    let clock = new Date('2026-11-20T10:00:00.000Z');
    const { app } = setup({ now: () => clock });
    const registered = await request(app).post('/api/auth/register').send(ADA);
    const token = sessionCookie(registered)?.value ?? '';

    clock = new Date(clock.getTime() + 6 * DAY_MS);
    expect(
      (await request(app).get('/api/auth/me').set('Cookie', `metaflow_session=${token}`)).status,
    ).toBe(200);

    clock = new Date(clock.getTime() + 1 * DAY_MS + 1);
    const expired = await request(app)
      .get('/api/auth/me')
      .set('Cookie', `metaflow_session=${token}`);
    expect(expired.status).toBe(401);
    expect(errorCode(expired)).toBe('UNAUTHENTICATED');
    expect(sessionCookie(expired)?.value).toBe('');
  });

  it('rejects a session revoked directly in the database', async () => {
    const { app, repositories } = setup();
    const registered = await request(app).post('/api/auth/register').send(ADA);
    const token = sessionCookie(registered)?.value ?? '';
    const [session] = [...repositories.store.sessions.values()];
    if (session) {
      repositories.store.sessions.set(session.id, {
        ...session,
        revokedAt: new Date(),
        revokedReason: 'logout_all',
      });
    }

    const response = await request(app)
      .get('/api/auth/me')
      .set('Cookie', `metaflow_session=${token}`);
    expect(response.status).toBe(401);
  });

  it('rejects the session of a user suspended after signing in', async () => {
    const { app, repositories } = setup();
    const agent = request.agent(app);
    await agent.post('/api/auth/register').send(ADA);
    const [user] = [...repositories.store.users.values()];
    if (user) repositories.store.users.set(user.id, { ...user, status: 'suspended' });

    expect((await agent.get('/api/auth/me')).status).toBe(401);
  });
});

describe('unauthorized requests', () => {
  it.each([
    ['GET', '/api/auth/me'],
    ['POST', '/api/auth/logout-all'],
  ])('%s %s without a session returns 401 and sets no cookie', async (method, path) => {
    const { app } = setup();
    const response =
      method === 'GET' ? await request(app).get(path) : await request(app).post(path);
    expect(response.status).toBe(401);
    expect(errorCode(response)).toBe('UNAUTHENTICATED');
    expect(sessionCookie(response)).toBeUndefined();
  });

  it.each([
    ['garbage', 'not-a-token'],
    ['well-formed but unknown', 'A'.repeat(43)],
  ])('a %s cookie returns 401 and is cleared', async (_label, token) => {
    const { app } = setup();
    const response = await request(app)
      .get('/api/auth/me')
      .set('Cookie', `metaflow_session=${token}`);
    expect(response.status).toBe(401);
    expect(sessionCookie(response)?.value).toBe('');
  });
});

describe('responses never expose password data', () => {
  it('no auth response body or header contains the password, a hash or a hash field', async () => {
    const { app, repositories } = setup();
    const agent = request.agent(app);
    const responses = [
      await agent.post('/api/auth/register').send(ADA),
      await agent.get('/api/auth/me'),
      await agent.post('/api/auth/login').send({ email: ADA.email, password: PASSWORD }),
      await agent
        .post('/api/auth/login')
        .send({ email: ADA.email, password: 'wrong password entirely' }),
      await agent.post('/api/auth/register').send(ADA),
      await agent.post('/api/auth/logout'),
    ];
    const storedHash = [...repositories.store.users.values()][0]?.passwordHash ?? 'missing';

    for (const response of responses) {
      const serialized = JSON.stringify({
        body: response.body as unknown,
        text: response.text,
        headers: response.headers,
      });
      expect(serialized).not.toContain(PASSWORD);
      expect(serialized).not.toContain(storedHash);
      expect(serialized).not.toContain('scrypt$');
      expect(serialized.toLowerCase()).not.toContain('passwordhash');
    }
  });

  it('marks auth responses as not cacheable', async () => {
    const { app } = setup();
    const response = await request(app).post('/api/auth/register').send(ADA);
    expect(response.headers['cache-control']).toBe('no-store');
  });
});

describe('production cookie settings', () => {
  const productionEnv = (overrides: NodeJS.ProcessEnv = {}) =>
    testEnv({
      NODE_ENV: 'production',
      MONGODB_URI: 'mongodb://localhost:27017/metaflow_test',
      CORS_ORIGINS: 'https://app.example.com',
      ...overrides,
    });

  it('uses a Secure, HttpOnly, __Host- prefixed cookie with SameSite=Lax', async () => {
    const { app } = setup({ env: productionEnv() });
    const response = await request(app)
      .post('/api/auth/register')
      .set('Origin', 'https://app.example.com')
      .send(ADA);

    const cookie = sessionCookie(response, '__Host-metaflow_session');
    expect(cookie?.attributes).toEqual(
      expect.arrayContaining(['secure', 'httponly', 'path=/', 'samesite=lax']),
    );
    expect(cookie?.attributes.some((a) => a.startsWith('domain='))).toBe(false);
  });

  it('can be switched to SameSite=None for a cross-site deployment', async () => {
    const { app } = setup({ env: productionEnv({ SESSION_COOKIE_SAMESITE: 'none' }) });
    const response = await request(app)
      .post('/api/auth/register')
      .set('Origin', 'https://app.example.com')
      .send(ADA);
    expect(sessionCookie(response, '__Host-metaflow_session')?.attributes).toEqual(
      expect.arrayContaining(['secure', 'samesite=none']),
    );
  });
});
