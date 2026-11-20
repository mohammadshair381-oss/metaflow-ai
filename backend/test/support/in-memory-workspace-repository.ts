import { randomBytes } from 'node:crypto';
import type { UserRepository } from '../../src/repositories/auth-repositories';
import {
  DuplicateMembershipError,
  type MembershipRecord,
  type WorkspaceRecord,
  type WorkspaceRepository,
} from '../../src/repositories/workspace-repositories';

const objectId = () => randomBytes(12).toString('hex');

export interface InMemoryWorkspaceRepository extends WorkspaceRepository {
  store: { workspaces: Map<string, WorkspaceRecord>; memberships: MembershipRecord[] };
}

/**
 * Behaves like the MongoDB repository where the service depends on it: one membership per
 * user and workspace, updates and archiving only for active workspaces, records copied out.
 */
export function createInMemoryWorkspaceRepository(
  users: Pick<UserRepository, 'findById'>,
): InMemoryWorkspaceRepository {
  const workspaces = new Map<string, WorkspaceRecord>();
  const memberships: MembershipRecord[] = [];
  let clock = Date.now();
  const tick = () => new Date((clock += 1));
  const membershipOf = (workspaceId: string, userId: string) =>
    memberships.find((m) => m.workspaceId === workspaceId && m.userId === userId);

  return {
    store: { workspaces, memberships },

    createWithOwner(profile, ownerId) {
      const at = tick();
      const workspace: WorkspaceRecord = {
        id: objectId(),
        ...profile,
        status: 'active',
        archivedAt: null,
        createdBy: ownerId,
        createdAt: at,
        updatedAt: at,
      };
      workspaces.set(workspace.id, workspace);
      memberships.push({
        workspaceId: workspace.id,
        userId: ownerId,
        role: 'owner',
        createdAt: at,
      });
      return Promise.resolve({ ...workspace });
    },

    findById(workspaceId) {
      const workspace = workspaces.get(workspaceId);
      return Promise.resolve(workspace ? { ...workspace } : null);
    },

    updateProfile(workspaceId, changes) {
      const workspace = workspaces.get(workspaceId);
      if (!workspace || workspace.status !== 'active') return Promise.resolve(null);
      const updated = { ...workspace, ...changes, updatedAt: tick() };
      workspaces.set(workspaceId, updated);
      return Promise.resolve({ ...updated });
    },

    archive(workspaceId, at) {
      const workspace = workspaces.get(workspaceId);
      if (!workspace || workspace.status !== 'active') return Promise.resolve(null);
      const updated = { ...workspace, status: 'archived' as const, archivedAt: at, updatedAt: at };
      workspaces.set(workspaceId, updated);
      return Promise.resolve({ ...updated });
    },

    listForUser(userId) {
      return Promise.resolve(
        memberships
          .filter((m) => m.userId === userId)
          .flatMap((m) => {
            const workspace = workspaces.get(m.workspaceId);
            return workspace?.status === 'active'
              ? [{ workspace: { ...workspace }, role: m.role }]
              : [];
          })
          .sort((a, b) => a.workspace.createdAt.getTime() - b.workspace.createdAt.getTime()),
      );
    },

    countActiveOwnedBy(userId) {
      return Promise.resolve(
        memberships.filter(
          (m) =>
            m.userId === userId &&
            m.role === 'owner' &&
            workspaces.get(m.workspaceId)?.status === 'active',
        ).length,
      );
    },

    findMembership(workspaceId, userId) {
      const membership = membershipOf(workspaceId, userId);
      return Promise.resolve(membership ? { ...membership } : null);
    },

    addMember(workspaceId, userId, role) {
      if (membershipOf(workspaceId, userId)) return Promise.reject(new DuplicateMembershipError());
      const membership: MembershipRecord = { workspaceId, userId, role, createdAt: tick() };
      memberships.push(membership);
      return Promise.resolve({ ...membership });
    },

    async listMembers(workspaceId) {
      const result = [];
      for (const membership of memberships.filter((m) => m.workspaceId === workspaceId)) {
        const user = await users.findById(membership.userId);
        if (user) result.push({ ...membership, name: user.name, email: user.email });
      }
      return result;
    },
  };
}
