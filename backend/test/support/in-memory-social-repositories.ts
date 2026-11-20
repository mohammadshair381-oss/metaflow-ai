import { randomBytes } from 'node:crypto';
import type {
  OAuthStateRecord,
  SocialAccountRecord,
  SocialRepositories,
} from '../../src/repositories/social-repositories';

type StoredAccount = SocialAccountRecord & { encryptedToken: string };
type StoredState = OAuthStateRecord & { stateHash: string; consumedAt: Date | null };

export interface InMemorySocialRepositories extends SocialRepositories {
  store: { accounts: Map<string, StoredAccount>; states: Map<string, StoredState> };
}

function withoutToken(stored: StoredAccount): SocialAccountRecord {
  const record: Partial<StoredAccount> = {
    ...stored,
    grantedPermissions: [...stored.grantedPermissions],
    missingPermissions: [...stored.missingPermissions],
  };
  delete record.encryptedToken;
  return record as SocialAccountRecord;
}

/**
 * Behaves like the MongoDB repositories where the service depends on it: one record per
 * external account and workspace, every lookup scoped by workspace, tokens only returned by
 * findEncryptedToken, and OAuth states that can be consumed exactly once.
 */
export function createInMemorySocialRepositories(): InMemorySocialRepositories {
  const accounts = new Map<string, StoredAccount>();
  const states = new Map<string, StoredState>();
  const inWorkspace = (workspaceId: string, accountId: string) => {
    const account = accounts.get(accountId);
    return account?.workspaceId === workspaceId ? account : undefined;
  };

  return {
    store: { accounts, states },

    accounts: {
      upsertConnection({ at, ...connection }) {
        const existing = [...accounts.values()].find(
          (account) =>
            account.workspaceId === connection.workspaceId &&
            account.platform === connection.platform &&
            account.externalId === connection.externalId,
        );
        const stored: StoredAccount = {
          ...connection,
          id: existing?.id ?? randomBytes(12).toString('hex'),
          connectedAt: at,
          lastSyncedAt: at,
        };
        accounts.set(stored.id, stored);
        return Promise.resolve(withoutToken(stored));
      },

      listForWorkspace(workspaceId) {
        return Promise.resolve(
          [...accounts.values()]
            .filter((account) => account.workspaceId === workspaceId)
            .sort((a, b) => `${a.platform}:${a.name}`.localeCompare(`${b.platform}:${b.name}`))
            .map(withoutToken),
        );
      },

      findInWorkspace(workspaceId, accountId) {
        const account = inWorkspace(workspaceId, accountId);
        return Promise.resolve(account ? withoutToken(account) : null);
      },

      findEncryptedToken(workspaceId, accountId) {
        return Promise.resolve(inWorkspace(workspaceId, accountId)?.encryptedToken ?? null);
      },

      update(workspaceId, accountId, changes) {
        const account = inWorkspace(workspaceId, accountId);
        if (!account) return Promise.resolve(null);
        const updated = { ...account, ...changes };
        accounts.set(accountId, updated);
        return Promise.resolve(withoutToken(updated));
      },

      remove(workspaceId, accountId) {
        return Promise.resolve(
          inWorkspace(workspaceId, accountId) ? accounts.delete(accountId) : false,
        );
      },
    },

    oauthStates: {
      create(state) {
        states.set(state.stateHash, { ...state, consumedAt: null });
        return Promise.resolve();
      },

      consume(stateHash, at) {
        const state = states.get(stateHash);
        if (!state || state.consumedAt !== null) return Promise.resolve(null);
        state.consumedAt = at;
        const { userId, workspaceId, platform, expiresAt } = state;
        return Promise.resolve({ userId, workspaceId, platform, expiresAt });
      },
    },
  };
}
