import type {
  SocialAccountIssue,
  SocialAccountStatus,
  SocialAccountType,
  SocialPlatform,
} from '@metaflow/shared';

/**
 * Data-access contracts for connected social accounts and pending OAuth authorizations.
 * Every account method takes the workspace ID, so a query can never cross workspaces. The
 * service resolves that ID through workspaceService.requireAccess() first.
 */

/** A connected account without its token. */
export interface SocialAccountRecord {
  id: string;
  workspaceId: string;
  platform: SocialPlatform;
  externalId: string;
  name: string;
  username: string | null;
  accountType: SocialAccountType;
  profileImageUrl: string | null;
  status: SocialAccountStatus;
  issue: SocialAccountIssue | null;
  grantedPermissions: string[];
  missingPermissions: string[];
  tokenExpiresAt: Date | null;
  linkedPageId: string | null;
  connectedBy: string;
  connectedAt: Date;
  lastSyncedAt: Date | null;
}

export interface SocialConnection {
  workspaceId: string;
  platform: SocialPlatform;
  externalId: string;
  name: string;
  username: string | null;
  accountType: SocialAccountType;
  profileImageUrl: string | null;
  status: SocialAccountStatus;
  issue: SocialAccountIssue | null;
  grantedPermissions: string[];
  missingPermissions: string[];
  /** Already encrypted. Repositories never see a plaintext token. */
  encryptedToken: string;
  tokenExpiresAt: Date | null;
  linkedPageId: string | null;
  connectedBy: string;
  at: Date;
}

export type SocialAccountChanges = Partial<
  Pick<
    SocialAccountRecord,
    'name' | 'username' | 'profileImageUrl' | 'status' | 'issue' | 'lastSyncedAt'
  >
>;

export interface SocialAccountRepository {
  /**
   * Creates the connection, or replaces the token and details of the same external account in
   * the same workspace (reconnect). Never creates a second record for it.
   */
  upsertConnection(connection: SocialConnection): Promise<SocialAccountRecord>;
  listForWorkspace(workspaceId: string): Promise<SocialAccountRecord[]>;
  findInWorkspace(workspaceId: string, accountId: string): Promise<SocialAccountRecord | null>;
  /** The encrypted token, for server-side calls to the platform only. */
  findEncryptedToken(workspaceId: string, accountId: string): Promise<string | null>;
  update(
    workspaceId: string,
    accountId: string,
    changes: SocialAccountChanges,
  ): Promise<SocialAccountRecord | null>;
  /** Deletes the connection and its token. False when it did not exist in this workspace. */
  remove(workspaceId: string, accountId: string): Promise<boolean>;
}

export interface OAuthStateRecord {
  userId: string;
  workspaceId: string;
  platform: SocialPlatform;
  expiresAt: Date;
}

export interface OAuthStateRepository {
  create(state: OAuthStateRecord & { stateHash: string }): Promise<void>;
  /**
   * Atomically marks the state as used and returns it. Null when it is unknown or was already
   * used, so a state (and with it an authorization code) can be redeemed only once.
   */
  consume(stateHash: string, at: Date): Promise<OAuthStateRecord | null>;
}

export interface SocialRepositories {
  accounts: SocialAccountRepository;
  oauthStates: OAuthStateRepository;
}
