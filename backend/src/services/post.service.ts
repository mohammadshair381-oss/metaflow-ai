import {
  checkPostReadiness,
  draftContentIssues,
  EDITABLE_POST_STATUSES,
  POST_LIMITS,
  POST_STATUS_LABELS,
  SOCIAL_PLATFORM_LABELS,
  type createPostRequestSchema,
  type Post,
  type PostStatus,
  type PostWorkflowAction,
  type postListQuerySchema,
  type ReadinessIssue,
  type updatePostRequestSchema,
  type ValidationIssue,
} from '@metaflow/shared';
import type { z } from 'zod';
import type { AiGenerationRepository } from '../repositories/ai-repositories';
import type { MediaRecord, MediaRepository } from '../repositories/media-repositories';
import type { PostContent, PostRecord, PostRepository } from '../repositories/post-repositories';
import type {
  SocialAccountRecord,
  SocialAccountRepository,
} from '../repositories/social-repositories';
import { AppError } from '../utils/app-error';
import type { WorkspaceService } from './workspace.service';

type CreateInput = z.output<typeof createPostRequestSchema>;
type UpdateInput = z.output<typeof updatePostRequestSchema>;
type ListQuery = z.output<typeof postListQuerySchema>;

/** A post with the media items and accounts it references that still exist, in its order. */
export interface ResolvedPost {
  record: PostRecord;
  media: MediaRecord[];
  accounts: SocialAccountRecord[];
}

export interface PostService {
  /** Any member. Always a draft. */
  create(userId: string, workspaceId: string, input: CreateInput): Promise<ResolvedPost>;
  list(
    userId: string,
    workspaceId: string,
    query: ListQuery,
  ): Promise<{ posts: ResolvedPost[]; nextCursor: string | null }>;
  get(userId: string, workspaceId: string, postId: string): Promise<ResolvedPost>;
  /**
   * Any member, while the post is a draft or has changes requested, and only if
   * `changes.revision` is still the post's current revision (the version the editor loaded).
   */
  update(
    userId: string,
    workspaceId: string,
    postId: string,
    changes: UpdateInput,
  ): Promise<ResolvedPost>;
  /** Any member. A new draft with the same content and references; files are not copied. */
  duplicate(userId: string, workspaceId: string, postId: string): Promise<ResolvedPost>;
  /** Owners: any post. Staff: their own posts while editable. Media files are never deleted. */
  remove(userId: string, workspaceId: string, postId: string): Promise<void>;
  /**
   * `revision` is the revision the caller is looking at. The action applies only if the post is
   * still at exactly that revision and in an allowed status, checked atomically.
   */
  workflow(
    userId: string,
    workspaceId: string,
    postId: string,
    request: { action: PostWorkflowAction; revision: number; note?: string },
  ): Promise<ResolvedPost>;
}

/**
 * The approval workflow. Owners approve and request changes; staff never can. An owner may
 * approve a post they submitted themselves (a workspace may have a single owner); the event
 * log records who did what.
 */
const WORKFLOW: Record<
  PostWorkflowAction,
  { from: readonly PostStatus[]; to: PostStatus; ownerOnly: boolean; needsReady: boolean }
> = {
  submit: {
    from: ['draft', 'changes_requested'],
    to: 'awaiting_approval',
    ownerOnly: false,
    needsReady: true,
  },
  withdraw: { from: ['awaiting_approval'], to: 'draft', ownerOnly: false, needsReady: false },
  approve: { from: ['awaiting_approval'], to: 'approved', ownerOnly: true, needsReady: true },
  request_changes: {
    from: ['awaiting_approval'],
    to: 'changes_requested',
    ownerOnly: true,
    needsReady: false,
  },
  reopen: { from: ['approved'], to: 'draft', ownerOnly: false, needsReady: false },
};

const ACTION_VERBS: Record<PostWorkflowAction, string> = {
  submit: 'submit',
  withdraw: 'withdraw',
  approve: 'approve',
  request_changes: 'request changes on',
  reopen: 'reopen',
};

export function readinessOf({ record, media, accounts }: ResolvedPost): ReadinessIssue[] {
  return checkPostReadiness({
    platforms: record.platforms,
    caption: record.caption,
    hashtags: record.hashtags,
    media,
    accounts,
    missingMediaCount: record.mediaIds.length - media.length,
    missingAccountCount: record.socialAccountIds.length - accounts.length,
  });
}

