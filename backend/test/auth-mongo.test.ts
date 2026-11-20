import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from '../src/config/database';
import { SessionModel } from '../src/models/session.model';
import { UserModel } from '../src/models/user.model';
import { DuplicateEmailError } from '../src/repositories/auth-repositories';
import { createMongoAuthRepositories } from '../src/repositories/mongo-auth-repositories';
import { createAuthService } from '../src/services/auth.service';
import { silentLogger } from './helpers';

/**
 * Runs the MongoDB repositories and auth service against a real database, including the
 * unique email index and duplicate handling. Only when MONGODB_TEST_URI is set, and only if
 * its database name contains "test", so it can never write to the application database.
 * Cleans up exactly the documents it created; never drops anything.
 */
const testUri = process.env.MONGODB_TEST_URI;

describe.runIf(testUri)('auth against a real MongoDB (MONGODB_TEST_URI)', () => {
  const runId = randomUUID().slice(0, 8);
  const email = (label: string) => `live-${runId}-${label}@example.test`;
  const database = createDatabase({ uri: testUri, logger: silentLogger, autoIndex: false });
  const repositories = createMongoAuthRepositories();
  const service = createAuthService({ repositories, sessionTtlMs: 60 * 60 * 1000 });

  beforeAll(async () => {
    await database.connect();
    const name = mongoose.connection.name;
    if (!/test/i.test(name)) {
      await database.disconnect();
      throw new Error(`Refusing to run: database "${name}" does not look like a test database`);
    }
    await UserModel.createIndexes();
    await SessionModel.createIndexes();
  });

  afterAll(async () => {
    if (mongoose.connection.readyState === mongoose.ConnectionStates.connected) {
      const users = await UserModel.find(
        { email: new RegExp(`^live-${runId}-`) },
        { _id: 1 },
      ).lean();
      await SessionModel.deleteMany({ userId: { $in: users.map((user) => user._id) } });
      await UserModel.deleteMany({ _id: { $in: users.map((user) => user._id) } });
    }
    await database.disconnect();
  });

  it('enforces the unique email index (DuplicateEmailError)', async () => {
    await repositories.users.create({ name: 'A', email: email('dup'), passwordHash: 'scrypt$x' });
    await expect(
      repositories.users.create({ name: 'B', email: email('dup'), passwordHash: 'scrypt$y' }),
    ).rejects.toBeInstanceOf(DuplicateEmailError);
  });

  it('never returns the password hash except from the credentials lookup', async () => {
    const created = await repositories.users.create({
      name: 'C',
      email: email('hash'),
      passwordHash: 'scrypt$z',
    });
    expect(created).not.toHaveProperty('passwordHash');
    expect(await repositories.users.findById(created.id)).not.toHaveProperty('passwordHash');
    expect((await repositories.users.findCredentialsByEmail(email('hash')))?.passwordHash).toBe(
      'scrypt$z',
    );
  });

  it('registers, authenticates, logs out and rejects the revoked session', async () => {
    const issued = await service.register({
      name: 'Live',
      email: email('flow'),
      password: 'correct horse battery staple',
    });
    expect((await service.authenticate(issued.token))?.user.email).toBe(email('flow'));

    const stored = await SessionModel.findOne({ userId: issued.user.id }).lean();
    expect(stored?.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(stored?.tokenHash).not.toBe(issued.token);

    await service.logout(issued.token);
    expect(await service.authenticate(issued.token)).toBeNull();
  });

  it('revokes all sessions of a user', async () => {
    const issued = await service.register({
      name: 'All',
      email: email('all'),
      password: 'correct horse battery staple',
    });
    const second = await service.login({
      email: email('all'),
      password: 'correct horse battery staple',
    });
    expect(await service.logoutAll(issued.user.id)).toBe(2);
    expect(await service.authenticate(issued.token)).toBeNull();
    expect(await service.authenticate(second.token)).toBeNull();
  });
});
