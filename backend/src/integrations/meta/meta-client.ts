/**
 * The only place that talks to Meta. Endpoints and fields follow Meta's documentation for
 * Graph API v27.0:
 * - Facebook Login "Manually Build a Login Flow" (dialog/oauth, oauth/access_token, me/permissions)
 * - "Long-Lived Access Tokens" (fb_exchange_token; Page tokens from a long-lived user token
 *   have no expiry date)
 * - Instagram API with Facebook Login "Get Started" (me/accounts, instagram_business_account)
 * - "Handling Errors" (error.code 190/102 = token, 10 and 200-299 = permission)
 *
 * Tokens for data requests travel in the Authorization header. The two oauth/access_token
 * exchanges are documented as GET with query parameters and are sent that way, over TLS,
 * server to server; URLs are never logged and never appear in errors.
 */

export interface MetaClientConfig {
  appId: string;
  appSecret: string;
  redirectUri: string;
  /** e.g. "v27.0" */
  graphApiVersion: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface MetaToken {
  accessToken: string;
  /** Seconds until expiry, or null when Meta does not report one. */
  expiresIn: number | null;
}

export interface MetaInstagramAccount {
  id: string;
  username: string | null;
  name: string | null;
  pictureUrl: string | null;
}

export interface MetaPage {
  id: string;
  name: string;
  pictureUrl: string | null;
  /** The Page access token. Secret. */
  accessToken: string;
  /** What the person may do on the Page, e.g. CREATE_CONTENT. */
  tasks: string[];
  /** The Instagram professional account linked to the Page, if any. */
  instagram: MetaInstagramAccount | null;
}

export interface MetaClient {
  authorizationUrl(input: { state: string; scopes: readonly string[] }): string;
  exchangeCode(code: string): Promise<MetaToken>;
  exchangeForLongLivedToken(userToken: string): Promise<MetaToken>;
  grantedPermissions(userToken: string): Promise<string[]>;
  listPages(userToken: string): Promise<MetaPage[]>;
  getPage(pageId: string, pageToken: string): Promise<{ name: string; pictureUrl: string | null }>;
  getInstagramAccount(instagramId: string, pageToken: string): Promise<MetaInstagramAccount>;
}

export type MetaErrorKind =
  'token' | 'permission' | 'rate_limit' | 'transient' | 'request' | 'invalid_response';

/** A failed Meta call. The message is ours, never Meta's text, and never contains a token. */
export class MetaApiError extends Error {
  constructor(
    readonly kind: MetaErrorKind,
    readonly code: number | null = null,
    readonly subcode: number | null = null,
  ) {
    super(`Meta API error (${kind}${code === null ? '' : `, code ${code}`})`);
    this.name = 'MetaApiError';
  }
}

export function classifyMetaError(code: number | null, httpStatus: number): MetaErrorKind {
  if (code === 190 || code === 102) return 'token';
  if (code === 10 || (code !== null && code >= 200 && code <= 299)) return 'permission';
  if (code === 4 || code === 17 || code === 341 || code === 368) return 'rate_limit';
  if (code === 1 || code === 2 || httpStatus >= 500) return 'transient';
  return 'request';
}

const PAGE_FIELDS =
  'id,name,tasks,access_token,picture{url},instagram_business_account{id,username,name,profile_picture_url}';
const MAX_PAGE_REQUESTS = 5;

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null;
const text = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;
const required = (value: unknown): string => {
  const result = text(value);
  if (result === null) throw new MetaApiError('invalid_response');
  return result;
};

function pictureUrl(value: unknown): string | null {
  return isObject(value) && isObject(value.data) ? text(value.data.url) : null;
}

function toInstagram(value: unknown): MetaInstagramAccount | null {
  if (!isObject(value) || text(value.id) === null) return null;
  return {
    id: required(value.id),
    username: text(value.username),
    name: text(value.name),
    pictureUrl: text(value.profile_picture_url),
  };
}

export function createMetaClient(config: MetaClientConfig): MetaClient {
  const { appId, appSecret, redirectUri, graphApiVersion } = config;
  const fetchImpl = config.fetchImpl ?? fetch;
  const timeoutMs = config.timeoutMs ?? 10_000;
  const graph = `https://graph.facebook.com/${graphApiVersion}`;

  async function call(
    path: string,
    params: Record<string, string>,
    bearerToken?: string,
  ): Promise<Json> {
    const url = `${graph}/${path}?${new URLSearchParams(params).toString()}`;
    let response: Response;
    let body: unknown;
    try {
      response = await fetchImpl(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          ...(bearerToken ? { Authorization: `Bearer ${bearerToken}` } : {}),
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
      body = await response.json().catch(() => undefined);
    } catch {
      // Network failure or timeout. The cause is dropped: it can contain the request URL.
      throw new MetaApiError('transient');
    }
    if (isObject(body) && isObject(body.error)) {
      const code = typeof body.error.code === 'number' ? body.error.code : null;
      const subcode =
        typeof body.error.error_subcode === 'number' ? body.error.error_subcode : null;
      throw new MetaApiError(classifyMetaError(code, response.status), code, subcode);
    }
    if (!response.ok) throw new MetaApiError(classifyMetaError(null, response.status));
    if (!isObject(body)) throw new MetaApiError('invalid_response');
    return body;
  }

  const toToken = (body: Json): MetaToken => ({
    accessToken: required(body.access_token),
    expiresIn: typeof body.expires_in === 'number' ? body.expires_in : null,
  });

  return {
    authorizationUrl({ state, scopes }) {
      const params = new URLSearchParams({
        client_id: appId,
        redirect_uri: redirectUri,
        state,
        response_type: 'code',
        scope: scopes.join(','),
      });
      return `https://www.facebook.com/${graphApiVersion}/dialog/oauth?${params.toString()}`;
    },

    async exchangeCode(code) {
      return toToken(
        await call('oauth/access_token', {
          client_id: appId,
          redirect_uri: redirectUri,
          client_secret: appSecret,
          code,
        }),
      );
    },

    async exchangeForLongLivedToken(userToken) {
      return toToken(
        await call('oauth/access_token', {
          grant_type: 'fb_exchange_token',
          client_id: appId,
          client_secret: appSecret,
          fb_exchange_token: userToken,
        }),
      );
    },

    async grantedPermissions(userToken) {
      const body = await call('me/permissions', {}, userToken);
      if (!Array.isArray(body.data)) throw new MetaApiError('invalid_response');
      return body.data.flatMap((entry: unknown) =>
        isObject(entry) && entry.status === 'granted' && typeof entry.permission === 'string'
          ? [entry.permission]
          : [],
      );
    },

    async listPages(userToken) {
      const pages: MetaPage[] = [];
      let after: string | null = null;
      for (let request = 0; request < MAX_PAGE_REQUESTS; request += 1) {
        const body: Json = await call(
          'me/accounts',
          { fields: PAGE_FIELDS, limit: '100', ...(after ? { after } : {}) },
          userToken,
        );
        if (!Array.isArray(body.data)) throw new MetaApiError('invalid_response');
        for (const entry of body.data as unknown[]) {
          if (!isObject(entry)) throw new MetaApiError('invalid_response');
          pages.push({
            id: required(entry.id),
            name: required(entry.name),
            pictureUrl: pictureUrl(entry.picture),
            accessToken: required(entry.access_token),
            tasks: Array.isArray(entry.tasks)
              ? entry.tasks.filter((task): task is string => typeof task === 'string')
              : [],
            instagram: toInstagram(entry.instagram_business_account),
          });
        }
        const paging = isObject(body.paging) ? body.paging : {};
        const cursors = isObject(paging.cursors) ? paging.cursors : {};
        after = text(paging.next) === null ? null : text(cursors.after);
        if (after === null) break;
      }
      return pages;
    },

    async getPage(pageId, pageToken) {
      const body = await call(
        encodeURIComponent(pageId),
        { fields: 'name,picture{url}' },
        pageToken,
      );
      return { name: required(body.name), pictureUrl: pictureUrl(body.picture) };
    },

    async getInstagramAccount(instagramId, pageToken) {
      const body = await call(
        encodeURIComponent(instagramId),
        { fields: 'id,username,name,profile_picture_url' },
        pageToken,
      );
      const account = toInstagram(body);
      if (!account) throw new MetaApiError('invalid_response');
      return account;
    },
  };
}