export function toPost(resolved: ResolvedPost): Post {
  const { record, media, accounts } = resolved;
  const issues = readinessOf(resolved);
  return {
    id: record.id,
    status: record.status,
    revision: record.revision,
    title: record.title,
    caption: record.caption,
    hashtags: record.hashtags,
    platforms: record.platforms,
    mediaIds: record.mediaIds,
    socialAccountIds: record.socialAccountIds,
    media: media.map((item) => ({
      id: item.id,
      kind: item.kind,
      mimeType: item.mimeType,
      originalName: item.originalName,
      size: item.size,
      width: item.width,
      height: item.height,
      altText: item.altText,
    })),
    socialAccounts: accounts.map((account) => ({
      id: account.id,
      platform: account.platform,
      name: account.name,
      username: account.username,
      status: account.status,
    })),
    source: record.source,
    generationId: record.generationId,
    createdBy: record.createdBy,
    updatedBy: record.updatedBy,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    scheduledAt: record.scheduledAt?.toISOString() ?? null,
    reviewEvents: record.reviewEvents.map((event) => ({
      action: event.action,
      by: event.by,
      at: event.at.toISOString(),
      note: event.note,
    })),
    readiness: { ready: issues.length === 0, issues },
  };
}

const POST_NOT_FOUND = () => new AppError('NOT_FOUND', 'Post not found');
/** The post moved on since it was read. Nothing was changed; the caller must decide again. */
const CHANGED_MEANWHILE = () =>
  new AppError('CONFLICT', 'This post was changed by someone else. Reload it and try again.');
const NOT_EDITABLE = (status: PostStatus) =>
  new AppError(
    'INVALID_TRANSITION',
    status === 'awaiting_approval'
      ? 'This post is awaiting approval. Withdraw it before editing.'
      : `This post is ${POST_STATUS_LABELS[status].toLowerCase()}. Reopen it before editing.`,
  );

