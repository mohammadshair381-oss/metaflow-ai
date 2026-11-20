import { describe, expect, it } from 'vitest';
import { SessionModel } from '../src/models/session.model';
import { UserModel } from '../src/models/user.model';

/** Schema-level checks; no database connection is opened. */
describe('User model', () => {
  it('requires name, email and password hash', () => {
    const errors = new UserModel({}).validateSync()?.errors ?? {};
    expect(Object.keys(errors).sort()).toEqual(['email', 'name', 'passwordHash']);
  });

  it('stores the email trimmed and lower-cased, active by default, unverified', () => {
    const user = new UserModel({
      name: ' Ada ',
      email: '  Ada@Example.COM ',
      passwordHash: 'scrypt$x',
    });
    expect(user.validateSync()).toBeUndefined();
    expect(user.email).toBe('ada@example.com');
    expect(user.name).toBe('Ada');
    expect(user.status).toBe('active');
    expect(user.emailVerifiedAt).toBeNull();
  });

  it('rejects an unknown account status', () => {
    const user = new UserModel({
      name: 'Ada',
      email: 'a@example.com',
      passwordHash: 'h',
      status: 'admin',
    });
    expect(user.validateSync()?.errors.status).toBeDefined();
  });

  it('never selects or serializes the password hash', () => {
    expect(UserModel.schema.path('passwordHash').options).toMatchObject({ select: false });
    const json = new UserModel({
      name: 'Ada',
      email: 'a@example.com',
      passwordHash: 'scrypt$secret',
    }).toJSON();
    expect(json).not.toHaveProperty('passwordHash');
  });

  it('declares a unique index on email', () => {
    expect(UserModel.schema.indexes()).toContainEqual([
      { email: 1 },
      expect.objectContaining({ unique: true, name: 'users_email_unique' }),
    ]);
  });
});

describe('Session model', () => {
  const valid = {
    userId: '65f0c0ffee0000000000abcd',
    tokenHash: 'a'.repeat(64),
    expiresAt: new Date('2026-12-01T00:00:00.000Z'),
  };

  it('accepts a hashed token and starts unrevoked', () => {
    const session = new SessionModel(valid);
    expect(session.validateSync()).toBeUndefined();
    expect(session.revokedAt).toBeNull();
    expect(session.revokedReason).toBeNull();
  });

  it('only accepts a SHA-256 hex digest, so a raw token cannot be stored by mistake', () => {
    const session = new SessionModel({ ...valid, tokenHash: 'raw-token-value' });
    expect(session.validateSync()?.errors.tokenHash).toBeDefined();
  });

  it('rejects an unknown revocation reason', () => {
    const session = new SessionModel({
      ...valid,
      revokedAt: new Date(),
      revokedReason: 'whatever',
    });
    expect(session.validateSync()?.errors.revokedReason).toBeDefined();
  });

  it('declares a unique token index, a per-user index and a TTL index on expiry', () => {
    const indexes = SessionModel.schema.indexes();
    expect(indexes).toContainEqual([{ tokenHash: 1 }, expect.objectContaining({ unique: true })]);
    expect(indexes).toContainEqual([{ userId: 1, revokedAt: 1 }, expect.anything()]);
    expect(indexes).toContainEqual([
      { expiresAt: 1 },
      expect.objectContaining({ expireAfterSeconds: 0 }),
    ]);
  });
});
