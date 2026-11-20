import { Router, type RequestHandler } from 'express';
import type { WorkspaceController } from '../controllers/workspace.controller';

export interface WorkspaceRouterDependencies {
  controller: WorkspaceController;
  requireAuth: RequestHandler;
}

/** Mounted at /api/workspaces. Every route needs a session; the service checks membership. */
export function createWorkspaceRouter({
  controller,
  requireAuth,
}: WorkspaceRouterDependencies): Router {
  const router = Router();
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  router.use(requireAuth);
  router.get('/', controller.list);
  router.post('/', controller.create);
  router.get('/:workspaceId', controller.get);
  router.patch('/:workspaceId', controller.update);
  router.post('/:workspaceId/archive', controller.archive);
  router.get('/:workspaceId/members', controller.listMembers);
  return router;
}
