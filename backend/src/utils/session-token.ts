import { createHash, randomBytes } from 'node:crypto';

const TOKEN_BYTES = 32;
/** 32 random bytes in base64url are always exactly 43 characters. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** An opaque, unguessable session token (256 bits). Only ever sent to the browser in a cookie. */
export function generateSessionToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

/**
 * The value stored in the database. A leaked sessions collection therefore cannot be used to
 * sign in: the raw token is never persisted. SHA-256 is sufficient because the input is random.
 */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function isWellFormedSessionToken(token: string): boolean {
  return TOKEN_PATTERN.test(token);
}
