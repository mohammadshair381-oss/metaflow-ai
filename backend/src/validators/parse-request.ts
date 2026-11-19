import type { ValidationIssue } from '@metaflow/shared';
import type { Request } from 'express';
import type { z } from 'zod';
import { AppError } from '../utils/app-error';

type RequestLocation = 'params' | 'query' | 'body';

export type RequestSchemas = Partial<Record<RequestLocation, z.ZodType>>;

export type ParsedRequest<S extends RequestSchemas> = {
  [K in keyof S]: S[K] extends z.ZodType ? z.output<S[K]> : never;
};

const LOCATIONS: readonly RequestLocation[] = ['params', 'query', 'body'];

export function toValidationIssues(error: z.ZodError, location?: string): ValidationIssue[] {
  return error.issues.map((issue) => ({
    path: [location, ...issue.path.map(String)].filter(Boolean).join('.'),
    message: issue.message,
  }));
}

/**
 * Validate request input against Zod schemas and return the parsed, typed values.
 *
 * Usage inside a controller:
 *   const { body } = parseRequest(req, { body: createWorkspaceBodySchema });
 *
 * Collects problems from every location before failing, then throws a single
 * VALIDATION_ERROR (HTTP 400) that the central error handler serializes.
 * Never trust `req.body`, `req.query` or `req.params` without going through this.
 */
export function parseRequest<S extends RequestSchemas>(req: Request, schemas: S): ParsedRequest<S> {
  const parsed: Partial<Record<RequestLocation, unknown>> = {};
  const issues: ValidationIssue[] = [];

  for (const location of LOCATIONS) {
    const schema = schemas[location];
    if (!schema) continue;
    const result = schema.safeParse(req[location]);
    if (result.success) {
      parsed[location] = result.data;
    } else {
      issues.push(...toValidationIssues(result.error, location));
    }
  }

  if (issues.length > 0) {
    throw AppError.validation(issues);
  }
  return parsed as ParsedRequest<S>;
}