export function createPostService({
  workspaces,
  posts,
  media,
  socialAccounts,
  generations,
  now = () => new Date(),
}: {
  workspaces: Pick<WorkspaceService, 'requireAccess'>;
  posts: PostRepository;
  media: Pick<MediaRepository, 'findManyInWorkspace'>;
  socialAccounts: Pick<SocialAccountRepository, 'listForWorkspace'>;
  generations: Pick<AiGenerationRepository, 'findInWorkspace'>;
  now?: () => Date;
}): PostService {
  /** Resolves the references of many posts with one media query and one account query. */
  async function resolve(workspaceId: string, records: PostRecord[]): Promise<ResolvedPost[]> {
    const mediaIds = [...new Set(records.flatMap((record) => record.mediaIds))];
    const needsAccounts = records.some((record) => record.socialAccountIds.length > 0);
    const [items, accounts] = await Promise.all([
      mediaIds.length > 0 ? media.findManyInWorkspace(workspaceId, mediaIds) : [],
      needsAccounts ? socialAccounts.listForWorkspace(workspaceId) : [],
    ]);
    const mediaById = new Map(items.map((item) => [item.id, item]));
    const accountById = new Map(accounts.map((account) => [account.id, account]));
    return records.map((record) => ({
      record,
      media: record.mediaIds.flatMap((id) => mediaById.get(id) ?? []),
      accounts: record.socialAccountIds.flatMap((id) => accountById.get(id) ?? []),
    }));
  }
  const resolveOne = async (workspaceId: string, record: PostRecord) =>
    (await resolve(workspaceId, [record]))[0] as ResolvedPost;

  async function findPost(workspaceId: string, postId: string) {
    const record = await posts.findInWorkspace(workspaceId, postId);
    if (!record) throw POST_NOT_FOUND();
    return record;
  }

  /**
   * After a conditional update matched nothing: says why, from a fresh read. Only explains the
   * failure; the operation is never retried against the newer state.
   */
  async function explainEditFailure(workspaceId: string, postId: string): Promise<AppError> {
    const latest = await posts.findInWorkspace(workspaceId, postId);
    if (!latest) return POST_NOT_FOUND();
    if (!EDITABLE_POST_STATUSES.includes(latest.status)) return NOT_EDITABLE(latest.status);
    return CHANGED_MEANWHILE();
  }

  /**
   * Media and accounts must belong to the workspace, and each account must be on a selected
   * platform. References the post already had are kept even if they no longer exist (they show
   * up as readiness issues), so a disconnected account never blocks saving other changes.
   */
  async function checkContent(workspaceId: string, content: PostContent, previous?: PostContent) {
    const issues: ValidationIssue[] = draftContentIssues(content).map((issue) => ({
      path: `body.${issue.path}`,
      message: issue.message,
    }));

    const addedMedia = content.mediaIds.filter((id) => !previous?.mediaIds.includes(id));
    if (addedMedia.length > 0) {
      const found = new Set(
        (await media.findManyInWorkspace(workspaceId, addedMedia)).map((item) => item.id),
      );
      content.mediaIds.forEach((id, index) => {
        if (addedMedia.includes(id) && !found.has(id)) {
          issues.push({ path: `body.mediaIds.${index}`, message: 'Media not found' });
        }
      });
    }

    if (content.socialAccountIds.length > 0) {
      const accounts = new Map(
        (await socialAccounts.listForWorkspace(workspaceId)).map((account) => [
          account.id,
          account,
        ]),
      );
      content.socialAccountIds.forEach((id, index) => {
        const account = accounts.get(id);
        const path = `body.socialAccountIds.${index}`;
        if (!account) {
          if (!previous?.socialAccountIds.includes(id)) {
            issues.push({ path, message: 'Account not found' });
          }
        } else if (!content.platforms.includes(account.platform)) {
          const label = SOCIAL_PLATFORM_LABELS[account.platform];
          issues.push({ path, message: `Select ${label} to post to this ${label} account` });
        }
      });
    }

    if (issues.length > 0) throw AppError.validation(issues);
  }

  return {
    async create(userId, workspaceId, input) {
      await workspaces.requireAccess(userId, workspaceId);
      // A draft can only point at a generation of the same workspace.
      if (
        input.generationId &&
        !(await generations.findInWorkspace(workspaceId, input.generationId))
      ) {
        throw new AppError('NOT_FOUND', 'AI generation not found');
      }
      const content: PostContent = {
        title: input.title,
        caption: input.caption,
        hashtags: input.hashtags,
        platforms: input.platforms,
        mediaIds: input.mediaIds,
        socialAccountIds: input.socialAccountIds,
      };
      await checkContent(workspaceId, content);
      const record = await posts.create({
        ...content,
        workspaceId,
        source: input.generationId ? 'ai_studio' : 'manual',
        generationId: input.generationId ?? null,
        createdBy: userId,
      });
      return resolveOne(workspaceId, record);
    },

    async list(userId, workspaceId, { limit, ...filters }) {
      await workspaces.requireAccess(userId, workspaceId);
      const page = await posts.list(workspaceId, { ...filters, limit: limit + 1 });
      const records = page.slice(0, limit);
      return {
        posts: await resolve(workspaceId, records),
        nextCursor: page.length > limit ? (records.at(-1)?.id ?? null) : null,
      };
    },

    async get(userId, workspaceId, postId) {
      await workspaces.requireAccess(userId, workspaceId);
      return resolveOne(workspaceId, await findPost(workspaceId, postId));
    },

    async update(userId, workspaceId, postId, { revision, ...changes }) {
      await workspaces.requireAccess(userId, workspaceId);
      const current = await findPost(workspaceId, postId);
      // The form was filled in from `revision`. If the post has moved on, saving it would undo
      // someone else's newer changes: refuse, never merge or retry.
      if (current.revision !== revision) throw CHANGED_MEANWHILE();
      if (!EDITABLE_POST_STATUSES.includes(current.status)) throw NOT_EDITABLE(current.status);
      const defined = Object.fromEntries(
        Object.entries(changes).filter(([, value]) => value !== undefined),
      ) as Partial<PostContent>;
      const merged: PostContent = {
        title: defined.title ?? current.title,
        caption: defined.caption ?? current.caption,
        hashtags: defined.hashtags ?? current.hashtags,
        platforms: defined.platforms ?? current.platforms,
        mediaIds: defined.mediaIds ?? current.mediaIds,
        socialAccountIds: defined.socialAccountIds ?? current.socialAccountIds,
      };
      await checkContent(workspaceId, merged, current);
      // The checks above used `current`, which is at the client's revision: the update applies
      // only if the post is still exactly that version (status and revision), so a concurrent
      // submit or edit landing in between cannot be overwritten.
      const updated = await posts.updateContent(workspaceId, postId, {
        changes: defined,
        whileStatus: EDITABLE_POST_STATUSES,
        expectedRevision: revision,
        by: userId,
      });
      if (!updated) throw await explainEditFailure(workspaceId, postId);
      return resolveOne(workspaceId, updated);
    },

    async duplicate(userId, workspaceId, postId) {
      await workspaces.requireAccess(userId, workspaceId);
      const [source] = await resolve(workspaceId, [await findPost(workspaceId, postId)]);
      if (!source) throw POST_NOT_FOUND();
      const title = `${source.record.title || 'Untitled post'} (copy)`;
      const record = await posts.create({
        workspaceId,
        title:
          title.length > POST_LIMITS.title ? `${title.slice(0, POST_LIMITS.title - 1)}…` : title,
        caption: source.record.caption,
        hashtags: source.record.hashtags,
        platforms: source.record.platforms,
        // Only references that still exist; the files themselves are shared, never copied.
        mediaIds: source.media.map((item) => item.id),
        socialAccountIds: source.accounts.map((account) => account.id),
        source: 'manual',
        generationId: null,
        createdBy: userId,
      });
      return resolveOne(workspaceId, record);
    },

    async remove(userId, workspaceId, postId) {
      const { role } = await workspaces.requireAccess(userId, workspaceId);
      const post = await findPost(workspaceId, postId);
      if (role !== 'owner') {
        if (post.createdBy !== userId || !EDITABLE_POST_STATUSES.includes(post.status)) {
          throw new AppError(
            'PERMISSION_DENIED',
            'Staff can delete only their own posts that are drafts or have changes requested.',
          );
        }
      }
      const removed = await posts.remove(
        workspaceId,
        postId,
        role === 'owner' ? {} : { whileStatus: EDITABLE_POST_STATUSES },
      );
      if (!removed) throw CHANGED_MEANWHILE();
    },

    async workflow(userId, workspaceId, postId, { action, revision, note }) {
      const { role } = await workspaces.requireAccess(userId, workspaceId);
      const rule = WORKFLOW[action];
      const post = await findPost(workspaceId, postId);

      if (rule.ownerOnly && role !== 'owner') {
        throw new AppError(
          'PERMISSION_DENIED',
          'Only the workspace owner can approve posts or request changes.',
        );
      }
      // The caller decided on the version they were shown. If it has moved on (edited, withdrawn,
      // resubmitted by someone else...), their decision is about content that no longer exists.
      if (post.revision !== revision) throw CHANGED_MEANWHILE();
      if (action === 'withdraw' && role !== 'owner') {
        const submitter = post.reviewEvents.findLast((event) => event.action === 'submit')?.by;
        if (submitter !== userId) {
          throw new AppError(
            'PERMISSION_DENIED',
            'Only the person who submitted this post or the owner can withdraw it.',
          );
        }
      }
      if (!rule.from.includes(post.status)) {
        throw new AppError(
          'INVALID_TRANSITION',
          `You can't ${ACTION_VERBS[action]} a post that is ${POST_STATUS_LABELS[post.status].toLowerCase()}.`,
        );
      }
      if (rule.needsReady) {
        const issues = readinessOf(await resolveOne(workspaceId, post));
        if (issues.length > 0) {
          throw new AppError('POST_NOT_READY', 'Fix the issues listed before continuing.', {
            details: issues.map((issue) => ({
              path: [issue.platform ?? 'post', issue.field].join('.'),
              message: issue.message,
            })),
          });
        }
      }

      // Status AND revision are checked in the same update as the change: the submitter, status
      // and content the checks above relied on are exactly the ones being acted on.
      const moved = await posts.transition(workspaceId, postId, {
        from: post.status,
        expectedRevision: post.revision,
        to: rule.to,
        event: { action, by: userId, at: now(), note: note || null },
      });
      if (!moved) {
        throw (await posts.findInWorkspace(workspaceId, postId))
          ? CHANGED_MEANWHILE()
          : POST_NOT_FOUND();
      }
      return resolveOne(workspaceId, moved);
    },
  };
}
