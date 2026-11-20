import type { Post, PostStatus, createDraftRequestSchema } from '@metaflow/shared';
import type { z } from 'zod';
import type { AiGenerationRepository } from '../repositories/ai-repositories';
import type { PostRecord, PostRepository } from '../repositories/post-repositories';
import { AppError } from '../utils/app-error';
import type { WorkspaceService } from './workspace.service';

type DraftInput = z.output<typeof createDraftRequestSchema>;

export interface PostService {
  /** Any member may save a draft. */
  createDraft(userId: string, workspaceId: string, input: DraftInput): Promise<PostRecord>;
  list(
    userId: string,
    workspaceId: string,
    query: { status?: PostStatus; before?: string; limit: number },
  ): Promise<{ posts: PostRecord[]; nextCursor: string | null }>;
}

export function toPost(record: PostRecord): Post {
  return {
    id: record.id,
    status: record.status,
    caption: record.caption,
    hashtags: record.hashtags,
    platforms: record.platforms,
    source: record.source,
    generationId: record.generationId,
    createdBy: record.createdBy,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export function createPostService({
  workspaces,
  posts,
  generations,
}: {
  workspaces: Pick<WorkspaceService, 'requireAccess'>;
  posts: PostRepository;
  generations: Pick<AiGenerationRepository, 'findInWorkspace'>;
}): PostService {
  return {
    async createDraft(userId, workspaceId, input) {
      await workspaces.requireAccess(userId, workspaceId);
      // A draft can only point at a generation of the same workspace.
      if (
        input.generationId &&
        !(await generations.findInWorkspace(workspaceId, input.generationId))
      ) {
        throw new AppError('NOT_FOUND', 'AI generation not found');
      }
      return posts.createDraft({
        workspaceId,
        caption: input.caption,
        hashtags: input.hashtags,
        platforms: input.platforms,
        source: input.generationId ? 'ai_studio' : 'manual',
        generationId: input.generationId ?? null,
        createdBy: userId,
      });
    },

    async list(userId, workspaceId, { status, before, limit }) {
      await workspaces.requireAccess(userId, workspaceId);
      const page = await posts.list(workspaceId, { status, before, limit: limit + 1 });
      const result = page.slice(0, limit);
      return {
        posts: result,
        nextCursor: page.length > limit ? (result.at(-1)?.id ?? null) : null,
      };
    },
  };
}
