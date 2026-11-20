import { describe, expect, it } from 'vitest';
import {
  authUserSchema,
  emailSchema,
  loginRequestSchema,
  passwordSchema,
  registerRequestSchema,
} from './auth';

describe('emailSchema', () => {
  it('trims and lower-cases addresses so each email registers once', () => {
    expect(emailSchema.parse('  Owner@Example.COM ')).toBe('owner@example.com');
  });

  it.each(['', 'not-an-email', 'a@', '@example.com', 'a b@example.com'])('rejects %j', (value) => {
    expect(emailSchema.safeParse(value).success).toBe(false);
  });

  it('rejects addresses longer than 254 characters', () => {
    expect(emailSchema.safeParse(`${'a'.repeat(250)}@example.com`).success).toBe(false);
  });
});

describe('passwordSchema', () => {
  it('accepts a long, uncommon password', () => {
    expect(passwordSchema.safeParse('correct horse battery staple').success).toBe(true);
  });

  it.each([
    ['too short', 'Sh0rt!pw'],
    ['too long', 'x'.repeat(129)],
    ['common', '1234567890'],
    ['common, any case', 'Password123'],
    ['repeated characters', 'aaaaaaaaaaaa'],
    ['two characters', 'abababababab'],
  ])('rejects a %s password', (_label, value) => {
    expect(passwordSchema.safeParse(value).success).toBe(false);
  });
});

describe('registerRequestSchema', () => {
  it('normalizes the email and trims the name', () => {
    const parsed = registerRequestSchema.parse({
      name: '  Ada Lovelace ',
      email: 'ADA@Example.com',
      password: 'analytical engine 1843',
    });
    expect(parsed).toEqual({
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      password: 'analytical engine 1843',
    });
  });

  it('rejects a blank name and control characters', () => {
    const base = { email: 'a@example.com', password: 'analytical engine 1843' };
    expect(registerRequestSchema.safeParse({ ...base, name: '   ' }).success).toBe(false);
    expect(registerRequestSchema.safeParse({ ...base, name: 'Ada\u0000' }).success).toBe(false);
  });
});

describe('loginRequestSchema', () => {
  it('does not apply the password policy, so old passwords still reach the hash check', () => {
    expect(
      loginRequestSchema.safeParse({ email: 'a@example.com', password: 'short' }).success,
    ).toBe(true);
  });

  it('requires a password', () => {
    expect(loginRequestSchema.safeParse({ email: 'a@example.com', password: '' }).success).toBe(
      false,
    );
  });
});

describe('authUserSchema', () => {
  it('strips any password-related field from user payloads', () => {
    const parsed = authUserSchema.parse({
      id: '1',
      name: 'Ada',
      email: 'ada@example.com',
      status: 'active',
      emailVerified: false,
      createdAt: '2026-11-20T10:00:00.000Z',
      passwordHash: 'scrypt$should-never-be-here',
    });
    expect(parsed).not.toHaveProperty('passwordHash');
  });
});
