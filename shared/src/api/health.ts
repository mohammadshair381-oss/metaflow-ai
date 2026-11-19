import { z } from 'zod';
import { APP_ENVIRONMENTS } from '../constants';

/**
 * GET /api/health — liveness. Answers as long as the process is running,
 * independent of the database.
 */
export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.string(),
  version: z.string(),
  /** Short git commit of the running build when the host provides one (Render does). */
  commit: z.string().nullable(),
  environment: z.enum(APP_ENVIRONMENTS),
  uptimeSeconds: z.number().nonnegative(),
  timestamp: z.iso.datetime(),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const DATABASE_CHECK_STATUSES = ['up', 'down', 'not_configured'] as const;

export const databaseCheckSchema = z.object({
  status: z.enum(DATABASE_CHECK_STATUSES),
  /** Round-trip time of the ping when it succeeded. */
  latencyMs: z.number().nonnegative().optional(),
});
export type DatabaseCheck = z.infer<typeof databaseCheckSchema>;

/**
 * GET /api/health/ready — readiness. 200 with status "ready" when every configured
 * dependency answers, 503 with status "not_ready" otherwise. Same body shape for both.
 */
export const readinessResponseSchema = z.object({
  status: z.enum(['ready', 'not_ready']),
  timestamp: z.iso.datetime(),
  checks: z.object({
    database: databaseCheckSchema,
  }),
});
export type ReadinessResponse = z.infer<typeof readinessResponseSchema>;
