import { isValidObjectId, Types } from 'mongoose';
import { SessionModel, type SessionFields } from '../models/session.model';
import { UserModel, type UserFields } from '../models/user.model';
import {
  DuplicateEmailError,
  type AuthRepositories,
  type SessionRecord,
  type UserRecord,
} from './auth-repositories';

const DUPLICATE_KEY = 11000;

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === DUPLICATE_KEY
  );
}

type WithId<T> = T & { _id: Types.ObjectId };

function toUserRecord(doc: WithId<Omit<UserFields, 'passwordHash'>>): UserRecord {
  return {
    id: doc._id.toString(),
    name: doc.name,
    email: doc.email,
    status: doc.status,
    emailVerifiedAt: doc.emailVerifiedAt ?? null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function toSessionRecord(doc: WithId<SessionFields>): SessionRecord {
  return {
    id: doc._id.toString(),
    userId: doc.userId.toString(),
    tokenHash: doc.tokenHash,
    expiresAt: doc.expiresAt,
    revokedAt: doc.revokedAt ?? null,
    revokedReason: doc.revokedReason ?? null,
    createdAt: doc.createdAt,
  };
}

/**
 * Mongoose-backed repositories. Every filter value comes from validated input or server-side
 * computation (normalized email, SHA-256 hex, ObjectId), never from raw request objects.
 */
export function createMongoAuthRepositories(): AuthRepositories {
  return {
    users: {
      async create(user) {
        try {
          const created = await UserModel.create(user);
          return toUserRecord(created.toObject());
        } catch (error) {
          if (isDuplicateKeyError(error)) throw new DuplicateEmailError();
          throw error;
        }
      },

      async findCredentialsByEmail(email) {
        const doc = await UserModel.findOne({ email: String(email) })
          .select('+passwordHash')
          .lean();
        if (!doc) return null;
        const { passwordHash, ...rest } = doc;
        return { user: toUserRecord(rest), passwordHash };
      },

      async findById(id) {
        if (!isValidObjectId(id)) return null;
        const doc = await UserModel.findById(id).lean();
        return doc ? toUserRecord(doc) : null;
      },
    },

    sessions: {
      async create(session) {
        const created = await SessionModel.create({
          userId: new Types.ObjectId(session.userId),
          tokenHash: session.tokenHash,
          expiresAt: session.expiresAt,
        });
        return toSessionRecord(created.toObject());
      },

      async findByTokenHash(tokenHash) {
        const doc = await SessionModel.findOne({ tokenHash: String(tokenHash) }).lean();
        return doc ? toSessionRecord(doc) : null;
      },

      async revoke(sessionId, reason, at) {
        if (!isValidObjectId(sessionId)) return;
        await SessionModel.updateOne(
          { _id: sessionId, revokedAt: null },
          { $set: { revokedAt: at, revokedReason: reason } },
        );
      },

      async revokeAllForUser(userId, reason, at) {
        if (!isValidObjectId(userId)) return 0;
        const result = await SessionModel.updateMany(
          { userId: new Types.ObjectId(userId), revokedAt: null },
          { $set: { revokedAt: at, revokedReason: reason } },
        );
        return result.modifiedCount;
      },
    },
  };
}
