import { Router } from 'express';
import type { HealthController } from '../controllers/health.controller';
import { createAuthRouter, type AuthRouterDependencies } from './auth.routes';
import { createHealthRouter } from './health.routes';
import { createWorkspaceRouter, type WorkspaceRouterDependencies } from './workspace.routes';

export interface ApiRouterDependencies {
  health: HealthController;
  auth: AuthRouterDependencies;
  workspaces: WorkspaceRouterDependencies;
}

/** Mounted at /api. Each feature module adds its router here. */
export function createApiRouter({ health, auth, workspaces }: ApiRouterDependencies): Router {
  const router = Router();
  router.use('/health', createHealthRouter(health));
  router.use('/auth', createAuthRouter(auth));
  router.use('/workspaces', createWorkspaceRouter(workspaces));
  return router;
}
