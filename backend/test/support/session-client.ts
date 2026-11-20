import type { Express } from 'express';
import request from 'supertest';
import { hashPassword } from '../../src/utils/password';
import { generateSessionToken, hashSessionToken } from '../../src/utils/session-token';
import { FRONTEND_ORIGIN } from '../helpers';
import type { InMemoryAuthRepositories } from './in-memory-auth-repositories';

// One cheap hash for every test user: sessions are created directly, not through login.
const passwordHash = hashPassword('irrelevant', {
  N: 16,
  r: 1,
  p: 1,
  keyLength: 32,
  saltLength: 16,
});

/** Creates a user with a live session and returns request helpers bound to their cookie. */
export async function signInAs(app: Express, auth: InMemoryAuthRepositories, name: string) {
  const user = await auth.users.create({
    name,
    email: `${name.toLowerCase()}@example.com`,
    passwordHash: await passwordHash,
  });
  const token = generateSessionToken();
  await auth.sessions.create({
    userId: user.id,
    tokenHash: hashSessionToken(token),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });
  const cookie = `metaflow_session=${token}`;
  const write = (method: 'post' | 'put' | 'patch' | 'delete') => (path: string, body?: object) =>
    request(app)[method](path).set('Cookie', cookie).set('Origin', FRONTEND_ORIGIN).send(body);
  return {
    user,
    cookie,
    get: (path: string) => request(app).get(path).set('Cookie', cookie),
    post: write('post'),
    put: write('put'),
    patch: write('patch'),
    delete: write('delete'),
  };
}

export type SessionClient = Awaited<ReturnType<typeof signInAs>>;
