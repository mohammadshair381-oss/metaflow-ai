import { Router, type RequestHandler } from 'express';
import type { AiStudioController } from '../controllers/ai-studio.controller';
import type { PostController } from '../controllers/post.controller';

const noStore: RequestHandler = (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
};

export interface AiStudioRouterDependencies {
  controller: AiStudioController;
  requireAuth: RequestHandler;
  /** Per signed-in user: every generation is a paid call to the AI provider. */
  generationLimiter: RequestHandler;
}

/**
 * Mounted at /api/workspaces/:workspaceId/ai. Every route needs a session; the service checks
 * workspace membership (and ownership for the brand voice) on each call.
 */
export function createAiStudioRouter({
  controller,
  requireAuth,
  generationLimiter,
}: AiStudioRouterDependencies): Router {
  const router = Router({ mergeParams: true });
  router.use(noStore, requireAuth);
  router.get('/status', controller.status);
  router.post('/captions', generationLimiter, controller.captions);
  router.post('/hashtags', generationLimiter, controller.hashtags);
  router.post('/ideas', generationLimiter, controller.ideas);
  router.get('/brand-voice', controller.getBrandVoice);
  router.put('/brand-voice', controller.updateBrandVoice);
  router.get('/generations', controller.generations);
  router.get('/usage', controller.usage);
  return router;
}

export interface PostRouterDependencies {
  controller: PostController;
  requireAuth: RequestHandler;
}

/**
 * Mounted at /api/workspaces/:workspaceId/posts. Every route needs a session; the service
 * checks membership, roles and the post's status on each call.
 */
export function createPostRouter({ controller, requireAuth }: PostRouterDependencies): Router {
  const router = Router({ mergeParams: true });
  router.use(noStore, requireAuth);
  router.get('/', controller.list);
  router.post('/', controller.create);
  router.get('/:postId', controller.get);
  router.patch('/:postId', controller.update);
  router.delete('/:postId', controller.remove);
  router.post('/:postId/duplicate', controller.duplicate);
  router.post('/:postId/workflow', controller.workflow);
  return router;
}
