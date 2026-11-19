export const APP_NAME = 'MetaFlow AI';

/** Service identifier reported by the backend health endpoint. */
export const BACKEND_SERVICE_NAME = 'metaflow-backend';

/** Every backend route lives under this prefix. */
export const API_PREFIX = '/api';

/** Paths of implemented backend endpoints, relative to the API base URL. */
export const API_ROUTES = {
  health: `${API_PREFIX}/health`,
  healthReady: `${API_PREFIX}/health/ready`,
} as const;

/** Header used to correlate a request across frontend, backend and logs. */
export const REQUEST_ID_HEADER = 'X-Request-Id';

export const APP_ENVIRONMENTS = ['development', 'test', 'production'] as const;
export type AppEnvironment = (typeof APP_ENVIRONMENTS)[number];
