import {
  createPostRequestSchema,
  postListQuerySchema,
  postWorkflowRequestSchema,
  recordIdSchema,
  updatePostRequestSchema,
  type PostListResponse,
  type PostResponse,
} from '@metaflow/shared';
import type { RequestHandler, Response } from 'express';
import { z } from 'zod';
import { toPost, type PostService } from '../services/post.service';
import { AppError } from '../utils/app-error';
import { parseRequest } from '../validators/parse-request';

export interface PostController {
  list: RequestHandler;
  create: RequestHandler;
  get: RequestHandler;
  update: RequestHandler;
  remove: RequestHandler;
  duplicate: RequestHandler;
  workflow: RequestHandler;
}

const workspaceParams = z.object({ workspaceId: recordIdSchema });
const postParams = z.object({ workspaceId: recordIdSchema, postId: recordIdSchema });

export function createPostController(service: PostService): PostController {
  const callerId = (res: Response) => {
    const auth = res.locals.auth;
    if (!auth) throw new AppError('UNAUTHENTICATED', 'Sign in to continue');
    return auth.user.id;
  };
  const send = (res: Response, status: number, payload: PostResponse) =>
    res.status(status).json(payload);

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

    create: async (req, res) => {
      const { params, body } = parseRequest(req, {
        params: workspaceParams,
        body: createPostRequestSchema,
      });
      const post = await service.create(callerId(res), params.workspaceId, body);
      send(res, 201, { post: toPost(post) });
    },

    get: async (req, res) => {
      const { params } = parseRequest(req, { params: postParams });
      const post = await service.get(callerId(res), params.workspaceId, params.postId);
      send(res, 200, { post: toPost(post) });
    },

    update: async (req, res) => {
      const { params, body } = parseRequest(req, {
        params: postParams,
        body: updatePostRequestSchema,
      });
      const post = await service.update(callerId(res), params.workspaceId, params.postId, body);
      send(res, 200, { post: toPost(post) });
    },

    remove: async (req, res) => {
      const { params } = parseRequest(req, { params: postParams });
      await service.remove(callerId(res), params.workspaceId, params.postId);
      res.status(204).end();
    },

    duplicate: async (req, res) => {
      const { params } = parseRequest(req, { params: postParams });
      const post = await service.duplicate(callerId(res), params.workspaceId, params.postId);
      send(res, 201, { post: toPost(post) });
    },

    workflow: async (req, res) => {
      const { params, body } = parseRequest(req, {
        params: postParams,
        body: postWorkflowRequestSchema,
      });
      const post = await service.workflow(callerId(res), params.workspaceId, params.postId, body);
      send(res, 200, { post: toPost(post) });
    },
  };
}
