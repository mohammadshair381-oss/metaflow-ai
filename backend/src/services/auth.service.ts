import { randomBytes } from 'node:crypto';
import type { AuthUser, LoginRequest, RegisterRequest } from '@metaflow/shared';
import {
  DuplicateEmailError,
  type AuthRepositories,
  type SessionRecord,
  type UserRecord,
} from '../repositories/auth-repositories';
import { AppError } from '../utils/app-error';
import { hashPassword, verifyPassword } from '../utils/password';
import {
  generateSessionToken,
  hashSessionToken,
  isWellFormedSessionToken,
} from '../utils/session-token';

/** What the rest of the app learns about the caller once a session is validated. */
export interface AuthContext {
  user: UserRecord;
  session: SessionRecord;
}

/** A new session. The raw token goes into the cookie and nowhere else. */
export interface IssuedSession {
  user: UserRecord;
  token: string;
  expiresAt: Date;
}

export interface AuthService {
  register(input: RegisterRequest): Promise<IssuedSession>;
  /** `previousToken`: the caller's current session cookie, replaced to prevent session fixation. */
  login(input: LoginRequest, options?: { previousToken?: string }): Promise<IssuedSession>;
  /** Null for a missing, malformed, unknown, expired or revoked token, or an inactive user. */
  authenticate(token: string | undefined): Promise<AuthContext | null>;
  /** Revokes the session behind the token, if any. Idempotent. */
  logout(token: string | undefined): Promise<void>;
  /** Revokes every session of the user ("sign out everywhere"). */
  logoutAll(userId: string): Promise<number>;
}

export interface AuthServiceDependencies {
  repositories: AuthRepositories;
  sessionTtlMs: number;
  now?: () => Date;
}

/** The single mapping from a user record to what the API returns. No password data exists here. */
export function toAuthUser(user: UserRecord): AuthUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    status: user.status,
    emailVerified: user.emailVerifiedAt !== null,
    createdAt: user.createdAt.toISOString(),
  };
}

const INVALID_CREDENTIALS = () =>
  new AppError('INVALID_CREDENTIALS', 'Incorrect email or password');

export function createAuthService({
  repositories,
  sessionTtlMs,
  now = () => new Date(),
}: AuthServiceDependencies): AuthService {
  const { users, sessions } = repositories;

  // Hash checked when the email is unknown, so both failure paths cost the same time and an
  // attacker cannot tell registered addresses apart by response time.
  let decoyHash: Promise<string> | undefined;
  const getDecoyHash = () => (decoyHash ??= hashPassword(randomBytes(32).toString('hex')));

  async function issueSession(user: UserRecord): Promise<IssuedSession> {
    const token = generateSessionToken();
    const expiresAt = new Date(now().getTime() + sessionTtlMs);
    await sessions.create({ userId: user.id, tokenHash: hashSessionToken(token), expiresAt });
    return { user, token, expiresAt };
  }

  async function findLiveSession(token: string | undefined): Promise<SessionRecord | null> {
    if (!token || !isWellFormedSessionToken(token)) return null;
    const session = await sessions.findByTokenHash(hashSessionToken(token));
    if (!session || session.revokedAt !== null) return null;
    if (session.expiresAt.getTime() <= now().getTime()) return null;
    return session;
  }

  return {
    async register(input) {
      const passwordHash = await hashPassword(input.password);
      let user: UserRecord;
      try {
        user = await users.create({ name: input.name, email: input.email, passwordHash });
      } catch (error) {
        if (error instanceof DuplicateEmailError) {
          throw new AppError('EMAIL_TAKEN', 'An account with this email already exists');
        }
        throw error;
      }
      return issueSession(user);
    },

    async login(input, { previousToken } = {}) {
      const credentials = await users.findCredentialsByEmail(input.email);
      if (!credentials) {
        await verifyPassword(input.password, await getDecoyHash());
        throw INVALID_CREDENTIALS();
      }
      const passwordMatches = await verifyPassword(input.password, credentials.passwordHash);
      // A suspended account gets the same answer as a wrong password: no account-state oracle.
      if (!passwordMatches || credentials.user.status !== 'active') {
        throw INVALID_CREDENTIALS();
      }

      const previous = await findLiveSession(previousToken);
      if (previous) await sessions.revoke(previous.id, 'replaced', now());

      return issueSession(credentials.user);
    },

    async authenticate(token) {
      const session = await findLiveSession(token);
      if (!session) return null;
      const user = await users.findById(session.userId);
      if (!user || user.status !== 'active') return null;
      return { user, session };
    },

    async logout(token) {
      const session = await findLiveSession(token);
      if (session) await sessions.revoke(session.id, 'logout', now());
    },

    async logoutAll(userId) {
      return sessions.revokeAllForUser(userId, 'logout_all', now());
    },
  };
}
