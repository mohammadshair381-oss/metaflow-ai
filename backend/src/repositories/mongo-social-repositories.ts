import { isValidObjectId, Types } from 'mongoose';
import {
  OAuthStateModel,
  SocialAccountModel,
  type SocialAccountFields,
} from '../models/social-account.model';
import type { SocialAccountRecord, SocialRepositories } from './social-repositories';

type AccountDoc = Omit<SocialAccountFields, 'encryptedToken'> & { _id: Types.ObjectId };

function toRecord(doc: AccountDoc): SocialAccountRecord {
  return {
    id: doc._id.toString(),
    workspaceId: doc.workspaceId.toString(),
    platform: doc.platform,
    externalId: doc.externalId,
    name: doc.name,
    username: doc.username ?? null,
    accountType: doc.accountType,
    profileImageUrl: doc.profileImageUrl ?? null,
    status: doc.status,
    issue: doc.issue ?? null,
    grantedPermissions: [...doc.grantedPermissions],
    missingPermissions: [...doc.missingPermissions],
    tokenExpiresAt: doc.tokenExpiresAt ?? null,
    linkedPageId: doc.linkedPageId ?? null,
    connectedBy: doc.connectedBy.toString(),
    connectedAt: doc.connectedAt,
    lastSyncedAt: doc.lastSyncedAt ?? null,
  };
}

/** The filter every single-account query uses: the account must belong to the workspace. */
function scoped(workspaceId: string, accountId: string) {
  if (!isValidObjectId(workspaceId) || !isValidObjectId(accountId)) return null;
  return { _id: new Types.ObjectId(accountId), workspaceId: new Types.ObjectId(workspaceId) };
}

export function createMongoSocialRepositories(): SocialRepositories {
  return {
    accounts: {
      async upsertConnection(connection) {
        const { workspaceId, platform, externalId, connectedBy, at, ...details } = connection;
        const doc = await SocialAccountModel.findOneAndUpdate(
          {
            workspaceId: new Types.ObjectId(workspaceId),
            platform,
            externalId: String(externalId),
          },
          {
            $set: {
              ...details,
              connectedBy: new Types.ObjectId(connectedBy),
              connectedAt: at,
              lastSyncedAt: at,
            },
          },
          { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
        ).lean();
        return toRecord(doc);
      },

      async listForWorkspace(workspaceId) {
        if (!isValidObjectId(workspaceId)) return [];
        const docs = await SocialAccountModel.find({ workspaceId: new Types.ObjectId(workspaceId) })
          .sort({ platform: 1, name: 1, _id: 1 })
          .lean();
        return docs.map(toRecord);
      },

      async findInWorkspace(workspaceId, accountId) {
        const filter = scoped(workspaceId, accountId);
        if (!filter) return null;
        const doc = await SocialAccountModel.findOne(filter).lean();
        return doc ? toRecord(doc) : null;
      },

      async findEncryptedToken(workspaceId, accountId) {
        const filter = scoped(workspaceId, accountId);
        if (!filter) return null;
        const doc = await SocialAccountModel.findOne(filter).select('+encryptedToken').lean();
        return doc?.encryptedToken ?? null;
      },

      async update(workspaceId, accountId, changes) {
        const filter = scoped(workspaceId, accountId);
        if (!filter) return null;
        const doc = await SocialAccountModel.findOneAndUpdate(
          filter,
          { $set: changes },
          { new: true, runValidators: true },
        ).lean();
        return doc ? toRecord(doc) : null;
      },

      async remove(workspaceId, accountId) {
        const filter = scoped(workspaceId, accountId);
        if (!filter) return false;
        return (await SocialAccountModel.deleteOne(filter)).deletedCount === 1;
      },
    },

    oauthStates: {
      async create(state) {
        await OAuthStateModel.create({
          stateHash: state.stateHash,
          userId: new Types.ObjectId(state.userId),
          workspaceId: new Types.ObjectId(state.workspaceId),
          platform: state.platform,
          expiresAt: state.expiresAt,
        });
      },

      async consume(stateHash, at) {
        const doc = await OAuthStateModel.findOneAndUpdate(
          { stateHash: String(stateHash), consumedAt: null },
          { $set: { consumedAt: at } },
          { new: true },
        ).lean();
        if (!doc) return null;
        return {
          userId: doc.userId.toString(),
          workspaceId: doc.workspaceId.toString(),
          platform: doc.platform,
          expiresAt: doc.expiresAt,
        };
      },
    },
  };
}
