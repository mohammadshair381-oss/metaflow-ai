/**
 * Public runtime configuration.
 *
 * Everything here is embedded in the browser bundle. Vite only exposes VITE_* variables,
 * and those are public: never put database URLs, Meta app secrets or AI provider keys in them.
 */

/** Trim whitespace and trailing slashes. An empty result means "same origin". */
export function normalizeApiBaseUrl(value: string | undefined): string {
  return (value ?? '').trim().replace(/\/+$/, '');
}

/**
 * Backend origin without a trailing slash, e.g. https://metaflow-api.onrender.com.
 * Empty when VITE_API_BASE_URL is unset: requests then go to /api on the current origin,
 * which the Vite dev and preview servers proxy to the local backend.
 * Production builds on Vercel must set it (enforced in vite.config.ts).
 */
export const API_BASE_URL = normalizeApiBaseUrl(import.meta.env.VITE_API_BASE_URL);

export const USES_SAME_ORIGIN_API = API_BASE_URL === '';
