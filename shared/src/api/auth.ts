import { z } from 'zod';

export const PASSWORD_MIN_LENGTH = 10;
/** Upper bound keeps password hashing cost bounded (and matches common password managers). */
export const PASSWORD_MAX_LENGTH = 128;
export const NAME_MAX_LENGTH = 80;
export const EMAIL_MAX_LENGTH = 254;

/**
 * Very common passwords that satisfy the length rule but are guessed first in attacks.
 * Length plus a blocklist follows NIST SP 800-63B, rather than character-class rules.
 */
const COMMON_PASSWORDS = new Set([
  '1234567890',
  '12345678910',
  '0123456789',
  '9876543210',
  '1111111111',
  '0000000000',
  'qwertyuiop',
  'asdfghjkl;',
  '1q2w3e4r5t',
  'q1w2e3r4t5',
  'password12',
  'password123',
  'password1234',
  'passw0rd123',
  'qwerty1234',
  'qwerty12345',
  'iloveyou123',
  'abcdefghij',
  'abc1234567',
  'letmein123',
  'welcome123',
  'admin12345',
]);

/** Trimmed and lower-cased, so the same address can only register once. */
export const emailSchema = z
  .string({ error: 'Email is required' })
  .trim()
  .toLowerCase()
  .max(EMAIL_MAX_LENGTH, 'Email is too long')
  .pipe(z.email({ error: 'Enter a valid email address' }));

export const passwordSchema = z
  .string({ error: 'Password is required' })
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(PASSWORD_MAX_LENGTH, `Use at most ${PASSWORD_MAX_LENGTH} characters`)
  .refine((value) => !COMMON_PASSWORDS.has(value.toLowerCase()), {
    error: 'This password is too common. Choose something harder to guess',
  })
  .refine((value) => new Set(value).size > 2, {
    error: 'This password is too easy to guess',
  });

export const displayNameSchema = z
  .string({ error: 'Name is required' })
  .trim()
  .min(1, 'Name is required')
  .max(NAME_MAX_LENGTH, `Use at most ${NAME_MAX_LENGTH} characters`)
  // eslint-disable-next-line no-control-regex
  .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), {
    error: 'Name contains invalid characters',
  });

export const registerRequestSchema = z.object({
  name: displayNameSchema,
  email: emailSchema,
  password: passwordSchema,
});
export type RegisterRequest = z.infer<typeof registerRequestSchema>;

/** Login does not re-apply the password policy: it only needs to be checked against the hash. */
export const loginRequestSchema = z.object({
  email: emailSchema,
  password: z
    .string({ error: 'Password is required' })
    .min(1, 'Password is required')
    .max(PASSWORD_MAX_LENGTH, 'Incorrect email or password'),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const ACCOUNT_STATUSES = ['active', 'suspended'] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

/** The only user shape the API ever returns. It has no password or hash field by design. */
export const authUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  status: z.enum(ACCOUNT_STATUSES),
  emailVerified: z.boolean(),
  createdAt: z.iso.datetime(),
});
export type AuthUser = z.infer<typeof authUserSchema>;

export const authUserResponseSchema = z.object({ user: authUserSchema });
export type AuthUserResponse = z.infer<typeof authUserResponseSchema>;
