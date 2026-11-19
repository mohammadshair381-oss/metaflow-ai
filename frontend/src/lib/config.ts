/**
 * Public runtime configuration for the browser.
 *
 * Only NEXT_PUBLIC_* values may appear here; they are embedded in the client bundle and
 * visible to anyone. Never put database URLs, Meta app secrets or AI provider keys here.
 */

const DEVELOPMENT_API_BASE_URL = 'http://localhost:4000';

// Must be referenced literally so Next.js can inline it at build time.
const configuredApiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();

/** Backend origin, without a trailing slash. Validated at build time in next.config.ts. */
export const API_BASE_URL = (configuredApiBaseUrl || DEVELOPMENT_API_BASE_URL).replace(/\/+$/, '');

/** True when no URL was configured and the local development default is in use. */
export const IS_DEFAULT_API_BASE_URL = !configuredApiBaseUrl;
