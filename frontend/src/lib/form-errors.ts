import type { z } from 'zod';
import { ApiRequestError } from '@/services/api-client';

export type FieldErrors<Field extends string> = Partial<Record<Field, string>>;

/** First message per top-level field from a Zod validation error. */
export function fieldErrorsFromZod<Field extends string>(error: z.ZodError): FieldErrors<Field> {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? '');
    if (field && !(field in errors)) errors[field] = issue.message;
  }
  return errors as FieldErrors<Field>;
}

/**
 * Turns a failed API call into what a form shows: messages next to fields when the server
 * named a field, otherwise one form-level message. Server messages are already user-safe
 * (generic where it matters, e.g. "Incorrect email or password").
 */
export function describeSubmitError<Field extends string>(
  error: unknown,
  fields: readonly Field[],
): { fieldErrors: FieldErrors<Field>; formError: string | null } {
  if (!(error instanceof ApiRequestError)) {
    return { fieldErrors: {}, formError: 'Something went wrong. Please try again.' };
  }

  if (error.code === 'VALIDATION_ERROR') {
    const fieldErrors: Record<string, string> = {};
    for (const issue of error.details) {
      const field = issue.path.replace(/^body\./, '').split('.')[0] ?? '';
      if ((fields as readonly string[]).includes(field) && !(field in fieldErrors)) {
        fieldErrors[field] = issue.message;
      }
    }
    return {
      fieldErrors: fieldErrors as FieldErrors<Field>,
      formError: 'Check the highlighted fields.',
    };
  }

  if (error.code === 'EMAIL_TAKEN' && (fields as readonly string[]).includes('email')) {
    return { fieldErrors: { email: error.message } as FieldErrors<Field>, formError: null };
  }

  if (error.code === 'FORBIDDEN') {
    return {
      fieldErrors: {},
      formError: 'This site is not allowed to sign in to the MetaFlow API. Contact support.',
    };
  }

  return { fieldErrors: {}, formError: error.message };
}
