import {
  createPostRequestSchema,
  postListResponseSchema,
  postResponseSchema,
  updatePostRequestSchema,
  workspaceRoutes,
  type CreatePostRequest,
  type Post,
  type PostListResponse,
  type PostStatus,
  type PostWorkflowAction,
  type SocialPlatform,
  type UpdatePostRequest,
} from '@metaflow/shared';
import { z } from 'zod';
import { apiRequest } from './api-client';

const noContentSchema = z.undefined();

export interface PostListFilters {
  status?: PostStatus;
  platform?: SocialPlatform;
  q?: string;
  before?: string;
}

export async function listPosts(
  workspaceId: string,
  filters: PostListFilters = {},
  signal?: AbortSignal,
): Promise<PostListResponse> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (typeof value === 'string' && value.trim() !== '') params.set(key, value.trim());
  }
  const suffix = params.size > 0 ? `?${params.toString()}` : '';
  const { data } = await apiRequest(
    `${workspaceRoutes(workspaceId).posts}${suffix}`,
    postListResponseSchema,
    { signal },
  );
  return data;
}

export async function getPost(
  workspaceId: string,
  postId: string,
  signal?: AbortSignal,
): Promise<Post> {
  const { data } = await apiRequest(workspaceRoutes(workspaceId).post(postId), postResponseSchema, {
    signal,
  });
  return data.post;
}

/** Validated with the same rules the API applies before anything is sent. */
export async function createPost(workspaceId: string, input: CreatePostRequest): Promise<Post> {
  const body = createPostRequestSchema.parse(input);
  const { data } = await apiRequest(workspaceRoutes(workspaceId).posts, postResponseSchema, {
    method: 'POST',
    body,
  });
  return data.post;
}

/**
 * `changes.revision` is the revision the editor loaded; the server refuses the edit with
 * 409 CONFLICT if the post has changed since. Never retried automatically.
 */
export async function updatePost(
  workspaceId: string,
  postId: string,
  changes: UpdatePostRequest,
): Promise<Post> {
  const body = updatePostRequestSchema.parse(changes);
  const { data } = await apiRequest(workspaceRoutes(workspaceId).post(postId), postResponseSchema, {
    method: 'PATCH',
    body,
  });
  return data.post;
}

export async function deletePost(workspaceId: string, postId: string): Promise<void> {
  await apiRequest(workspaceRoutes(workspaceId).post(postId), noContentSchema, {
    method: 'DELETE',
  });
}

export async function duplicatePost(workspaceId: string, postId: string): Promise<Post> {
  const { data } = await apiRequest(
    workspaceRoutes(workspaceId).postDuplicate(postId),
    postResponseSchema,
    { method: 'POST' },
  );
  return data.post;
}

/**
 * `revision` is the revision of the post the user is looking at: the server applies the action
 * only to exactly that version and answers 409 CONFLICT if it has changed since.
 */
export async function runPostWorkflow(
  workspaceId: string,
  postId: string,
  action: PostWorkflowAction,
  revision: number,
  note?: string,
): Promise<Post> {
  const { data } = await apiRequest(
    workspaceRoutes(workspaceId).postWorkflow(postId),
    postResponseSchema,
    { method: 'POST', body: note ? { action, revision, note } : { action, revision } },
  );
  return data.post;
}
