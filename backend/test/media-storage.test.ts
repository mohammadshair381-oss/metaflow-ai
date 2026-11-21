import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { text } from 'node:stream/consumers';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLocalMediaStorage } from '../src/storage/local-media-storage';
import {
  createStorageKey,
  InvalidStorageKeyError,
  STORAGE_KEY_PATTERN,
  type MediaStorage,
} from '../src/storage/media-storage';

const WORKSPACE = '0123456789abcdef01234567';

describe('local media storage', () => {
  let root: string;
  let scratch: string;
  let storage: MediaStorage;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'metaflow-storage-'));
    scratch = await mkdtemp(join(tmpdir(), 'metaflow-scratch-'));
    storage = createLocalMediaStorage(root);
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true, maxRetries: 3 });
    await rm(scratch, { recursive: true, force: true, maxRetries: 3 });
  });

  const source = async (content: string) => {
    const path = join(scratch, `upload-${Math.random()}`);
    await writeFile(path, content);
    return path;
  };

  it('generates opaque keys scoped by workspace', () => {
    const key = createStorageKey(WORKSPACE, 'png');
    expect(key).toMatch(STORAGE_KEY_PATTERN);
    expect(key.startsWith(`${WORKSPACE}/`)).toBe(true);
    expect(createStorageKey(WORKSPACE, 'png')).not.toBe(key);
  });

  it('stores, reads (whole and by range), sizes and deletes a file', async () => {
    const key = createStorageKey(WORKSPACE, 'png');
    await storage.put(key, await source('0123456789'), { contentType: 'image/png' });

    expect(await readFile(join(root, ...key.split('/')), 'utf8')).toBe('0123456789');
    expect(await storage.size(key)).toBe(10);
    const whole = await storage.open(key);
    expect(whole && (await text(whole))).toBe('0123456789');
    const part = await storage.open(key, { start: 2, end: 5 });
    expect(part && (await text(part))).toBe('2345');

    await storage.delete(key);
    expect(await storage.size(key)).toBeNull();
    expect(await storage.open(key)).toBeNull();
    // Deleting again is not an error.
    await expect(storage.delete(key)).resolves.toBeUndefined();
  });

  it('never overwrites an existing file', async () => {
    const key = createStorageKey(WORKSPACE, 'png');
    await storage.put(key, await source('first'), { contentType: 'image/png' });
    await expect(
      storage.put(key, await source('second'), { contentType: 'image/png' }),
    ).rejects.toThrow();
    expect(await readFile(join(root, ...key.split('/')), 'utf8')).toBe('first');
  });

  it.each([
    '../outside.png',
    `${WORKSPACE}/../../outside.png`,
    `${WORKSPACE}/${'a'.repeat(32)}.html`,
    `${WORKSPACE}/${'a'.repeat(32)}.svg`,
    `/etc/${'a'.repeat(32)}.png`,
    `C:\\Windows\\${'a'.repeat(32)}.png`,
    `${WORKSPACE}\\${'a'.repeat(32)}.png`,
    `${WORKSPACE}/${'A'.repeat(32)}.png`,
    '',
  ])('refuses the key %j for every operation', async (key) => {
    await expect(storage.put(key, await source('x'), { contentType: 'image/png' })).rejects.toThrow(
      InvalidStorageKeyError,
    );
    await expect(storage.open(key)).rejects.toThrow(InvalidStorageKeyError);
    await expect(storage.size(key)).rejects.toThrow(InvalidStorageKeyError);
    await expect(storage.delete(key)).rejects.toThrow(InvalidStorageKeyError);
  });

  it('requires an absolute root directory', () => {
    expect(() => createLocalMediaStorage('relative/media')).toThrow();
  });
});
