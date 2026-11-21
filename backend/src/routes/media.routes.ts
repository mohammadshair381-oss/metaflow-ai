import { Router, type RequestHandler } from 'express';
import type { MediaController } from '../controllers/media.controller';

const noStore: RequestHandler = (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
};

export interface MediaRouterDependencies {
  controller: MediaController;
  requireAuth: RequestHandler;
  /** Per signed-in user. */
  uploadLimiter: RequestHandler;
  /** Parses the multipart body into a temporary file. */
  uploadParser: RequestHandler;
}

/**
 * Mounted at /api/workspaces/:workspaceId/media. Every route needs a session; the service
 * checks workspace membership on each call. Uploads are authorized before the body is read.
 */
export function createMediaRouter({
  controller,
  requireAuth,
  uploadLimiter,
  uploadParser,
}: MediaRouterDependencies): Router {
  const router = Router({ mergeParams: true });
  router.use(requireAuth);
  router.get('/', noStore, controller.list);
  router.post(
    '/',
    noStore,
    uploadLimiter,
    controller.authorizeUpload,
    uploadParser,
    controller.upload,
  );
  router.get('/:mediaId', noStore, controller.get);
  router.patch('/:mediaId', noStore, controller.update);
  router.delete('/:mediaId', noStore, controller.remove);
  // Sets its own caching and security headers.
  router.get('/:mediaId/file', controller.file);
  return router;
}

/** Mounted at /api/workspaces/:workspaceId/logo. Owner only (checked by the service). */
export function createWorkspaceLogoRouter({
  controller,
  requireAuth,
}: Pick<MediaRouterDependencies, 'controller' | 'requireAuth'>): Router {
  const router = Router({ mergeParams: true });
  router.use(noStore, requireAuth);
  router.put('/', controller.setLogo);
  return router;
}
