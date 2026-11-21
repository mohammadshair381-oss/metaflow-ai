import { z } from 'zod';
import { CAPTION_CHARACTER_LIMITS, HASHTAG_PATTERN, MAX_HASHTAGS_PER_POST } from './ai-studio';
import { MEDIA_KINDS, MEDIA_MIME_TYPES } from './media';
import { SOCIAL_ACCOUNT_STATUSES, SOCIAL_PLATFORMS } from './social-accounts';
import { recordIdSchema } from './workspaces';

/**
 * Post lifecycle. Today a post moves between draft, awaiting approval, changes requested and
 * approved (see POST_WORKFLOW_ACTIONS). Scheduling and publishing states are defined for the
 * publishing milestone; nothing can move a post into them yet.
 */
export const POST_STATUSES = [
  'draft',
  'awaiting_approval',
  'changes_requested',
  'approved',
  'scheduled',
  'publishing',
  'published',
  'failed',
  'cancelled',
] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

export const POST_STATUS_LABELS: Record<PostStatus, string> = {
  draft: 'Draft',
  awaiting_approval: 'Awaiting approval',
  changes_requested: 'Changes requested',
  approved: 'Approved',
  scheduled: 'Scheduled',
  publishing: 'Publishing',
  published: 'Published',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

/** Content can only be edited in these states; others must be withdrawn or reopened first. */
export const EDITABLE_POST_STATUSES: readonly PostStatus[] = ['draft', 'changes_requested'];

export const POST_SOURCES = ['manual', 'ai_studio'] as const;
export type PostSource = (typeof POST_SOURCES)[number];

/**
 * Workflow actions and who may take them (enforced by the server):
 * - submit:          draft | changes_requested -> awaiting_approval   any member
 * - withdraw:        awaiting_approval -> draft                       the submitter or an owner
 * - approve:         awaiting_approval -> approved                    owners only
 * - request_changes: awaiting_approval -> changes_requested           owners only
 * - reopen:          approved -> draft (the approval is cleared)      any member
 */
export const POST_WORKFLOW_ACTIONS = [
  'submit',
  'withdraw',
  'approve',
  'request_changes',
  'reopen',
] as const;
export type PostWorkflowAction = (typeof POST_WORKFLOW_ACTIONS)[number];

export const POST_LIMITS = {
  title: 120,
  media: 10,
  socialAccounts: 20,
  reviewNote: 500,
} as const;

const hashtagSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/^#+/, ''))
  .pipe(z.string().regex(HASHTAG_PATTERN, 'Use letters, numbers and underscores only'));

// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const unique = <T>(values: T[]) => [...new Set(values)];

const fields = {
  /** Internal label, shown only inside MetaFlow AI. */
  title: z
    .string()
    .trim()
    .max(POST_LIMITS.title, `Use at most ${POST_LIMITS.title} characters`)
    .refine((value) => !CONTROL_CHARACTERS.test(value), { error: 'Remove special characters' }),
  caption: z
    .string({ error: 'Write a caption' })
    .trim()
    .max(
      CAPTION_CHARACTER_LIMITS.facebook,
      `Use at most ${CAPTION_CHARACTER_LIMITS.facebook} characters`,
    ),
  platforms: z
    .array(z.enum(SOCIAL_PLATFORMS, { error: 'Choose Facebook or Instagram' }))
    .max(SOCIAL_PLATFORMS.length)
    .transform(unique),
  hashtags: z
    .array(hashtagSchema)
    .max(MAX_HASHTAGS_PER_POST, `Use at most ${MAX_HASHTAGS_PER_POST} hashtags`)
    .transform(unique),
  /** Media library items of the same workspace, in display order. */
  mediaIds: z
    .array(recordIdSchema)
    .max(POST_LIMITS.media, `Attach at most ${POST_LIMITS.media} media items`)
    .transform(unique),
  /** Connected social accounts of the same workspace, on the selected platforms. */
  socialAccountIds: z
    .array(recordIdSchema)
    .max(POST_LIMITS.socialAccounts, `Select at most ${POST_LIMITS.socialAccounts} accounts`)
    .transform(unique),
};

/** Basic draft rules, the same for creating and editing (applied to the merged result). */
export function draftContentIssues(post: {
  title: string;
  caption: string;
  platforms: readonly string[];
  mediaIds: readonly string[];
}): { path: string; message: string }[] {
  const issues: { path: string; message: string }[] = [];
  if (!post.title && !post.caption && post.mediaIds.length === 0) {
    issues.push({ path: 'caption', message: 'Add a title, a caption or media before saving' });
  }
  if (
    post.platforms.includes('instagram') &&
    post.caption.length > CAPTION_CHARACTER_LIMITS.instagram
  ) {
    issues.push({
      path: 'caption',
      message: `Instagram captions can have at most ${CAPTION_CHARACTER_LIMITS.instagram} characters`,
    });
  }
  return issues;
}

/**
 * Strict: the status, author, approval and workspace are set by the server, never by the
 * client. Also used by AI Studio's "Save as draft" (`generationId`).
 */
export const createPostRequestSchema = z
  .strictObject({
    title: fields.title.default(''),
    caption: fields.caption.default(''),
    platforms: fields.platforms.default([]),
    hashtags: fields.hashtags.default([]),
    mediaIds: fields.mediaIds.default([]),
    socialAccountIds: fields.socialAccountIds.default([]),
    /** The AI Studio generation the caption came from, if any. Must belong to the workspace. */
    generationId: recordIdSchema.optional(),
  })
  .superRefine((post, context) => {
    for (const issue of draftContentIssues(post)) {
      context.addIssue({ code: 'custom', path: [issue.path], message: issue.message });
    }
  });
export type CreatePostRequest = z.input<typeof createPostRequestSchema>;
/** The name AI Studio uses. */
export const createDraftRequestSchema = createPostRequestSchema;
export type CreateDraftRequest = CreatePostRequest;

/**
 * Only the content fields that are sent change; the merged post is validated again by the
 * server. `revision` is the revision of the version the editor loaded: the edit applies only if
 * the post is still at exactly that revision (409 CONFLICT otherwise), so a stale form never
 * overwrites someone else's newer changes.
 */
export const updatePostRequestSchema = z
  .strictObject({
    revision: z.number({ error: 'Send the revision of the post you are editing' }).int().min(0),
    title: fields.title.optional(),
    caption: fields.caption.optional(),
    platforms: fields.platforms.optional(),
    hashtags: fields.hashtags.optional(),
    mediaIds: fields.mediaIds.optional(),
    socialAccountIds: fields.socialAccountIds.optional(),
  })
  .refine(
    (value) =>
      Object.entries(value).some(([key, field]) => key !== 'revision' && field !== undefined),
    { error: 'Nothing to update' },
  );
export type UpdatePostRequest = z.input<typeof updatePostRequestSchema>;

export const postWorkflowRequestSchema = z.strictObject({
  action: z.enum(POST_WORKFLOW_ACTIONS, { error: 'Unknown action' }),
  /**
   * The `revision` of the post the user is looking at. The action applies only if the post is
   * still at exactly this revision, so nobody approves (or withdraws) content they have not seen.
   */
  revision: z.number({ error: 'Send the revision of the post you are acting on' }).int().min(0),
  /** For request_changes (and optionally approve): what should change. */
  note: z
    .string()
    .trim()
    .max(POST_LIMITS.reviewNote, `Use at most ${POST_LIMITS.reviewNote} characters`)
    .optional(),
});
export type PostWorkflowRequest = z.input<typeof postWorkflowRequestSchema>;

export const postMediaSummarySchema = z.object({
  id: z.string(),
  kind: z.enum(MEDIA_KINDS),
  mimeType: z.enum(MEDIA_MIME_TYPES),
  originalName: z.string(),
  size: z.number().int(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  altText: z.string(),
});
export type PostMediaSummary = z.infer<typeof postMediaSummarySchema>;

export const postAccountSummarySchema = z.object({
  id: z.string(),
  platform: z.enum(SOCIAL_PLATFORMS),
  name: z.string(),
  username: z.string().nullable(),
  status: z.enum(SOCIAL_ACCOUNT_STATUSES),
});
export type PostAccountSummary = z.infer<typeof postAccountSummarySchema>;

export const POST_REVIEW_EVENT_ACTIONS = POST_WORKFLOW_ACTIONS;
export const postReviewEventSchema = z.object({
  action: z.enum(POST_WORKFLOW_ACTIONS),
  by: z.string(),
  at: z.iso.datetime(),
  note: z.string().nullable(),
});
export type PostReviewEvent = z.infer<typeof postReviewEventSchema>;

export const readinessIssueSchema = z.object({
  /** Null for issues that apply to the whole post. */
  platform: z.enum(SOCIAL_PLATFORMS).nullable(),
  field: z.enum(['platforms', 'socialAccounts', 'caption', 'hashtags', 'media']),
  message: z.string(),
});
export type ReadinessIssue = z.infer<typeof readinessIssueSchema>;

export const postSchema = z.object({
  id: z.string(),
  status: z.enum(POST_STATUSES),
  /**
   * Increases by one with every content edit and every workflow step. Workflow requests send it
   * back; a mismatch answers 409 CONFLICT (optimistic concurrency).
   */
  revision: z.number().int().min(0),
  title: z.string(),
  caption: z.string(),
  hashtags: z.array(z.string()),
  platforms: z.array(z.enum(SOCIAL_PLATFORMS)),
  /** References as stored; `media` and `socialAccounts` list the ones that still exist. */
  mediaIds: z.array(z.string()),
  socialAccountIds: z.array(z.string()),
  media: z.array(postMediaSummarySchema),
  socialAccounts: z.array(postAccountSummarySchema),
  source: z.enum(POST_SOURCES),
  generationId: z.string().nullable(),
  createdBy: z.string(),
  updatedBy: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  /** Reserved for the scheduling milestone; always null today. */
  scheduledAt: z.iso.datetime().nullable(),
  reviewEvents: z.array(postReviewEventSchema),
  /**
   * Checks against the platforms' rules as currently understood. Passing them is needed to
   * submit for approval; it is not a promise that publishing will succeed.
   */
  readiness: z.object({ ready: z.boolean(), issues: z.array(readinessIssueSchema) }),
});
export type Post = z.infer<typeof postSchema>;

export const postResponseSchema = z.object({ post: postSchema });
export type PostResponse = z.infer<typeof postResponseSchema>;

export const POST_PAGE_SIZE = { default: 20, max: 50 } as const;

export const postListQuerySchema = z.object({
  status: z.enum(POST_STATUSES).optional(),
  platform: z.enum(SOCIAL_PLATFORMS).optional(),
  /** Searches the title and caption. */
  q: z.string().trim().max(100).optional(),
  before: recordIdSchema.optional(),
  limit: z.coerce.number().int().min(1).max(POST_PAGE_SIZE.max).default(POST_PAGE_SIZE.default),
});
export type PostListQuery = z.input<typeof postListQuerySchema>;

export const postListResponseSchema = z.object({
  posts: z.array(postSchema),
  nextCursor: z.string().nullable(),
});
export type PostListResponse = z.infer<typeof postListResponseSchema>;
