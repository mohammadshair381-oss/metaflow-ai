import {
  META_PERMISSIONS,
  type MetaConnectResult,
  type SocialAccount,
  type SocialAccountIssue,
  type SocialPlatform,
} from '@metaflow/shared';
import { MetaApiError, type MetaClient, type MetaPage } from '../integrations/meta/meta-client';
import type {
  SocialAccountRecord,
  SocialConnection,
  SocialRepositories,
} from '../repositories/social-repositories';
import { AppError } from '../utils/app-error';
import type { Logger } from '../utils/logger';
import { SecretBoxError, type SecretBox } from '../utils/secret-box';
import {
  generateSessionToken,
  hashSessionToken,
  isWellFormedSessionToken,
} from '../utils/session-token';
import type { WorkspaceService } from './workspace.service';

/** How long a person has to finish authorizing on Facebook. */
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

/** Everything needed to talk to Meta and store tokens. Null until the server is configured. */
export interface SocialIntegration {
  meta: MetaClient;
  secretBox: SecretBox;
}

export interface CallbackInput {
  /** From the verified session cookie, or null when the browser has no valid session. */
  userId: string | null;
  state: string | undefined;
  code: string | undefined;
  /** Meta's `error` parameter (e.g. access_denied). Only its presence is used. */
  error: string | undefined;
}

export interface CallbackOutcome {
  result: MetaConnectResult;
  /** Accounts connected or reconnected. */
  count: number;
}

export interface SocialAccountService {
  readonly configured: boolean;
  list(userId: string, workspaceId: string): Promise<SocialAccountRecord[]>;
  get(userId: string, workspaceId: string, accountId: string): Promise<SocialAccountRecord>;
  /** Owner only. Returns the facebook.com URL the browser must open. */
  startConnection(userId: string, workspaceId: string, platform: SocialPlatform): Promise<string>;
  /** Handles Meta's redirect. Never throws for expected failures: the outcome says what happened. */
  completeConnection(input: CallbackInput): Promise<CallbackOutcome>;
  /** Re-reads the account from Meta and records whether its authorization still works. */
  refresh(userId: string, workspaceId: string, accountId: string): Promise<SocialAccountRecord>;
  /** Owner only. Deletes the connection and its stored token. */
  disconnect(userId: string, workspaceId: string, accountId: string): Promise<void>;
}

export function toSocialAccount(record: SocialAccountRecord): SocialAccount {
  return {
    id: record.id,
    platform: record.platform,
    externalId: record.externalId,
    name: record.name,
    username: record.username,
    accountType: record.accountType,
    profileImageUrl: record.profileImageUrl,
    status: record.status,
    issue: record.issue,
    grantedPermissions: record.grantedPermissions,
    missingPermissions: record.missingPermissions,
    tokenExpiresAt: record.tokenExpiresAt?.toISOString() ?? null,
    connectedAt: record.connectedAt.toISOString(),
    lastSyncedAt: record.lastSyncedAt?.toISOString() ?? null,
  };
}

/** Binds a stored token to its record, so it cannot be decrypted from anywhere else. */
export const tokenContext = (
  account: Pick<SocialAccountRecord, 'workspaceId' | 'platform' | 'externalId'>,
) => `social-token:${account.workspaceId}:${account.platform}:${account.externalId}`;

const NOT_FOUND = () => new AppError('NOT_FOUND', 'Social account not found');
const NOT_CONFIGURED = () =>
  new AppError(
    'INTEGRATION_NOT_CONFIGURED',
    'Connecting social accounts is not set up on this server yet.',
  );

