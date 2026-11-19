import { Router } from 'express';
import type { HealthController } from '../controllers/health.controller';

/** Mounted at /api/health. */
export function createHealthRouter(controller: HealthController): Router {
  const router = Router();
  router.get('/', controller.getHealth);
  router.get('/ready', controller.getReadiness);
  return router;
}
