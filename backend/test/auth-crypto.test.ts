import { createHash, randomBytes, scryptSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { readCookie } from '../src/utils/cookies';
import { DEFAULT_SCRYPT_PARAMS, hashPassword, verifyPassword } from '../src/utils/password';
import {
  generateSessionToken,
  hashSessionToken,
  isWellFormedSessionToken,
} from '../src/utils/session-token';

describe('password hashing (scrypt)', () => {
  const password = 'correct horse battery staple';

  it('defaults to the OWASP scrypt setting N=2^15 (32 MiB), r=8, p=3', () => {
    expect(DEFAULT_SCRYPT_PARAMS).toMatchObject({ N: 2 ** 15, r: 8, p: 3 });
  });

  it('produces a self-describing scrypt hash that does not contain the password', async () => {
    const hash = await hashPassword(password);
    expect(hash).toMatch(/^scrypt\$32768\$8\$3\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{86}$/);
    expect(hash).not.toContain(password);
  });

  it('still verifies hashes stored with the earlier p=1 setting, using their own parameters', async () => {
    // Built independently of hashPassword(), exactly as the earlier default stored it.
    const N = 2 ** 15;
    const salt = randomBytes(16);
    const key = scryptSync(password.normalize('NFKC'), salt, 64, {
      N,
      r: 8,
      p: 1,
      maxmem: 256 * N * 8,
    });
    const legacy = `scrypt$${N}$8$1$${salt.toString('base64url')}$${key.toString('base64url')}`;

    expect(await verifyPassword(password, legacy)).toBe(true);
    expect(await verifyPassword('correct horse battery stapler', legacy)).toBe(false);
  });

  it('rejects a hash whose recorded parameters were changed', async () => {
    const hash = await hashPassword(password);
    expect(
      await verifyPassword(password, hash.replace(/^scrypt\$32768\$8\$3\$/, 'scrypt$32768$8$1$')),
    ).toBe(false);
  });

  it('uses a fresh random salt for every hash', async () => {
    expect(await hashPassword(password)).not.toBe(await hashPassword(password));
  });

  it('verifies the right password and rejects a wrong one', async () => {
    const hash = await hashPassword(password);
    expect(await verifyPassword(password, hash)).toBe(true);
    expect(await verifyPassword('correct horse battery stapler', hash)).toBe(false);
    expect(await verifyPassword('', hash)).toBe(false);
  });

  it('treats equivalent Unicode forms of a password as the same password', async () => {
    const composed = 'café au lait 2026'; // é as one code point
    const decomposed = 'café au lait 2026'; // e + combining accent
    expect(await verifyPassword(decomposed, await hashPassword(composed))).toBe(true);
  });

  it.each([
    ['empty', ''],
    ['wrong algorithm', 'bcrypt$10$abc'],
    ['missing parts', 'scrypt$32768$8$1$c2FsdA'],
    ['non power-of-two N', 'scrypt$1000$8$1$c2FsdHNhbHRzYWx0c2FsdA$' + 'a'.repeat(86)],
    ['N above the safety cap', `scrypt$${2 ** 24}$8$1$c2FsdHNhbHRzYWx0c2FsdA$${'a'.repeat(86)}`],
    ['short salt', `scrypt$32768$8$1$c2FsdA$${'a'.repeat(86)}`],
  ])('returns false without throwing for a malformed hash (%s)', async (_label, stored) => {
    await expect(verifyPassword(password, stored)).resolves.toBe(false);
  });
});

describe('session tokens', () => {
  it('are 256-bit, URL-safe and unique', () => {
    const tokens = new Set(Array.from({ length: 200 }, generateSessionToken));
    expect(tokens.size).toBe(200);
    for (const token of tokens) expect(isWellFormedSessionToken(token)).toBe(true);
  });

  it('are stored as a SHA-256 hash, never as the raw value', () => {
    const token = generateSessionToken();
    const stored = hashSessionToken(token);
    expect(stored).toBe(createHash('sha256').update(token).digest('hex'));
    expect(stored).not.toContain(token);
    expect(stored).toMatch(/^[a-f0-9]{64}$/);
  });

  it.each(['', 'short', 'x'.repeat(43) + '!', `${'a'.repeat(42)}=`, 'a'.repeat(44)])(
    'rejects malformed token %j before any lookup',
    (token) => {
      expect(isWellFormedSessionToken(token)).toBe(false);
    },
  );
});

describe('readCookie', () => {
  it('reads one cookie among several', () => {
    expect(readCookie('a=1; metaflow_session=abc; b=2', 'metaflow_session')).toBe('abc');
  });

  it('returns undefined for missing headers, missing cookies and malformed encodings', () => {
    expect(readCookie(undefined, 'x')).toBeUndefined();
    expect(readCookie('a=1', 'x')).toBeUndefined();
    expect(readCookie('x=%E0%A4%A', 'x')).toBeUndefined();
  });

  it('does not match a cookie whose name merely contains the requested name', () => {
    expect(readCookie('evil_metaflow_session=1', 'metaflow_session')).toBeUndefined();
  });

  it('unwraps quoted values', () => {
    expect(readCookie('x="quoted"', 'x')).toBe('quoted');
  });
});
