import type { AccountStatus } from '@metaflow/shared';
import type { SessionRevokeReason } from '../models/session.model';

/**
 * Data-access contracts for authentication. Services depend on these interfaces, not on
 * Mongoose, so they can be tested with in-memory implementations (test/support/).
 * The production implementation is mongo-auth-repositories.ts.
 */

/** A user as the application sees it. Deliberately has no password field. */
export interface UserRecord {
  id: string;
  name: string;
  email: string;
  status: AccountStatus;
  emailVerifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Returned only by the login lookup; the hash never travels further than the auth service. */
export interface UserCredentials {
  user: UserRecord;
  passwordHash: string;
}

export interface NewUser {
  name: string;
  /** Already normalized (trimmed, lower-case). */
  email: string;
  passwordHash: string;
}

export class DuplicateEmailError extends Error {
  constructor() {
    super('A user with this email already exists');
    this.name = 'DuplicateEmailError';
  }
}

export interface UserRepository {
  /** Throws DuplicateEmailError when the email is taken (enforced by a unique index). */
  create(user: NewUser): Promise<UserRecord>;
  findCredentialsByEmail(email: string): Promise<UserCredentials | null>;
  findById(id: string): Promise<UserRecord | null>;
}

export interface SessionRecord {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  revokedReason: SessionRevokeReason | null;
  createdAt: Date;
}

export interface NewSession {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
}

export interface SessionRepository {
  create(session: NewSession): Promise<SessionRecord>;
  /** Returns the session even if expired or revoked; validity is decided by the auth service. */
  findByTokenHash(tokenHash: string): Promise<SessionRecord | null>;
  revoke(sessionId: string, reason: SessionRevokeReason, at: Date): Promise<void>;
  /** Revokes every not-yet-revoked session of a user. Returns how many were revoked. */
  revokeAllForUser(userId: string, reason: SessionRevokeReason, at: Date): Promise<number>;
}

export interface AuthRepositories {
  users: UserRepository;
  sessions: SessionRepository;
}
