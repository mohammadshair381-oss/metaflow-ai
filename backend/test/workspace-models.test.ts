import { describe, expect, it } from 'vitest';
import { WorkspaceMembershipModel, WorkspaceModel } from '../src/models/workspace.model';

const USER_ID = '65f0c0ffee0000000000abcd';
const WORKSPACE_ID = '65f0c0ffee0000000000dcba';

/** Schema-level checks; no database connection is opened. */
describe('Workspace model', () => {
  it('requires a name and a creator, and fills in defaults', () => {
    expect(Object.keys(new WorkspaceModel({}).validateSync()?.errors ?? {}).sort()).toEqual([
      'createdBy',
      'name',
    ]);
    const workspace = new WorkspaceModel({ name: ' Bloom ', createdBy: USER_ID });
    expect(workspace.validateSync()).toBeUndefined();
    expect(workspace).toMatchObject({
      name: 'Bloom',
      description: '',
      category: 'other',
      timezone: 'UTC',
      defaultLanguage: 'en',
      status: 'active',
      archivedAt: null,
    });
  });

  it.each([
    ['category', 'casino'],
    ['timezone', 'Mars/Olympus'],
    ['defaultLanguage', 'xx'],
    ['status', 'deleted'],
  ])('rejects an unknown %s', (field, value) => {
    const workspace = new WorkspaceModel({ name: 'A', createdBy: USER_ID, [field]: value });
    expect(workspace.validateSync()?.errors[field]).toBeDefined();
  });
});

describe('WorkspaceMembership model', () => {
  it('only accepts the owner and staff roles', () => {
    const base = { workspaceId: WORKSPACE_ID, userId: USER_ID };
    expect(new WorkspaceMembershipModel({ ...base, role: 'owner' }).validateSync()).toBeUndefined();
    expect(new WorkspaceMembershipModel({ ...base, role: 'staff' }).validateSync()).toBeUndefined();
    for (const role of ['admin', 'super_admin', undefined]) {
      expect(
        new WorkspaceMembershipModel({ ...base, role }).validateSync()?.errors.role,
      ).toBeDefined();
    }
  });

  it('declares one membership per user and workspace, and a per-user index', () => {
    const indexes = WorkspaceMembershipModel.schema.indexes();
    expect(indexes).toContainEqual([
      { workspaceId: 1, userId: 1 },
      expect.objectContaining({ unique: true }),
    ]);
    expect(indexes).toContainEqual([{ userId: 1, role: 1 }, expect.anything()]);
  });
});
