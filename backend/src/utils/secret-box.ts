import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Authenticated encryption (AES-256-GCM) for secrets stored in the database, such as social
 * access tokens. Not related to password hashing or session tokens.
 *
 * Stored format: `v1.<keyId>.<iv>.<tag>.<ciphertext>` (base64url parts).
 * - `keyId` names the key that encrypted the value, so keys can be rotated: new values use the
 *   first key, old values keep decrypting with any key still in the list.
 * - `context` is authenticated but not stored (GCM additional data). A value only decrypts
 *   with the context it was encrypted for, so a ciphertext copied onto another record fails.
 */
export interface SecretBox {
  encrypt(plaintext: string, context: string): string;
  /** Throws SecretBoxError for anything that is not an intact value for this context. */
  decrypt(stored: string, context: string): string;
}

export class SecretBoxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecretBoxError';
  }
}

export const SECRET_KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const VERSION = 'v1';

/** A short public fingerprint of a key. Safe to store next to ciphertext. */
export const secretKeyId = (key: Buffer) =>
  createHash('sha256').update(key).digest('hex').slice(0, 8);

/** `keys[0]` encrypts; every key decrypts. Throws if a key is not exactly 32 bytes. */
export function createSecretBox(keys: Buffer[]): SecretBox {
  if (keys.length === 0) throw new SecretBoxError('At least one encryption key is required');
  for (const key of keys) {
    if (key.length !== SECRET_KEY_BYTES) {
      throw new SecretBoxError(`Encryption keys must be ${SECRET_KEY_BYTES} bytes`);
    }
  }
  const byId = new Map(keys.map((key) => [secretKeyId(key), key]));
  const current = keys[0] as Buffer;
  const currentId = secretKeyId(current);

  return {
    encrypt(plaintext, context) {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv('aes-256-gcm', current, iv);
      cipher.setAAD(Buffer.from(context, 'utf8'));
      const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      return [
        VERSION,
        currentId,
        iv.toString('base64url'),
        cipher.getAuthTag().toString('base64url'),
        ciphertext.toString('base64url'),
      ].join('.');
    },

    decrypt(stored, context) {
      const parts = stored.split('.');
      if (parts.length !== 5 || parts[0] !== VERSION) {
        throw new SecretBoxError('Unrecognized encrypted value');
      }
      const key = byId.get(parts[1] ?? '');
      if (!key) throw new SecretBoxError('No key available for this encrypted value');
      const iv = Buffer.from(parts[2] ?? '', 'base64url');
      const tag = Buffer.from(parts[3] ?? '', 'base64url');
      if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
        throw new SecretBoxError('Malformed encrypted value');
      }
      try {
        const decipher = createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAAD(Buffer.from(context, 'utf8'));
        decipher.setAuthTag(tag);
        return Buffer.concat([
          decipher.update(Buffer.from(parts[4] ?? '', 'base64url')),
          decipher.final(),
        ]).toString('utf8');
      } catch {
        // Wrong context, wrong key or tampering. Never include the value or the cause.
        throw new SecretBoxError('Encrypted value failed authentication');
      }
    },
  };
}
