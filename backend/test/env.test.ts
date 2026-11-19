import { describe, expect, it } from 'vitest';
import { EnvValidationError, parseEnv } from '../src/config/env';

function expectEnvError(source: NodeJS.ProcessEnv): EnvValidationError {
  try {
    parseEnv(source);
  } catch (error) {
    expect(error).toBeInstanceOf(EnvValidationError);
    return error as EnvValidationError;
  }
  throw new Error('Expected parseEnv to throw');
}

const validProduction = {
  NODE_ENV: 'production',
  MONGODB_URI: 'mongodb+srv://app:s3cret@cluster0.example.mongodb.net/metaflow',
  CORS_ORIGINS: 'https://app.metaflow.example',
};

describe('parseEnv', () => {
  it('applies development defaults when nothing is set', () => {
    const env = parseEnv({});
    expect(env).toMatchObject({
      NODE_ENV: 'development',
      PORT: 4000,
      LOG_LEVEL: 'info',
      MONGODB_URI: undefined,
      CORS_ORIGINS: ['http://localhost:3000'],
      TRUST_PROXY: 0,
      GIT_COMMIT: null,
    });
  });

  it('treats blank values as not configured', () => {
    expect(parseEnv({ MONGODB_URI: '   ', CORS_ORIGINS: '' }).MONGODB_URI).toBeUndefined();
  });

  it('accepts a complete production configuration', () => {
    const env = parseEnv({
      ...validProduction,
      PORT: '10000',
      TRUST_PROXY: '1',
      RENDER_GIT_COMMIT: 'abcdef1234567890',
    });
    expect(env).toMatchObject({
      NODE_ENV: 'production',
      PORT: 10000,
      TRUST_PROXY: 1,
      CORS_ORIGINS: ['https://app.metaflow.example'],
      GIT_COMMIT: 'abcdef1',
    });
  });

  it('requires MONGODB_URI and CORS_ORIGINS in production', () => {
    const error = expectEnvError({ NODE_ENV: 'production' });
    expect(error.issues).toEqual([
      'MONGODB_URI: is required in production',
      'CORS_ORIGINS: is required in production (comma-separated frontend origins)',
    ]);
  });

  it('rejects plain-http origins in production', () => {
    const error = expectEnvError({ ...validProduction, CORS_ORIGINS: 'http://app.example.com' });
    expect(error.issues).toEqual(['CORS_ORIGINS[0]: must use https in production']);
  });

  it.each([
    ['*', 'wildcard is not allowed'],
    ['https://app.example.com/', 'must be an origin only'],
    ['https://app.example.com/dashboard', 'must be an origin only'],
    ['ftp://app.example.com', 'must use http or https'],
    ['not a url', 'is not a valid URL'],
  ])('rejects CORS origin %j', (origin, expected) => {
    const error = expectEnvError({ CORS_ORIGINS: origin });
    expect(error.issues[0]).toContain(expected);
  });

  it('parses and de-duplicates a comma-separated origin list', () => {
    const env = parseEnv({
      CORS_ORIGINS: ' http://localhost:3000 , https://app.example.com,http://localhost:3000',
    });
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:3000', 'https://app.example.com']);
  });

  it.each([['0'], ['70000'], ['abc']])('rejects invalid PORT %j', (port) => {
    expect(expectEnvError({ PORT: port }).issues[0]).toMatch(/^PORT:/);
  });

  it('rejects a MONGODB_URI with the wrong scheme without echoing the value', () => {
    const error = expectEnvError({ MONGODB_URI: 'https://admin:hunter2@db.example.com' });
    expect(error.issues[0]).toMatch(/^MONGODB_URI:/);
    expect(error.message).not.toContain('hunter2');
    expect(error.message).not.toContain('db.example.com');
  });

  it('never includes secret values in production error messages', () => {
    const error = expectEnvError({ ...validProduction, CORS_ORIGINS: '*' });
    expect(error.message).not.toContain('s3cret');
  });
});
