export const APP_NAME = 'MetaFlow AI';

/** Service identifier reported by the backend health endpoint. */
export const BACKEND_SERVICE_NAME = 'metaflow-backend';

/** Every backend route lives under this prefix. */
export const API_PREFIX = '/api';

/** Paths of implemented backend endpoints, relative to the API base URL. */
export const API_ROUTES = {
  health: `${API_PREFIX}/health`,
  healthReady: `${API_PREFIX}/health/ready`,
  authRegister: `${API_PREFIX}/auth/register`,
  authLogin: `${API_PREFIX}/auth/login`,
  authLogout: `${API_PREFIX}/auth/logout`,
  authLogoutAll: `${API_PREFIX}/auth/logout-all`,
  authMe: `${API_PREFIX}/auth/me`,
  workspaces: `${API_PREFIX}/workspaces`,
} as const;

/** Paths below one workspace. The server checks membership on every one of them. */
export const workspaceRoutes = (workspaceId: string) => {
  const base = `${API_ROUTES.workspaces}/${encodeURIComponent(workspaceId)}`;
  const social = `${base}/social-accounts`;
  return {
    detail: base,
    archive: `${base}/archive`,
    members: `${base}/members`,
    socialAccounts: social,
    socialConnect: `${social}/connect`,
    socialAccount: (accountId: string) => `${social}/${encodeURIComponent(accountId)}`,
    socialAccountRefresh: (accountId: string) =>
      `${social}/${encodeURIComponent(accountId)}/refresh`,
  } as const;
};

/** Where Meta sends the browser back after authorization. Registered in the Meta app. */
export const META_OAUTH_CALLBACK_PATH = `${API_PREFIX}/social/meta/callback`;

/** Header used to correlate a request across frontend, backend and logs. */
export const REQUEST_ID_HEADER = 'X-Request-Id';

export const APP_ENVIRONMENTS = ['development', 'test', 'production'] as const;
export type AppEnvironment = (typeof APP_ENVIRONMENTS)[number];
