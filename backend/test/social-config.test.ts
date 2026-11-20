import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { EnvValidationError, parseEnv } from '../src/config/env';
import { OAuthStateModel, SocialAccountModel } from '../src/models/social-account.model';

const KEY = randomBytes(32).toString('base64');
const SOCIAL = {
  META_APP_ID: '1234567890',
  META_APP_SECRET: 'app-secret-value',
  META_REDIRECT_URI: 'http://localhost:3000/api/social/meta/callback',
  SOCIAL_TOKEN_ENCRYPTION_KEYS: KEY,
};

function issuesOf(source: NodeJS.ProcessEnv): string[] {
  try {
    parseEnv(source);
  } catch (error) {
    expect(error).toBeInstanceOf(EnvValidationError);
    return (error as EnvValidationError).issues;
  }
  throw new Error('Expected parseEnv to throw');
}

describe('social connection configuration', () => {
  it('is off, and the app still starts, when nothing is set', () => {
    expect(parseEnv({}).SOCIAL).toBeNull();
    expect(parseEnv({ META_APP_ID: '  ', META_GRAPH_API_VERSION: 'v27.0' }).SOCIAL).toBeNull();
  });

  it('accepts a complete configuration and defaults the Graph API version', () => {
    const social = parseEnv(SOCIAL).SOCIAL;
    expect(social).toMatchObject({
      metaAppId: '1234567890',
      metaRedirectUri: 'http://localhost:3000/api/social/meta/callback',
      metaGraphApiVersion: 'v27.0',
    });
    expect(social?.tokenEncryptionKeys.map((key) => key.length)).toEqual([32]);
    expect(
      parseEnv({ ...SOCIAL, META_GRAPH_API_VERSION: 'v28.0' }).SOCIAL?.metaGraphApiVersion,
    ).toBe('v28.0');
  });

  it('accepts several keys for rotation, the first one being current', () => {
    const next = randomBytes(32);
    const keys = parseEnv({
      ...SOCIAL,
      SOCIAL_TOKEN_ENCRYPTION_KEYS: `${next.toString('base64')}, ${KEY}`,
    }).SOCIAL?.tokenEncryptionKeys;
    expect(keys).toHaveLength(2);
    expect(keys?.[0]?.equals(next)).toBe(true);
  });

  it('fails startup on a partial configuration instead of running without encryption', () => {
    const { SOCIAL_TOKEN_ENCRYPTION_KEYS: _key, ...withoutKey } = SOCIAL;
    void _key;
    expect(issuesOf(withoutKey)).toEqual([
      'SOCIAL_TOKEN_ENCRYPTION_KEYS: is required when social account connection is configured',
    ]);
    expect(issuesOf({ META_APP_SECRET: 'only-this' })).toHaveLength(3);
  });

  it.each([
    ['too short', randomBytes(16).toString('base64')],
    ['not base64', 'not a key!'],
    ['a passphrase', 'correct horse battery staple'],
  ])('rejects an encryption key that is %s, without printing it', (_label, value) => {
    const issues = issuesOf({ ...SOCIAL, SOCIAL_TOKEN_ENCRYPTION_KEYS: value });
    expect(issues).toEqual([
      'SOCIAL_TOKEN_ENCRYPTION_KEYS[0]: must be 32 random bytes, base64-encoded',
    ]);
    expect(issues.join(' ')).not.toContain(value);
  });

  it.each([
    ['a different path', 'http://localhost:3000/callback'],
    ['a query string', 'http://localhost:3000/api/social/meta/callback?next=/x'],
    ['not a URL', 'callback'],
  ])('rejects a redirect URI with %s', (_label, value) => {
    expect(issuesOf({ ...SOCIAL, META_REDIRECT_URI: value })[0]).toMatch(/^META_REDIRECT_URI:/);
  });

  it('requires an https redirect URI in production and never echoes the app secret', () => {
    const issues = issuesOf({
      ...SOCIAL,
      NODE_ENV: 'production',
      MONGODB_URI: 'mongodb+srv://app:pw@cluster0.example.mongodb.net/metaflow',
      CORS_ORIGINS: 'https://app.metaflow.example',
      META_APP_ID: 'not-numeric',
    });
    expect(issues).toEqual([
      'META_APP_ID: must be the numeric app ID from the Meta app dashboard',
      'META_REDIRECT_URI: must use https in production',
    ]);
    expect(issues.join(' ')).not.toContain('app-secret-value');
  });
});

describe('SocialAccount and OAuthState models', () => {
  const base = {
    workspaceId: '65f0c0ffee0000000000abcd',
    platform: 'facebook',
    externalId: '1001',
    name: 'Bloom Bakery',
    accountType: 'facebook_page',
    connectedBy: '65f0c0ffee0000000000dcba',
    connectedAt: new Date(),
  };

  it('only stores a token in the encrypted format, so plaintext cannot be saved by mistake', () => {
    const encrypted = 'v1.0a1b2c3d.AAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAA.c2VjcmV0';
    expect(
      new SocialAccountModel({ ...base, encryptedToken: encrypted }).validateSync(),
    ).toBeUndefined();
    for (const encryptedToken of ['EAAG-plaintext-page-token', undefined]) {
      expect(
        new SocialAccountModel({ ...base, encryptedToken }).validateSync()?.errors.encryptedToken,
      ).toBeDefined();
    }
  });

  it('never selects or serializes the token', () => {
    expect(SocialAccountModel.schema.path('encryptedToken').options).toMatchObject({
      select: false,
    });
    const json = new SocialAccountModel({ ...base, encryptedToken: 'v1.0a1b2c3d.a.b.c' }).toJSON();
    expect(json).not.toHaveProperty('encryptedToken');
  });

  it('rejects unknown platforms, statuses and issues', () => {
    for (const [field, value] of [
      ['platform', 'tiktok'],
      ['status', 'active'],
      ['issue', 'whatever'],
      ['accountType', 'profile'],
    ] as const) {
      const account = new SocialAccountModel({
        ...base,
        encryptedToken: 'v1.0a1b2c3d.a.b.c',
        [field]: value,
      });
      expect(account.validateSync()?.errors[field]).toBeDefined();
    }
  });

  it('declares one connection per external account and workspace', () => {
    expect(SocialAccountModel.schema.indexes()).toContainEqual([
      { workspaceId: 1, platform: 1, externalId: 1 },
      expect.objectContaining({ unique: true }),
    ]);
  });

  it('stores OAuth states hashed, unique and self-expiring', () => {
    const state = new OAuthStateModel({
      stateHash: 'raw-state-value',
      userId: base.connectedBy,
      workspaceId: base.workspaceId,
      platform: 'facebook',
      expiresAt: new Date(),
    });
    expect(state.validateSync()?.errors.stateHash).toBeDefined();
    const indexes = OAuthStateModel.schema.indexes();
    expect(indexes).toContainEqual([{ stateHash: 1 }, expect.objectContaining({ unique: true })]);
    expect(indexes).toContainEqual([
      { expiresAt: 1 },
      expect.objectContaining({ expireAfterSeconds: 0 }),
    ]);
  });
});
