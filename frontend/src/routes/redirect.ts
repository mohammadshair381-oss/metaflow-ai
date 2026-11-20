/** Router state carried to /login: where the user was going. */
export interface RedirectState {
  from?: string;
}

const FALLBACK = '/dashboard';
// Any fixed origin works: it only shows whether a target would leave the current origin.
const PROBE_ORIGIN = 'https://metaflow.invalid';

/**
 * Only follow in-app paths, never an absolute or protocol-relative URL (open-redirect guard).
 * Browsers read "\" as "/" and drop tabs and newlines in URLs, so "/\evil.example" or
 * "/<tab>/evil.example" would mean "//evil.example". Targets must start with a single "/" and
 * must not resolve to another origin when parsed the way a browser parses them.
 */
export function safeRedirectTarget(from: string | undefined): string {
  if (!from?.startsWith('/') || from.startsWith('//') || from.startsWith('/\\')) return FALLBACK;
  try {
    return new URL(from, PROBE_ORIGIN).origin === PROBE_ORIGIN ? from : FALLBACK;
  } catch {
    return FALLBACK;
  }
}
