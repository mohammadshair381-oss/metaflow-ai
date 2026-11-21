import { constants, createReadStream } from 'node:fs';
import { chmod, copyFile, mkdir, rm, stat, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { assertStorageKey, InvalidStorageKeyError, type MediaStorage } from './media-storage';

/** Owner read/write only: stored media is data, never executable. */
const FILE_MODE = 0o600;

/**
 * Keeps media files in a directory on the server's disk, outside anything Express serves
 * statically. Files are only ever read back through the media API, which checks workspace
 * access and sets safe response headers.
 *
 * Every key is checked against the key pattern and the resolved path must stay inside the
 * root directory, so a key can never reach another file.
 */
export function createLocalMediaStorage(rootDir: string): MediaStorage {
  if (!isAbsolute(rootDir)) throw new Error('The media directory must be an absolute path');
  const root = resolve(rootDir);

  const pathOf = (key: string) => {
    assertStorageKey(key);
    const path = resolve(root, ...key.split('/'));
    const inside = relative(root, path);
    if (
      inside === '' ||
      inside.startsWith('..') ||
      isAbsolute(inside) ||
      !path.startsWith(root + sep)
    ) {
      throw new InvalidStorageKeyError();
    }
    return path;
  };

  const isMissing = (error: unknown) => (error as { code?: string } | null)?.code === 'ENOENT';

  return {
    driver: 'local',

    async put(key, sourcePath) {
      const target = pathOf(key);
      await mkdir(dirname(target), { recursive: true });
      try {
        // Keys are random, so the target never exists; COPYFILE_EXCL keeps it that way.
        await copyFile(sourcePath, target, constants.COPYFILE_EXCL);
        await chmod(target, FILE_MODE);
      } catch (error) {
        // EEXIST: another file owns the key and must stay. Otherwise remove any partial copy.
        if ((error as { code?: string }).code !== 'EEXIST') await rm(target, { force: true });
        throw error;
      }
      // The temporary upload is removed by the caller in every case.
    },

    async open(key, range) {
      const path = pathOf(key);
      try {
        await stat(path);
      } catch (error) {
        if (isMissing(error)) return null;
        throw error;
      }
      return createReadStream(path, range ? { start: range.start, end: range.end } : undefined);
    },

    async size(key) {
      try {
        const info = await stat(pathOf(key));
        return info.isFile() ? info.size : null;
      } catch (error) {
        if (isMissing(error)) return null;
        throw error;
      }
    },

    async delete(key) {
      try {
        await unlink(pathOf(key));
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
    },
  };
}
