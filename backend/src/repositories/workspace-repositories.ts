import type {
  BusinessCategory,
  WorkspaceLanguage,
  WorkspaceRole,
  WorkspaceStatus,
} from '@metaflow/shared';

/**
 * Data-access contract for workspaces and memberships. The service depends on this interface;
 * mongo-workspace-repositories.ts is the production implementation and test/support/ has an
 * in-memory one. Repositories never decide access: the service does, from memberships.
 */

export interface WorkspaceRecord {
  id: string;
  name: string;
  description: string;
  category: BusinessCategory;
  timezone: string;
  defaultLanguage: WorkspaceLanguage;
  status: WorkspaceStatus;
  archivedAt: Date | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkspaceProfile {
  name: string;
  description: string;
  category: BusinessCategory;
  timezone: string;
  defaultLanguage: WorkspaceLanguage;
}

export interface MembershipRecord {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  createdAt: Date;
}

/** A membership joined with the member's public user fields. */
export interface MemberRecord extends MembershipRecord {
  name: string;
  email: string;
}

export interface WorkspaceWithRole {
  workspace: WorkspaceRecord;
  role: WorkspaceRole;
}

export class DuplicateMembershipError extends Error {
  constructor() {
    super('This user is already a member of the workspace');
    this.name = 'DuplicateMembershipError';
  }
}

export interface WorkspaceRepository {
  /** Creates the workspace and its creator's owner membership together. */
  createWithOwner(profile: WorkspaceProfile, ownerId: string): Promise<WorkspaceRecord>;
  findById(workspaceId: string): Promise<WorkspaceRecord | null>;
  /** Null when the workspace does not exist or is not active. */
  updateProfile(
    workspaceId: string,
    changes: Partial<WorkspaceProfile>,
  ): Promise<WorkspaceRecord | null>;
  /** Null when the workspace does not exist or is already archived. */
  archive(workspaceId: string, at: Date): Promise<WorkspaceRecord | null>;
  /** Active workspaces the user belongs to, oldest first, each with the user's role. */
  listForUser(userId: string): Promise<WorkspaceWithRole[]>;
  countActiveOwnedBy(userId: string): Promise<number>;
  findMembership(workspaceId: string, userId: string): Promise<MembershipRecord | null>;
  /** Throws DuplicateMembershipError when the user is already a member. */
  addMember(workspaceId: string, userId: string, role: WorkspaceRole): Promise<MembershipRecord>;
  listMembers(workspaceId: string): Promise<MemberRecord[]>;
}
