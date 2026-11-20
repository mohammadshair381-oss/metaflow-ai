import { Router, type RequestHandler } from 'express';
import type { AuthController } from '../controllers/auth.controller';
import type { AuthRateLimiters } from '../middleware/rate-limit';

export interface AuthRouterDependencies {
  controller: AuthController;
  requireAuth: RequestHandler;
  limiters: AuthRateLimiters;
}

const noStore: RequestHandler = (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
};

/** Mounted at /api/auth. */
export function createAuthRouter({
  controller,
  requireAuth,
  limiters,
}: AuthRouterDependencies): Router {
  const router = Router();
  router.use(noStore);
  router.post('/register', limiters.perIp, controller.register);
  router.post('/login', limiters.perIp, limiters.failedLoginsPerAccount, controller.login);
  router.post('/logout', controller.logout);
  router.post('/logout-all', requireAuth, controller.logoutAll);
  router.get('/me', requireAuth, controller.me);
  return router;
}
