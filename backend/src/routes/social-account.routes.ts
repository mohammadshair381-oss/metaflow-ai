import { Router, type RequestHandler } from 'express';
import type { SocialAccountController } from '../controllers/social-account.controller';

export interface SocialAccountRouterDependencies {
  controller: SocialAccountController;
  requireAuth: RequestHandler;
  /** Limits how often one client can start an authorization. */
  connectLimiter: RequestHandler;
}

const noStore: RequestHandler = (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
};

/**
 * Mounted at /api/workspaces/:workspaceId/social-accounts. Every route needs a session; the
 * service checks workspace membership (and ownership where required) on each call.
 */
export function createSocialAccountRouter({
  controller,
  requireAuth,
  connectLimiter,
}: SocialAccountRouterDependencies): Router {
  const router = Router({ mergeParams: true });
  router.use(noStore, requireAuth);
  router.get('/', controller.list);
  router.post('/connect', connectLimiter, controller.connect);
  router.get('/:accountId', controller.get);
  router.post('/:accountId/refresh', controller.refresh);
  router.delete('/:accountId', controller.disconnect);
  return router;
}

/** Mounted at /api/social. The OAuth callback authenticates from the session cookie itself. */
export function createSocialCallbackRouter(controller: SocialAccountController): Router {
  const router = Router();
  router.get('/meta/callback', controller.metaCallback);
  return router;
}
