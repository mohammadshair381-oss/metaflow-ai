import {
  BACKEND_SERVICE_NAME,
  type AppEnvironment,
  type HealthResponse,
  type ReadinessResponse,
} from '@metaflow/shared';
import type { DatabaseHealthProbe } from '../config/database';

export interface HealthService {
  /** Liveness: never touches external dependencies. */
  getHealth(): HealthResponse;
  /** Readiness: verifies MongoDB when it is configured. */
  getReadiness(): Promise<ReadinessResponse>;
}

export interface HealthServiceDependencies {
  environment: AppEnvironment;
  version: string;
  commit: string | null;
  database: DatabaseHealthProbe;
  now?: () => Date;
  uptimeSeconds?: () => number;
}

export function createHealthService({
  environment,
  version,
  commit,
  database,
  now = () => new Date(),
  uptimeSeconds = () => process.uptime(),
}: HealthServiceDependencies): HealthService {
  return {
    getHealth() {
      return {
        status: 'ok',
        service: BACKEND_SERVICE_NAME,
        version,
        commit,
        environment,
        uptimeSeconds: Math.round(uptimeSeconds() * 10) / 10,
        timestamp: now().toISOString(),
      };
    },

    async getReadiness() {
      const timestamp = now().toISOString();

      if (!database.isConfigured) {
        return { status: 'ready', timestamp, checks: { database: { status: 'not_configured' } } };
      }

      const ping = await database.ping().catch(() => ({ ok: false as const }));
      if (ping.ok) {
        return {
          status: 'ready',
          timestamp,
          checks: { database: { status: 'up', latencyMs: ping.latencyMs } },
        };
      }
      return { status: 'not_ready', timestamp, checks: { database: { status: 'down' } } };
    },
  };
}
