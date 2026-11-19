import { Router } from 'express';
import type { HealthController } from '../controllers/health.controller';
import { createHealthRouter } from './health.routes';

export interface ApiControllers {
  health: HealthController;
}

/** Mounted at /api. Each feature module adds its router here. */
export function createApiRouter(controllers: ApiControllers): Router {
  const router = Router();
  router.use('/health', createHealthRouter(controllers.health));
  return router;
}
