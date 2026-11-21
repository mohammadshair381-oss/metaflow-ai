import {
  CAPTION_CHARACTER_LIMITS,
  MAX_HASHTAGS_PER_POST,
  POST_LIMITS,
  POST_SOURCES,
  POST_STATUSES,
  POST_WORKFLOW_ACTIONS,
  SOCIAL_PLATFORMS,
} from '@metaflow/shared';
import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

const maxItems = (limit: number) => ({
  validator: (items: unknown[]) => items.length <= limit,
  message: `At most ${limit} items`,
});

/** One step of the approval workflow: who did what, when. Append-only. */
const reviewEventSchema = new Schema(
  {
    action: { type: String, enum: POST_WORKFLOW_ACTIONS, required: true },
    by: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    at: { type: Date, required: true },
    note: { type: String, default: null, maxlength: POST_LIMITS.reviewNote },
  },
  { _id: false },
);

/**
 * A post in a workspace: its content (title, caption, hashtags), the media library items and
 * connected accounts it uses, and its place in the approval workflow. Edits and status changes
 * go through the post service, which checks the expected status and revision in the same
 * update (compare-and-set).
 * Scheduling and publishing extend this model in later milestones.
 */
const postSchema = new Schema(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
    status: { type: String, enum: POST_STATUSES, required: true, default: 'draft' },
    /**
     * Optimistic-concurrency counter: +1 on every content edit and workflow step, and every such
     * update is conditional on the revision the caller read. Posts saved before this field
     * existed have none; they read as revision 0 and get 1 on their first change.
     */
    revision: { type: Number, default: 0, min: 0 },
    /** Internal label; never published. */
    title: { type: String, trim: true, default: '', maxlength: POST_LIMITS.title },
    caption: { type: String, default: '', maxlength: CAPTION_CHARACTER_LIMITS.facebook },
    hashtags: { type: [String], default: [], validate: maxItems(MAX_HASHTAGS_PER_POST) },
    platforms: { type: [{ type: String, enum: SOCIAL_PLATFORMS }], default: [] },
    /** Media library items of the same workspace, in display order. */
    mediaIds: {
      type: [{ type: Schema.Types.ObjectId, ref: 'Media' }],
      default: [],
      validate: maxItems(POST_LIMITS.media),
    },
    /** Connected social accounts of the same workspace. */
    socialAccountIds: {
      type: [{ type: Schema.Types.ObjectId, ref: 'SocialAccount' }],
      default: [],
      validate: maxItems(POST_LIMITS.socialAccounts),
    },
    source: { type: String, enum: POST_SOURCES, required: true, default: 'manual' },
    /** The AI Studio generation the caption came from (same workspace), if any. */
    generationId: { type: Schema.Types.ObjectId, ref: 'AiGeneration', default: null },
    reviewEvents: { type: [reviewEventSchema], default: [] },
    /** Reserved for the scheduling milestone. */
    scheduledAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { collection: 'posts', timestamps: true },
);

postSchema.index({ workspaceId: 1, _id: -1 }, { name: 'posts_workspace_recent' });
postSchema.index({ workspaceId: 1, status: 1, _id: -1 }, { name: 'posts_workspace_status_recent' });
/** "Is this media item still used?" before a media item is deleted. */
postSchema.index({ workspaceId: 1, mediaIds: 1 }, { name: 'posts_workspace_media' });

export type PostFields = InferSchemaType<typeof postSchema>;

export const PostModel: Model<PostFields> =
  (mongoose.models.Post as Model<PostFields> | undefined) ??
  mongoose.model<PostFields>('Post', postSchema);
