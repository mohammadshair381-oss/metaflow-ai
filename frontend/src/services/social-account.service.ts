import {
  connectSocialAccountResponseSchema,
  socialAccountListResponseSchema,
  socialAccountResponseSchema,
  workspaceRoutes,
  type SocialAccount,
  type SocialAccountListResponse,
  type SocialPlatform,
} from '@metaflow/shared';
import { z } from 'zod';
import { apiRequest } from './api-client';

const noContentSchema = z.undefined();

/** The workspace's connected accounts. The server checks that the caller belongs to it. */
export async function listSocialAccounts(
  workspaceId: string,
  signal?: AbortSignal,
): Promise<SocialAccountListResponse> {
  const { data } = await apiRequest(
    workspaceRoutes(workspaceId).socialAccounts,
    socialAccountListResponseSchema,
    { signal },
  );
  return data;
}

/**
 * Asks the server to start an authorization and returns the Facebook URL to open. Refuses
 * anything that is not Facebook's own login page, whatever the response says.
 */
export async function startSocialConnection(
  workspaceId: string,
  platform: SocialPlatform,
): Promise<string> {
  const { data } = await apiRequest(
    workspaceRoutes(workspaceId).socialConnect,
    connectSocialAccountResponseSchema,
    { method: 'POST', body: { platform } },
  );
  const url = new URL(data.authorizationUrl);
  if (url.protocol !== 'https:' || url.hostname !== 'www.facebook.com') {
    throw new Error('Unexpected authorization address');
  }
  return url.href;
}

export async function refreshSocialAccount(
  workspaceId: string,
  accountId: string,
): Promise<SocialAccount> {
  const { data } = await apiRequest(
    workspaceRoutes(workspaceId).socialAccountRefresh(accountId),
    socialAccountResponseSchema,
    { method: 'POST' },
  );
  return data.account;
}

export async function disconnectSocialAccount(
  workspaceId: string,
  accountId: string,
): Promise<void> {
  await apiRequest(workspaceRoutes(workspaceId).socialAccount(accountId), noContentSchema, {
    method: 'DELETE',
  });
}
