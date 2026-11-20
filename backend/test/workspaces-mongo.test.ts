import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from '../src/config/database';
import { UserModel } from '../src/models/user.model';
import { WorkspaceMembershipModel, WorkspaceModel } from '../src/models/workspace.model';
import { createMongoAuthRepositories } from '../src/repositories/mongo-auth-repositories';
import { createMongoWorkspaceRepository } from '../src/repositories/mongo-workspace-repositories';
import { DuplicateMembershipError } from '../src/repositories/workspace-repositories';
import { createWorkspaceService } from '../src/services/workspace.service';
import { silentLogger } from './helpers';

/**
 * The MongoDB workspace repository against a real database. Runs only when MONGODB_TEST_URI
 * is set and its database name contains "test" (use metaflow_test). Removes exactly the
 * documents it created.
 */
const testUri = process.env.MONGODB_TEST_URI;

describe.runIf(testUri)('workspaces against a real MongoDB (MONGODB_TEST_URI)', () => {
  const runId = randomUUID().slice(0, 8);
  const database = createDatabase({ uri: testUri, logger: silentLogger, autoIndex: false });
  const users = createMongoAuthRepositories().users;
  const repository = createMongoWorkspaceRepository();
  const service = createWorkspaceService({ repository });
  const profile = (name: string) => ({
    name: `live-${runId}-${name}`,
    description: '',
    category: 'other' as const,
    timezone: 'UTC',
    defaultLanguage: 'en' as const,
  });
  const newUser = (label: string) =>
    users.create({
      name: label,
      email: `live-${runId}-ws-${label}@example.test`,
      passwordHash: 'scrypt$x',
    });

  beforeAll(async () => {
    await database.connect();
    const name = mongoose.connection.name;
    if (!/test/i.test(name)) {
      await database.disconnect();
      throw new Error(`Refusing to run: database "${name}" does not look like a test database`);
    }
    await WorkspaceMembershipModel.createIndexes();
  });

  afterAll(async () => {
    if (mongoose.connection.readyState === mongoose.ConnectionStates.connected) {
      const workspaces = await WorkspaceModel.find(
        { name: new RegExp(`^live-${runId}-`) },
        { _id: 1 },
      ).lean();
      await WorkspaceMembershipModel.deleteMany({
        workspaceId: { $in: workspaces.map((w) => w._id) },
      });
      await WorkspaceModel.deleteMany({ _id: { $in: workspaces.map((w) => w._id) } });
      await UserModel.deleteMany({ email: new RegExp(`^live-${runId}-ws-`) });
    }
    await database.disconnect();
  });

  it('creates a workspace with its owner membership and isolates it from other users', async () => {
    const [ada, mallory] = await Promise.all([newUser('ada'), newUser('mallory')]);
    const { workspace } = await service.create(ada.id, profile('bakery'));

    expect((await service.listForUser(ada.id)).map((w) => w.workspace.id)).toEqual([workspace.id]);
    expect(await service.listForUser(mallory.id)).toEqual([]);
    await expect(service.requireAccess(mallory.id, workspace.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('enforces one membership per user and workspace (unique index)', async () => {
    const [owner, staff] = await Promise.all([newUser('owner'), newUser('staff')]);
    const { workspace } = await service.create(owner.id, profile('team'));
    await repository.addMember(workspace.id, staff.id, 'staff');

    await expect(repository.addMember(workspace.id, staff.id, 'owner')).rejects.toBeInstanceOf(
      DuplicateMembershipError,
    );
    await expect(service.update(staff.id, workspace.id, { name: 'x' })).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
    expect((await service.listMembers(staff.id, workspace.id)).map((m) => m.role)).toEqual([
      'owner',
      'staff',
    ]);
  });

  it('updates only active workspaces and hides archived ones', async () => {
    const owner = await newUser('archiver');
    const { workspace } = await service.create(owner.id, profile('old'));
    const renamed = await service.update(owner.id, workspace.id, { timezone: 'Asia/Karachi' });
    expect(renamed.workspace.timezone).toBe('Asia/Karachi');

    await service.archive(owner.id, workspace.id, workspace.name);
    expect(await service.listForUser(owner.id)).toEqual([]);
    expect(await repository.updateProfile(workspace.id, { name: 'back' })).toBeNull();
    expect(await repository.countActiveOwnedBy(owner.id)).toBe(0);
  });
});
