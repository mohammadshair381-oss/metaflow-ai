import { REQUEST_ID_HEADER } from '@metaflow/shared';
import type { CorsOptions } from 'cors';

/**
 * Credentialed CORS restricted to an explicit allowlist of origins.
 *
 * Requests from other origins are not rejected with an error. They simply receive no
 * Access-Control-Allow-Origin header, so the browser refuses to expose the response.
 * Requests without an Origin header (curl, health checks, server-to-server) are unaffected.
 */
export function createCorsOptions(allowedOrigins: readonly string[]): CorsOptions {
  const allowed = new Set(allowedOrigins);
  return {
    origin: (origin, callback) => {
      callback(null, origin !== undefined && allowed.has(origin));
    },
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', REQUEST_ID_HEADER],
    exposedHeaders: [REQUEST_ID_HEADER],
    maxAge: 600,
  };
}
