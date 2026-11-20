import { z } from 'zod';

/** Where content can be published. Both are reached through Meta's Facebook Login. */
export const SOCIAL_PLATFORMS = ['facebook', 'instagram'] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

export const SOCIAL_ACCOUNT_TYPES = ['facebook_page', 'instagram_professional'] as const;
export type SocialAccountType = (typeof SOCIAL_ACCOUNT_TYPES)[number];

export const SOCIAL_ACCOUNT_STATUSES = ['connected', 'needs_reconnect'] as const;
export type SocialAccountStatus = (typeof SOCIAL_ACCOUNT_STATUSES)[number];

/** Why an account needs attention. */
export const SOCIAL_ACCOUNT_ISSUES = [
  /** Meta says the stored authorization is expired, revoked or otherwise invalid. */
  'token_invalid',
  /** The person did not grant (or later removed) a permission publishing needs. */
  'missing_permissions',
  /** The person who connected the Page cannot create content on it. */
  'insufficient_page_role',
] as const;
export type SocialAccountIssue = (typeof SOCIAL_ACCOUNT_ISSUES)[number];

/**
 * Meta permissions requested per platform (verified against Meta's documentation for
 * Graph API v27.0: Pages API "Posts", Instagram API with Facebook Login "Content publishing").
 */
export const META_PERMISSIONS: Record<SocialPlatform, readonly string[]> = {
  facebook: ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts'],
  instagram: [
    'pages_show_list',
    'pages_read_engagement',
    'instagram_basic',
    'instagram_content_publish',
  ],
};

/** A connected account as the API returns it. It never contains a token. */
export const socialAccountSchema = z.object({
  id: z.string(),
  platform: z.enum(SOCIAL_PLATFORMS),
  /** The Page ID or Instagram account ID on Meta. */
  externalId: z.string(),
  name: z.string(),
  username: z.string().nullable(),
  accountType: z.enum(SOCIAL_ACCOUNT_TYPES),
  profileImageUrl: z.string().nullable(),
  status: z.enum(SOCIAL_ACCOUNT_STATUSES),
  issue: z.enum(SOCIAL_ACCOUNT_ISSUES).nullable(),
  grantedPermissions: z.array(z.string()),
  missingPermissions: z.array(z.string()),
  /** Null when the authorization has no fixed expiry (Page tokens). */
  tokenExpiresAt: z.iso.datetime().nullable(),
  connectedAt: z.iso.datetime(),
  lastSyncedAt: z.iso.datetime().nullable(),
});
export type SocialAccount = z.infer<typeof socialAccountSchema>;

export const socialAccountResponseSchema = z.object({ account: socialAccountSchema });
export type SocialAccountResponse = z.infer<typeof socialAccountResponseSchema>;

export const socialAccountListResponseSchema = z.object({
  accounts: z.array(socialAccountSchema),
  /** False until the server has Meta app credentials: connecting is then unavailable. */
  integration: z.object({ configured: z.boolean() }),
});
export type SocialAccountListResponse = z.infer<typeof socialAccountListResponseSchema>;

export const connectSocialAccountRequestSchema = z.object({
  platform: z.enum(SOCIAL_PLATFORMS, { error: 'Choose Facebook or Instagram' }),
});
export type ConnectSocialAccountRequest = z.infer<typeof connectSocialAccountRequestSchema>;

/** Where the browser must go to authorize. Always a facebook.com URL built by the server. */
export const connectSocialAccountResponseSchema = z.object({ authorizationUrl: z.url() });
export type ConnectSocialAccountResponse = z.infer<typeof connectSocialAccountResponseSchema>;

/**
 * Outcome of the OAuth callback, passed to the web app as `?meta=<result>&count=<n>` on the
 * Social Accounts page. A fixed vocabulary: nothing from Meta's response is echoed.
 */
export const META_CONNECT_RESULTS = [
  'connected',
  /** The person cancelled or declined on Facebook. */
  'denied',
  /** Unknown, expired, already used or foreign `state`. */
  'invalid_state',
  'session_expired',
  /** The person is no longer an owner of the workspace. */
  'not_allowed',
  /** Meta refused the code exchange or account lookup. */
  'exchange_failed',
  /** Authorized, but no Page (or no Instagram professional account linked to one) was found. */
  'no_accounts',
  'not_configured',
] as const;
export type MetaConnectResult = (typeof META_CONNECT_RESULTS)[number];
export const metaConnectResultSchema = z.enum(META_CONNECT_RESULTS);

export const SOCIAL_PLATFORM_LABELS: Record<SocialPlatform, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
};

export const SOCIAL_ACCOUNT_TYPE_LABELS: Record<SocialAccountType, string> = {
  facebook_page: 'Facebook Page',
  instagram_professional: 'Instagram professional account',
};
