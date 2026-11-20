import { z } from 'zod';

/**
 * Machine-readable error codes returned by the backend.
 * Only codes the backend actually emits are listed; add new ones together with the code that uses them.
 */
export const ERROR_CODES = [
  'BAD_REQUEST',
  'VALIDATION_ERROR',
  /** No valid session: not signed in, expired, or revoked. */
  'UNAUTHENTICATED',
  /** Wrong email or password. Deliberately does not say which. */
  'INVALID_CREDENTIALS',
  /** State-changing request from an origin that is not allowed. */
  'FORBIDDEN',
  /** Signed in, but the caller's role does not allow the action. */
  'PERMISSION_DENIED',
  'NOT_FOUND',
  'EMAIL_TAKEN',
  /** A per-user or per-plan limit would be exceeded. */
  'LIMIT_REACHED',
  'PAYLOAD_TOO_LARGE',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
  /** A dependency (the database) is temporarily unreachable. */
  'SERVICE_UNAVAILABLE',
] as const;

export const errorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const validationIssueSchema = z.object({
  /** Dot-separated location of the invalid value, prefixed with body/query/params. */
  path: z.string(),
  message: z.string(),
});
export type ValidationIssue = z.infer<typeof validationIssueSchema>;

/** Envelope for every non-2xx JSON response from the backend. */
export const apiErrorResponseSchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    message: z.string(),
    requestId: z.string().optional(),
    details: z.array(validationIssueSchema).optional(),
  }),
});
export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>;
