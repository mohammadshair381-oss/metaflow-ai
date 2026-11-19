import type { RequestHandler } from 'express';
import type { HealthService } from '../services/health.service';

export interface HealthController {
  getHealth: RequestHandler;
  getReadiness: RequestHandler;
}

/** HTTP adapter for the health service. Holds no logic beyond status codes and headers. */
export function createHealthController(service: HealthService): HealthController {
  return {
    getHealth: (_req, res) => {
      res.set('Cache-Control', 'no-store');
      res.status(200).json(service.getHealth());
    },

    getReadiness: async (_req, res) => {
      const readiness = await service.getReadiness();
      res.set('Cache-Control', 'no-store');
      res.status(readiness.status === 'ready' ? 200 : 503).json(readiness);
    },
  };
}