export function createSocialAccountService({
  workspaces,
  repositories,
  integration,
  logger,
  now = () => new Date(),
}: {
  workspaces: Pick<WorkspaceService, 'requireAccess'>;
  repositories: SocialRepositories;
  integration: SocialIntegration | null;
  logger: Logger;
  now?: () => Date;
}): SocialAccountService {
  const { accounts, oauthStates } = repositories;

  async function findAccount(workspaceId: string, accountId: string) {
    const account = await accounts.findInWorkspace(workspaceId, accountId);
    if (!account) throw NOT_FOUND();
    return account;
  }

  /** The accounts one authorization yields for the platform the person asked to connect. */
  function connectionsFrom(
    pages: MetaPage[],
    platform: SocialPlatform,
    granted: string[],
    base: Pick<SocialConnection, 'workspaceId' | 'connectedBy' | 'at'>,
    secretBox: SecretBox,
  ): SocialConnection[] {
    const missingPermissions = META_PERMISSIONS[platform].filter(
      (permission) => !granted.includes(permission),
    );
    return pages.flatMap((page): SocialConnection[] => {
      if (platform === 'instagram' && !page.instagram) return [];
      const issue: SocialAccountIssue | null =
        missingPermissions.length > 0
          ? 'missing_permissions'
          : page.tasks.includes('CREATE_CONTENT')
            ? null
            : 'insufficient_page_role';
      const identity =
        platform === 'instagram' && page.instagram
          ? {
              externalId: page.instagram.id,
              name: page.instagram.name ?? page.instagram.username ?? page.name,
              username: page.instagram.username,
              accountType: 'instagram_professional' as const,
              profileImageUrl: page.instagram.pictureUrl,
              linkedPageId: page.id,
            }
          : {
              externalId: page.id,
              name: page.name,
              username: null,
              accountType: 'facebook_page' as const,
              profileImageUrl: page.pictureUrl,
              linkedPageId: null,
            };
      return [
        {
          ...base,
          ...identity,
          platform,
          status: issue ? 'needs_reconnect' : 'connected',
          issue,
          grantedPermissions: granted,
          missingPermissions,
          // Both platforms are operated with the Page access token (Meta: Instagram content
          // publishing uses the linked Page's token). It has no fixed expiry.
          encryptedToken: secretBox.encrypt(
            page.accessToken,
            tokenContext({
              workspaceId: base.workspaceId,
              platform,
              externalId: identity.externalId,
            }),
          ),
          tokenExpiresAt: null,
        },
      ];
    });
  }

  return {
    configured: integration !== null,

    async list(userId, workspaceId) {
      await workspaces.requireAccess(userId, workspaceId);
      return accounts.listForWorkspace(workspaceId);
    },

    async get(userId, workspaceId, accountId) {
      await workspaces.requireAccess(userId, workspaceId);
      return findAccount(workspaceId, accountId);
    },

    async startConnection(userId, workspaceId, platform) {
      await workspaces.requireAccess(userId, workspaceId, { role: 'owner' });
      if (!integration) throw NOT_CONFIGURED();
      // 256 random bits. Only its hash is stored, bound to this user and workspace.
      const state = generateSessionToken();
      await oauthStates.create({
        stateHash: hashSessionToken(state),
        userId,
        workspaceId,
        platform,
        expiresAt: new Date(now().getTime() + OAUTH_STATE_TTL_MS),
      });
      return integration.meta.authorizationUrl({ state, scopes: META_PERMISSIONS[platform] });
    },

    async completeConnection({ userId, state, code, error }) {
      const outcome = (result: MetaConnectResult, count = 0): CallbackOutcome => ({
        result,
        count,
      });
      if (!integration) return outcome('not_configured');
      if (!state || !isWellFormedSessionToken(state)) return outcome('invalid_state');

      // Single use: consumed before anything else, whatever happens next.
      const pending = await oauthStates.consume(hashSessionToken(state), now());
      if (!pending || pending.expiresAt.getTime() <= now().getTime()) {
        return outcome('invalid_state');
      }
      if (!userId) return outcome('session_expired');
      // The browser finishing the flow must be the user who started it.
      if (userId !== pending.userId) return outcome('invalid_state');

      // The workspace comes from the stored state, never from the callback URL, and the
      // person must still be its owner now.
      try {
        await workspaces.requireAccess(userId, pending.workspaceId, { role: 'owner' });
      } catch (failure) {
        if (failure instanceof AppError) return outcome('not_allowed');
        throw failure;
      }
      if (error || !code) return outcome('denied');

      let connections: SocialConnection[];
      try {
        const shortLived = await integration.meta.exchangeCode(code);
        const longLived = await integration.meta.exchangeForLongLivedToken(shortLived.accessToken);
        const granted = await integration.meta.grantedPermissions(longLived.accessToken);
        const pages = await integration.meta.listPages(longLived.accessToken);
        // The user token is used for discovery only and is not kept.
        connections = connectionsFrom(
          pages,
          pending.platform,
          granted,
          { workspaceId: pending.workspaceId, connectedBy: userId, at: now() },
          integration.secretBox,
        );
      } catch (failure) {
        if (!(failure instanceof MetaApiError)) throw failure;
        logger.warn('social.meta.connect_failed', { kind: failure.kind, code: failure.code });
        return outcome('exchange_failed');
      }

      if (connections.length === 0) return outcome('no_accounts');
      for (const connection of connections) await accounts.upsertConnection(connection);
      return outcome('connected', connections.length);
    },

    async refresh(userId, workspaceId, accountId) {
      await workspaces.requireAccess(userId, workspaceId);
      if (!integration) throw NOT_CONFIGURED();
      const account = await findAccount(workspaceId, accountId);
      const flag = async (issue: SocialAccountIssue) =>
        (await accounts.update(workspaceId, accountId, { status: 'needs_reconnect', issue })) ??
        account;

      const encrypted = await accounts.findEncryptedToken(workspaceId, accountId);
      let token: string;
      try {
        if (!encrypted) throw new SecretBoxError('No stored token');
        token = integration.secretBox.decrypt(encrypted, tokenContext(account));
      } catch (failure) {
        if (!(failure instanceof SecretBoxError)) throw failure;
        logger.error('social.token.unreadable', { accountId, reason: failure.message });
        return flag('token_invalid');
      }

      try {
        const profile =
          account.platform === 'instagram'
            ? await integration.meta.getInstagramAccount(account.externalId, token).then((ig) => ({
                name: ig.name ?? ig.username ?? account.name,
                username: ig.username,
                profileImageUrl: ig.pictureUrl,
              }))
            : await integration.meta.getPage(account.externalId, token).then((page) => ({
                name: page.name,
                username: null,
                profileImageUrl: page.pictureUrl,
              }));
        // A working token clears an earlier "token invalid" flag; other issues stay until
        // the account is reconnected with the right permissions.
        const recovered = account.issue === 'token_invalid';
        const updated = await accounts.update(workspaceId, accountId, {
          ...profile,
          lastSyncedAt: now(),
          ...(recovered ? { status: 'connected' as const, issue: null } : {}),
        });
        return updated ?? account;
      } catch (failure) {
        if (!(failure instanceof MetaApiError)) throw failure;
        if (failure.kind === 'token') return flag('token_invalid');
        if (failure.kind === 'permission') return flag('missing_permissions');
        logger.warn('social.meta.refresh_failed', { kind: failure.kind, code: failure.code });
        throw new AppError(
          'INTEGRATION_ERROR',
          failure.kind === 'rate_limit'
            ? 'Meta is limiting requests right now. Try again in a few minutes.'
            : 'Meta did not answer. Try again shortly.',
        );
      }
    },

    async disconnect(userId, workspaceId, accountId) {
      await workspaces.requireAccess(userId, workspaceId, { role: 'owner' });
      if (!(await accounts.remove(workspaceId, accountId))) throw NOT_FOUND();
    },
  };
}
