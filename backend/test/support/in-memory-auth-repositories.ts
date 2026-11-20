import { randomBytes } from 'node:crypto';
import {
  DuplicateEmailError,
  type AuthRepositories,
  type SessionRecord,
  type UserRecord,
} from '../../src/repositories/auth-repositories';

const objectId = () => randomBytes(12).toString('hex');

export interface InMemoryAuthRepositories extends AuthRepositories {
  /** Direct access for tests that need to age, revoke or inspect stored data. */
  store: {
    users: Map<string, UserRecord & { passwordHash: string }>;
    sessions: Map<string, SessionRecord>;
  };
}

/**
 * Behaves like the MongoDB repositories where it matters for the auth service:
 * a unique email (DuplicateEmailError), sessions returned regardless of validity, and
 * revocation that only touches sessions not already revoked. Records are copied in and out,
 * so callers can never mutate stored state by accident.
 */
export function createInMemoryAuthRepositories(): InMemoryAuthRepositories {
  const users = new Map<string, UserRecord & { passwordHash: string }>();
  const sessions = new Map<string, SessionRecord>();
  // Explicit field list: the stored hash can never leak into a returned record.
  const publicUser = (user: UserRecord): UserRecord => ({
    id: user.id,
    name: user.name,
    email: user.email,
    status: user.status,
    emailVerifiedAt: user.emailVerifiedAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  });

  return {
    store: { users, sessions },

    users: {
      create(input) {
        const email = input.email.trim().toLowerCase();
        if ([...users.values()].some((user) => user.email === email)) {
          return Promise.reject(new DuplicateEmailError());
        }
        const at = new Date();
        const user = {
          id: objectId(),
          name: input.name,
          email,
          passwordHash: input.passwordHash,
          status: 'active' as const,
          emailVerifiedAt: null,
          createdAt: at,
          updatedAt: at,
        };
        users.set(user.id, user);
        return Promise.resolve(publicUser(user));
      },

      findCredentialsByEmail(email) {
        const user = [...users.values()].find((candidate) => candidate.email === email);
        return Promise.resolve(
          user ? { user: publicUser(user), passwordHash: user.passwordHash } : null,
        );
      },

      findById(id) {
        const user = users.get(id);
        return Promise.resolve(user ? publicUser(user) : null);
      },
    },

    sessions: {
      create(input) {
        const session: SessionRecord = {
          id: objectId(),
          ...input,
          revokedAt: null,
          revokedReason: null,
          createdAt: new Date(),
        };
        sessions.set(session.id, session);
        return Promise.resolve({ ...session });
      },

      findByTokenHash(tokenHash) {
        const session = [...sessions.values()].find(
          (candidate) => candidate.tokenHash === tokenHash,
        );
        return Promise.resolve(session ? { ...session } : null);
      },

      revoke(sessionId, reason, at) {
        const session = sessions.get(sessionId);
        if (session && session.revokedAt === null) {
          sessions.set(sessionId, { ...session, revokedAt: at, revokedReason: reason });
        }
        return Promise.resolve();
      },

      revokeAllForUser(userId, reason, at) {
        let count = 0;
        for (const session of sessions.values()) {
          if (session.userId === userId && session.revokedAt === null) {
            sessions.set(session.id, { ...session, revokedAt: at, revokedReason: reason });
            count += 1;
          }
        }
        return Promise.resolve(count);
      },
    },
  };
}
