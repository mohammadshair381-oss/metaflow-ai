import { Router } from 'express';
import type { HealthController } from '../controllers/health.controller';
import {
  createAiStudioRouter,
  createPostRouter,
  type AiStudioRouterDependencies,
  type PostRouterDependencies,
} from './ai-studio.routes';
import { createAuthRouter, type AuthRouterDependencies } from './auth.routes';
import { createHealthRouter } from './health.routes';
import {
  createSocialAccountRouter,
  createSocialCallbackRouter,
  type SocialAccountRouterDependencies,
} from './social-account.routes';
import { createWorkspaceRouter, type WorkspaceRouterDependencies } from './workspace.routes';

export interface ApiRouterDependencies {
  health: HealthController;
  auth: AuthRouterDependencies;
  workspaces: WorkspaceRouterDependencies;
  social: SocialAccountRouterDependencies;
  ai: AiStudioRouterDependencies;
  posts: PostRouterDependencies;
}

/** Mounted at /api. Each feature module adds its router here. */
export function createApiRouter({
  health,
  auth,
  workspaces,
  social,
  ai,
  posts,
}: ApiRouterDependencies): Router {
  const router = Router();
  router.use('/health', createHealthRouter(health));
  router.use('/auth', createAuthRouter(auth));
  router.use('/workspaces/:workspaceId/social-accounts', createSocialAccountRouter(social));
  router.use('/workspaces/:workspaceId/ai', createAiStudioRouter(ai));
  router.use('/workspaces/:workspaceId/posts', createPostRouter(posts));
  router.use('/workspaces', createWorkspaceRouter(workspaces));
  router.use('/social', createSocialCallbackRouter(social.controller));
  return router;
}
