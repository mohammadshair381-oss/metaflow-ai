import {
  createDraftRequestSchema,
  postListQuerySchema,
  recordIdSchema,
  type PostListResponse,
} from '@metaflow/shared';
import type { RequestHandler, Response } from 'express';
import { z } from 'zod';
import { toPost, type PostService } from '../services/post.service';
import { AppError } from '../utils/app-error';
import { parseRequest } from '../validators/parse-request';

export interface PostController {
  list: RequestHandler;
  createDraft: RequestHandler;
}

const workspaceParams = z.object({ workspaceId: recordIdSchema });

export function createPostController(service: PostService): PostController {
  const callerId = (res: Response) => {
    const auth = res.locals.auth;
    if (!auth) throw new AppError('UNAUTHENTICATED', 'Sign in to continue');
    return auth.user.id;
  };

  return {
    list: async (req, res) => {
      const { params, query } = parseRequest(req, {
        params: workspaceParams,
        query: postListQuerySchema,
      });
      const page = await service.list(callerId(res), params.workspaceId, query);
      const payload: PostListResponse = {
        posts: page.posts.map(toPost),
        nextCursor: page.nextCursor,
      };
      res.status(200).json(payload);
    },

    createDraft: async (req, res) => {
      const { params, body } = parseRequest(req, {
        params: workspaceParams,
        body: createDraftRequestSchema,
      });
      const post = await service.createDraft(callerId(res), params.workspaceId, body);
      res.status(201).json({ post: toPost(post) });
    },
  };
}
