import { isValidObjectId, Types } from 'mongoose';
import { UserModel } from '../models/user.model';
import {
  WorkspaceMembershipModel,
  WorkspaceModel,
  type WorkspaceFields,
  type WorkspaceMembershipFields,
} from '../models/workspace.model';
import {
  DuplicateMembershipError,
  type MembershipRecord,
  type WorkspaceRecord,
  type WorkspaceRepository,
} from './workspace-repositories';

const DUPLICATE_KEY = 11000;
type WithId<T> = T & { _id: Types.ObjectId };

function toWorkspaceRecord(doc: WithId<WorkspaceFields>): WorkspaceRecord {
  return {
    id: doc._id.toString(),
    name: doc.name,
    description: doc.description,
    category: doc.category,
    timezone: doc.timezone,
    defaultLanguage: doc.defaultLanguage,
    status: doc.status,
    archivedAt: doc.archivedAt ?? null,
    createdBy: doc.createdBy.toString(),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function toMembershipRecord(doc: WorkspaceMembershipFields): MembershipRecord {
  return {
    workspaceId: doc.workspaceId.toString(),
    userId: doc.userId.toString(),
    role: doc.role,
    createdAt: doc.createdAt,
  };
}

/**
 * Mongoose-backed workspace repository. IDs are checked with isValidObjectId and converted to
 * ObjectId before they reach a filter, so a request value can never act as a query operator.
 */
export function createMongoWorkspaceRepository(): WorkspaceRepository {
  return {
    async createWithOwner(profile, ownerId) {
      const owner = new Types.ObjectId(ownerId);
      const created = await WorkspaceModel.create({ ...profile, createdBy: owner });
      try {
        await WorkspaceMembershipModel.create({
          workspaceId: created._id,
          userId: owner,
          role: 'owner',
        });
      } catch (error) {
        // Without its owner membership nobody could reach the workspace: remove it again.
        await WorkspaceModel.deleteOne({ _id: created._id });
        throw error;
      }
      return toWorkspaceRecord(created.toObject());
    },

    async findById(workspaceId) {
      if (!isValidObjectId(workspaceId)) return null;
      const doc = await WorkspaceModel.findById(workspaceId).lean();
      return doc ? toWorkspaceRecord(doc) : null;
    },

    async updateProfile(workspaceId, changes) {
      if (!isValidObjectId(workspaceId)) return null;
      const doc = await WorkspaceModel.findOneAndUpdate(
        { _id: new Types.ObjectId(workspaceId), status: 'active' },
        { $set: changes },
        { new: true, runValidators: true },
      ).lean();
      return doc ? toWorkspaceRecord(doc) : null;
    },

    async archive(workspaceId, at) {
      if (!isValidObjectId(workspaceId)) return null;
      const doc = await WorkspaceModel.findOneAndUpdate(
        { _id: new Types.ObjectId(workspaceId), status: 'active' },
        { $set: { status: 'archived', archivedAt: at } },
        { new: true },
      ).lean();
      return doc ? toWorkspaceRecord(doc) : null;
    },

    async listForUser(userId) {
      if (!isValidObjectId(userId)) return [];
      const memberships = await WorkspaceMembershipModel.find({
        userId: new Types.ObjectId(userId),
      }).lean();
      const roles = new Map(memberships.map((m) => [m.workspaceId.toString(), m.role]));
      const workspaces = await WorkspaceModel.find({
        _id: { $in: memberships.map((m) => m.workspaceId) },
        status: 'active',
      })
        .sort({ createdAt: 1, _id: 1 })
        .lean();
      return workspaces.flatMap((doc) => {
        const role = roles.get(doc._id.toString());
        return role ? [{ workspace: toWorkspaceRecord(doc), role }] : [];
      });
    },

    async countActiveOwnedBy(userId) {
      if (!isValidObjectId(userId)) return 0;
      const owned = await WorkspaceMembershipModel.find(
        { userId: new Types.ObjectId(userId), role: 'owner' },
        { workspaceId: 1 },
      ).lean();
      return WorkspaceModel.countDocuments({
        _id: { $in: owned.map((m) => m.workspaceId) },
        status: 'active',
      });
    },

    async findMembership(workspaceId, userId) {
      if (!isValidObjectId(workspaceId) || !isValidObjectId(userId)) return null;
      const doc = await WorkspaceMembershipModel.findOne({
        workspaceId: new Types.ObjectId(workspaceId),
        userId: new Types.ObjectId(userId),
      }).lean();
      return doc ? toMembershipRecord(doc) : null;
    },

    async addMember(workspaceId, userId, role) {
      try {
        const created = await WorkspaceMembershipModel.create({
          workspaceId: new Types.ObjectId(workspaceId),
          userId: new Types.ObjectId(userId),
          role,
        });
        return toMembershipRecord(created.toObject());
      } catch (error) {
        if ((error as { code?: unknown } | null)?.code === DUPLICATE_KEY) {
          throw new DuplicateMembershipError();
        }
        throw error;
      }
    },

    async listMembers(workspaceId) {
      if (!isValidObjectId(workspaceId)) return [];
      const memberships = await WorkspaceMembershipModel.find({
        workspaceId: new Types.ObjectId(workspaceId),
      })
        .sort({ createdAt: 1, _id: 1 })
        .lean();
      const users = await UserModel.find(
        { _id: { $in: memberships.map((m) => m.userId) } },
        { name: 1, email: 1 },
      ).lean();
      const byId = new Map(users.map((user) => [user._id.toString(), user]));
      return memberships.flatMap((membership) => {
        const user = byId.get(membership.userId.toString());
        return user
          ? [{ ...toMembershipRecord(membership), name: user.name, email: user.email }]
          : [];
      });
    },
  };
}
