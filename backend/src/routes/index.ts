import { Router } from 'express';
import type { HealthController } from '../controllers/health.controller';
import { createAuthRouter, type AuthRouterDependencies } from './auth.routes';
import { createHealthRouter } from './health.routes';

export interface ApiRouterDependencies {
  health: HealthController;
  auth: AuthRouterDependencies;
}

/** Mounted at /api. Each feature module adds its router here. */
export function createApiRouter({ health, auth }: ApiRouterDependencies): Router {
  const router = Router();
  router.use('/health', createHealthRouter(health));
  router.use('/auth', createAuthRouter(auth));
  return router;
}
