import { isAbsolute, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEVELOPMENT_MEDIA_DIR, EnvValidationError, parseEnv } from '../src/config/env';

const production = {
  NODE_ENV: 'production',
  MONGODB_URI: 'mongodb+srv://app:s3cret@cluster0.example.mongodb.net/metaflow',
  CORS_ORIGINS: 'https://app.metaflow.example',
};
const absoluteDir = resolve('/srv/metaflow/media');

function issuesOf(source: NodeJS.ProcessEnv): string[] {
  try {
    parseEnv(source);
  } catch (error) {
    expect(error).toBeInstanceOf(EnvValidationError);
    return (error as EnvValidationError).issues;
  }
  throw new Error('Expected parseEnv to throw');
}

describe('media configuration', () => {
  it('stores files in a git-ignored folder by default in development', () => {
    const { MEDIA } = parseEnv({});
    expect(MEDIA).toEqual({
      storage: { driver: 'local', localDir: resolve(DEVELOPMENT_MEDIA_DIR) },
      maxImageBytes: 10 * 1024 * 1024,
      maxVideoBytes: 100 * 1024 * 1024,
    });
    expect(isAbsolute(MEDIA.storage?.localDir ?? '')).toBe(true);
  });

  it('leaves storage off in test and production until a directory is set', () => {
    expect(parseEnv({ NODE_ENV: 'test' }).MEDIA.storage).toBeNull();
    expect(parseEnv(production).MEDIA.storage).toBeNull();
    expect(parseEnv({ ...production, MEDIA_LOCAL_DIR: absoluteDir }).MEDIA.storage).toEqual({
      driver: 'local',
      localDir: absoluteDir,
    });
  });

  it('applies configured size limits', () => {
    const { MEDIA } = parseEnv({ MEDIA_MAX_IMAGE_MB: '5', MEDIA_MAX_VIDEO_MB: '250' });
    expect(MEDIA.maxImageBytes).toBe(5 * 1024 * 1024);
    expect(MEDIA.maxVideoBytes).toBe(250 * 1024 * 1024);
  });

  it.each([
    [{ ...production, MEDIA_STORAGE_DRIVER: 'local' }, 'MEDIA_LOCAL_DIR: is required'],
    [{ ...production, MEDIA_LOCAL_DIR: 'relative/media' }, 'MEDIA_LOCAL_DIR: must be an absolute'],
    [{ MEDIA_STORAGE_DRIVER: 's3' }, 'MEDIA_STORAGE_DRIVER'],
    [{ MEDIA_MAX_IMAGE_MB: '0' }, 'MEDIA_MAX_IMAGE_MB'],
    [{ MEDIA_MAX_VIDEO_MB: 'lots' }, 'MEDIA_MAX_VIDEO_MB'],
  ])('refuses invalid settings (%#)', (source, expected) => {
    const issues = issuesOf(source);
    expect(issues.join('\n')).toContain(expected);
    // Messages name the variable, never its value.
    expect(issues.join('\n')).not.toContain('relative/media');
  });
});
