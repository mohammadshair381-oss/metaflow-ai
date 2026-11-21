import {
  MAX_OWNED_WORKSPACES,
  type CreateWorkspaceRequest,
  type UpdateWorkspaceRequest,
  type Workspace,
  type WorkspaceMember,
  type WorkspaceRole,
} from '@metaflow/shared';
import type {
  MemberRecord,
  WorkspaceRecord,
  WorkspaceRepository,
  WorkspaceWithRole,
} from '../repositories/workspace-repositories';
import { AppError } from '../utils/app-error';

/** A workspace the caller is allowed to use, with the caller's role in it. */
export type WorkspaceAccess = WorkspaceWithRole;

export interface WorkspaceService {
  create(userId: string, input: CreateWorkspaceRequest): Promise<WorkspaceAccess>;
  /** Active workspaces the user belongs to. */
  listForUser(userId: string): Promise<WorkspaceAccess[]>;
  /**
   * The tenant-isolation gate: every workspace-scoped operation in the application goes through
   * it. Throws NOT_FOUND when the workspace does not exist, is archived, or the user is not a
   * member (one answer for all three, so workspace IDs cannot be probed). Throws
   * PERMISSION_DENIED when the user is a member without the required role.
   */
  requireAccess(
    userId: string,
    workspaceId: string,
    options?: { role?: WorkspaceRole },
  ): Promise<WorkspaceAccess>;
  update(
    userId: string,
    workspaceId: string,
    changes: UpdateWorkspaceRequest,
  ): Promise<WorkspaceAccess>;
  /** Owner only. `confirmName` must match the workspace name. */
  archive(userId: string, workspaceId: string, confirmName: string): Promise<void>;
  listMembers(userId: string, workspaceId: string): Promise<MemberRecord[]>;
}

export function toWorkspace({ workspace, role }: WorkspaceAccess): Workspace {
  return {
    id: workspace.id,
    name: workspace.name,
    description: workspace.description,
    category: workspace.category,
    timezone: workspace.timezone,
    defaultLanguage: workspace.defaultLanguage,
    status: workspace.status,
    role,
    logoMediaId: workspace.logoMediaId,
    createdAt: workspace.createdAt.toISOString(),
    updatedAt: workspace.updatedAt.toISOString(),
  };
}

export function toWorkspaceMember(member: MemberRecord): WorkspaceMember {
  return {
    userId: member.userId,
    name: member.name,
    email: member.email,
    role: member.role,
    joinedAt: member.createdAt.toISOString(),
  };
}

const NOT_FOUND = () => new AppError('NOT_FOUND', 'Workspace not found');

export function createWorkspaceService({
  repository,
  now = () => new Date(),
}: {
  repository: WorkspaceRepository;
  now?: () => Date;
}): WorkspaceService {
  async function requireAccess(
    userId: string,
    workspaceId: string,
    { role }: { role?: WorkspaceRole } = {},
  ): Promise<WorkspaceAccess> {
    // Membership first: a non-member learns nothing about the workspace, not even its state.
    const membership = await repository.findMembership(workspaceId, userId);
    if (!membership) throw NOT_FOUND();
    const workspace = await repository.findById(workspaceId);
    if (!workspace || workspace.status !== 'active') throw NOT_FOUND();
    if (role && membership.role !== role) {
      throw new AppError('PERMISSION_DENIED', 'Only the workspace owner can do this');
    }
    return { workspace, role: membership.role };
  }

  const stillActive = (workspace: WorkspaceRecord | null) => {
    if (!workspace) throw NOT_FOUND();
    return workspace;
  };

  return {
    requireAccess,

    async create(userId, input) {
      if ((await repository.countActiveOwnedBy(userId)) >= MAX_OWNED_WORKSPACES) {
        throw new AppError(
          'LIMIT_REACHED',
          `You can own up to ${MAX_OWNED_WORKSPACES} workspaces. Archive one to create another.`,
        );
      }
      const workspace = await repository.createWithOwner(input, userId);
      return { workspace, role: 'owner' };
    },

    listForUser: (userId) => repository.listForUser(userId),

    async update(userId, workspaceId, changes) {
      const access = await requireAccess(userId, workspaceId, { role: 'owner' });
      const defined = Object.fromEntries(
        Object.entries(changes).filter(([, value]) => value !== undefined),
      );
      const workspace = stillActive(await repository.updateProfile(workspaceId, defined));
      return { workspace, role: access.role };
    },

    async archive(userId, workspaceId, confirmName) {
      const { workspace } = await requireAccess(userId, workspaceId, { role: 'owner' });
      if (confirmName.trim() !== workspace.name) {
        throw AppError.validation([
          { path: 'body.confirmName', message: 'This does not match the workspace name' },
        ]);
      }
      stillActive(await repository.archive(workspaceId, now()));
    },

    async listMembers(userId, workspaceId) {
      await requireAccess(userId, workspaceId);
      return repository.listMembers(workspaceId);
    },
  };
}
