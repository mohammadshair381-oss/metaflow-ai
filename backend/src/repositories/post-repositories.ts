import type { PostSource, PostStatus, PostWorkflowAction, SocialPlatform } from '@metaflow/shared';

/** Data-access contract for posts. Every method is scoped by the workspace ID. */

export interface ReviewEventRecord {
  action: PostWorkflowAction;
  by: string;
  at: Date;
  note: string | null;
}

export interface PostContent {
  title: string;
  caption: string;
  hashtags: string[];
  platforms: SocialPlatform[];
  mediaIds: string[];
  socialAccountIds: string[];
}

export interface PostRecord extends PostContent {
  id: string;
  workspaceId: string;
  status: PostStatus;
  /** +1 on every content edit and workflow transition. Legacy records without one read as 0. */
  revision: number;
  source: PostSource;
  generationId: string | null;
  reviewEvents: ReviewEventRecord[];
  scheduledAt: Date | null;
  createdBy: string;
  updatedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewPost extends PostContent {
  workspaceId: string;
  source: PostSource;
  generationId: string | null;
  createdBy: string;
}

export interface PostListOptions {
  status?: PostStatus;
  platform?: SocialPlatform;
  /** Case-insensitive text search in the title and caption. */
  q?: string;
  before?: string;
  limit: number;
}

export interface PostRepository {
  /** Always creates a draft: no other status can be created directly. */
  create(post: NewPost): Promise<PostRecord>;
  findInWorkspace(workspaceId: string, postId: string): Promise<PostRecord | null>;
  /** Newest first. `before` is the ID of the last post already shown. */
  list(workspaceId: string, options: PostListOptions): Promise<PostRecord[]>;
  /**
   * Changes the content and increments the revision, in one update that requires the post to be
   * in one of `whileStatus` AND at `expectedRevision`. Null when the post does not exist in the
   * workspace or either condition no longer holds; nothing is changed then.
   */
  updateContent(
    workspaceId: string,
    postId: string,
    update: {
      changes: Partial<PostContent>;
      whileStatus: readonly PostStatus[];
      expectedRevision: number;
      by: string;
    },
  ): Promise<PostRecord | null>;
  /**
   * Moves the post from `from` to `to`, appends `event` and increments the revision, in one
   * update that requires the post to be in `from` AND at `expectedRevision` (compare-and-set).
   * Null when the post does not exist in the workspace or either condition no longer holds.
   */
  transition(
    workspaceId: string,
    postId: string,
    move: {
      from: PostStatus;
      expectedRevision: number;
      to: PostStatus;
      event: ReviewEventRecord;
    },
  ): Promise<PostRecord | null>;
  /** False when the post did not exist in the workspace (or was not in `whileStatus`). */
  remove(
    workspaceId: string,
    postId: string,
    options?: { whileStatus?: readonly PostStatus[] },
  ): Promise<boolean>;
  /** Up to `limit` posts that use the media item, newest first. */
  findUsingMedia(workspaceId: string, mediaId: string, limit: number): Promise<PostRecord[]>;
}
