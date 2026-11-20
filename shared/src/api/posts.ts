import { z } from 'zod';
import { CAPTION_CHARACTER_LIMITS, HASHTAG_PATTERN, MAX_HASHTAGS_PER_POST } from './ai-studio';
import { SOCIAL_PLATFORMS } from './social-accounts';
import { recordIdSchema } from './workspaces';

/**
 * Post lifecycle. Only `draft` exists so far: editing, approval, scheduling and publishing
 * (and the validated transitions between these states) arrive with the content milestone.
 */
export const POST_STATUSES = [
  'draft',
  'awaiting_approval',
  'approved',
  'scheduled',
  'publishing',
  'published',
  'failed',
  'cancelled',
] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

export const POST_SOURCES = ['manual', 'ai_studio'] as const;
export type PostSource = (typeof POST_SOURCES)[number];

const hashtagSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/^#+/, ''))
  .pipe(z.string().regex(HASHTAG_PATTERN, 'Use letters, numbers and underscores only'));

/** Strict: the status, author and workspace are set by the server, never by the client. */
export const createDraftRequestSchema = z
  .strictObject({
    caption: z
      .string({ error: 'Write a caption' })
      .trim()
      .min(1, 'Write a caption')
      .max(
        CAPTION_CHARACTER_LIMITS.facebook,
        `Use at most ${CAPTION_CHARACTER_LIMITS.facebook} characters`,
      ),
    platforms: z
      .array(z.enum(SOCIAL_PLATFORMS, { error: 'Choose Facebook or Instagram' }))
      .max(SOCIAL_PLATFORMS.length)
      .default([])
      .transform((platforms) => [...new Set(platforms)]),
    hashtags: z
      .array(hashtagSchema)
      .max(MAX_HASHTAGS_PER_POST, `Use at most ${MAX_HASHTAGS_PER_POST} hashtags`)
      .default([])
      .transform((tags) => [...new Set(tags)]),
    /** The AI Studio generation the caption came from, if any. Must belong to the workspace. */
    generationId: recordIdSchema.optional(),
  })
  .superRefine((draft, context) => {
    if (
      draft.platforms.includes('instagram') &&
      draft.caption.length > CAPTION_CHARACTER_LIMITS.instagram
    ) {
      context.addIssue({
        code: 'custom',
        path: ['caption'],
        message: `Instagram captions can have at most ${CAPTION_CHARACTER_LIMITS.instagram} characters`,
      });
    }
  });
export type CreateDraftRequest = z.input<typeof createDraftRequestSchema>;

export const postSchema = z.object({
  id: z.string(),
  status: z.enum(POST_STATUSES),
  caption: z.string(),
  hashtags: z.array(z.string()),
  platforms: z.array(z.enum(SOCIAL_PLATFORMS)),
  source: z.enum(POST_SOURCES),
  generationId: z.string().nullable(),
  createdBy: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Post = z.infer<typeof postSchema>;

export const postResponseSchema = z.object({ post: postSchema });

export const POST_PAGE_SIZE = { default: 20, max: 50 } as const;

export const postListQuerySchema = z.object({
  status: z.enum(POST_STATUSES).optional(),
  before: recordIdSchema.optional(),
  limit: z.coerce.number().int().min(1).max(POST_PAGE_SIZE.max).default(POST_PAGE_SIZE.default),
});

export const postListResponseSchema = z.object({
  posts: z.array(postSchema),
  nextCursor: z.string().nullable(),
});
export type PostListResponse = z.infer<typeof postListResponseSchema>;
