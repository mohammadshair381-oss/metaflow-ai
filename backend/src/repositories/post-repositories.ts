import type { PostSource, PostStatus, SocialPlatform } from '@metaflow/shared';

/** Data-access contract for posts. Every method is scoped by the workspace ID. */

export interface PostRecord {
  id: string;
  workspaceId: string;
  status: PostStatus;
  caption: string;
  hashtags: string[];
  platforms: SocialPlatform[];
  source: PostSource;
  generationId: string | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewDraft {
  workspaceId: string;
  caption: string;
  hashtags: string[];
  platforms: SocialPlatform[];
  source: PostSource;
  generationId: string | null;
  createdBy: string;
}

export interface PostRepository {
  /** Always creates a draft: no other status can be created directly. */
  createDraft(draft: NewDraft): Promise<PostRecord>;
  /** Newest first. `before` is the ID of the last post already shown. */
  list(
    workspaceId: string,
    options: { status?: PostStatus; before?: string; limit: number },
  ): Promise<PostRecord[]>;
}
