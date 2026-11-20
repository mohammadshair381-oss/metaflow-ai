import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

export interface ScryptParams {
  /** CPU/memory cost, a power of two. Memory used is 128 * N * r bytes. */
  N: number;
  r: number;
  p: number;
  keyLength: number;
  saltLength: number;
}

/** 2^15 * 8 * 128 = 32 MiB per hash: well above OWASP's scrypt minimum, light enough for a small server. */
export const DEFAULT_SCRYPT_PARAMS: ScryptParams = {
  N: 2 ** 15,
  r: 8,
  p: 1,
  keyLength: 64,
  saltLength: 16,
};

// Bounds for parameters read back from stored hashes, so a corrupted value cannot exhaust memory.
const MAX_N = 2 ** 20;
const MAX_R = 32;
const MAX_P = 16;

function deriveKey(password: string, salt: Buffer, keyLength: number, options: ScryptOptions) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, keyLength, options, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

/** Unicode passwords typed on different devices must hash identically (NIST SP 800-63B). */
const normalize = (password: string) => password.normalize('NFKC');

const optionsFor = ({ N, r, p }: Pick<ScryptParams, 'N' | 'r' | 'p'>): ScryptOptions => ({
  N,
  r,
  p,
  maxmem: 256 * N * r,
});

/** Returns `scrypt$N$r$p$<salt>$<key>` (base64url). The format carries its own parameters. */
export async function hashPassword(
  password: string,
  params: ScryptParams = DEFAULT_SCRYPT_PARAMS,
): Promise<string> {
  const salt = randomBytes(params.saltLength);
  const key = await deriveKey(normalize(password), salt, params.keyLength, optionsFor(params));
  return [
    'scrypt',
    params.N,
    params.r,
    params.p,
    salt.toString('base64url'),
    key.toString('base64url'),
  ].join('$');
}

/** Constant-time comparison. Returns false (never throws) for malformed stored hashes. */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const parts = storedHash.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [N, r, p] = parts.slice(1, 4).map(Number) as [number, number, number];
  const validParams =
    Number.isInteger(N) &&
    N > 1 &&
    N <= MAX_N &&
    (N & (N - 1)) === 0 &&
    Number.isInteger(r) &&
    r >= 1 &&
    r <= MAX_R &&
    Number.isInteger(p) &&
    p >= 1 &&
    p <= MAX_P;
  if (!validParams) return false;

  const salt = Buffer.from(parts[4] ?? '', 'base64url');
  const expected = Buffer.from(parts[5] ?? '', 'base64url');
  if (salt.length < 16 || expected.length < 32) return false;

  const actual = await deriveKey(
    normalize(password),
    salt,
    expected.length,
    optionsFor({ N, r, p }),
  );
  return timingSafeEqual(actual, expected);
}
