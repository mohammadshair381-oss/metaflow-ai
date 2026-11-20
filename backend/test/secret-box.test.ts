import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SecretBoxError, createSecretBox, secretKeyId } from '../src/utils/secret-box';

const TOKEN = 'EAAG-page-access-token-value-1234567890';
const CONTEXT = 'social-token:ws1:facebook:1001';

describe('secret box (AES-256-GCM for stored tokens)', () => {
  const key = randomBytes(32);
  const box = createSecretBox([key]);

  it('round-trips a token and never stores it readable', () => {
    const stored = box.encrypt(TOKEN, CONTEXT);
    expect(stored).toMatch(/^v1\.[a-f0-9]{8}\.[\w-]{16}\.[\w-]{22}\.[\w-]+$/);
    expect(stored).not.toContain(TOKEN);
    expect(Buffer.from(stored.split('.')[4] ?? '', 'base64url').toString('utf8')).not.toContain(
      TOKEN,
    );
    expect(box.decrypt(stored, CONTEXT)).toBe(TOKEN);
  });

  it('uses a fresh nonce every time', () => {
    expect(box.encrypt(TOKEN, CONTEXT)).not.toBe(box.encrypt(TOKEN, CONTEXT));
  });

  it('refuses a value moved to another record (different context)', () => {
    const stored = box.encrypt(TOKEN, CONTEXT);
    expect(() => box.decrypt(stored, 'social-token:ws2:facebook:1001')).toThrow(SecretBoxError);
  });

  it.each([
    ['ciphertext', 4],
    ['auth tag', 3],
    ['nonce', 2],
  ])('rejects a tampered %s', (_label, index) => {
    const parts = box.encrypt(TOKEN, CONTEXT).split('.');
    const bytes = Buffer.from(parts[index] ?? '', 'base64url');
    bytes[0] = (bytes[0] ?? 0) ^ 0x01;
    parts[index] = bytes.toString('base64url');
    expect(() => box.decrypt(parts.join('.'), CONTEXT)).toThrow(SecretBoxError);
  });

  it.each(['', 'plaintext-token', 'v1.a.b.c', 'v2.00000000.a.b.c', 'v1.deadbeef.AAAA.BBBB.CCCC'])(
    'rejects the malformed value %j',
    (value) => {
      expect(() => box.decrypt(value, CONTEXT)).toThrow(SecretBoxError);
    },
  );

  it('cannot decrypt with a different key and does not leak the token in the error', () => {
    const stored = box.encrypt(TOKEN, CONTEXT);
    const other = createSecretBox([randomBytes(32)]);
    let message = '';
    try {
      other.decrypt(stored, CONTEXT);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toBe('No key available for this encrypted value');
    expect(message).not.toContain(TOKEN);
  });

  it('supports key rotation: new values use the first key, old values still decrypt', () => {
    const oldStored = box.encrypt(TOKEN, CONTEXT);
    const newKey = randomBytes(32);
    const rotated = createSecretBox([newKey, key]);

    expect(rotated.decrypt(oldStored, CONTEXT)).toBe(TOKEN);
    const newStored = rotated.encrypt(TOKEN, CONTEXT);
    expect(newStored.split('.')[1]).toBe(secretKeyId(newKey));
    expect(oldStored.split('.')[1]).toBe(secretKeyId(key));
    expect(() => box.decrypt(newStored, CONTEXT)).toThrow(SecretBoxError);
  });

  it('refuses to start without a proper 32-byte key', () => {
    expect(() => createSecretBox([])).toThrow(SecretBoxError);
    expect(() => createSecretBox([randomBytes(16)])).toThrow(SecretBoxError);
  });
});
