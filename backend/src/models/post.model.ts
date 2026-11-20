import {
  CAPTION_CHARACTER_LIMITS,
  MAX_HASHTAGS_PER_POST,
  POST_SOURCES,
  POST_STATUSES,
  SOCIAL_PLATFORMS,
} from '@metaflow/shared';
import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

/**
 * A post in a workspace. The foundation of the content milestone: today only drafts are
 * created (from AI Studio). Media, destination accounts, approval, scheduling and the
 * validated status transitions extend this model; they do not replace it.
 */
const postSchema = new Schema(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
    status: { type: String, enum: POST_STATUSES, required: true, default: 'draft' },
    caption: { type: String, required: true, maxlength: CAPTION_CHARACTER_LIMITS.facebook },
    hashtags: {
      type: [String],
      default: [],
      validate: {
        validator: (tags: string[]) => tags.length <= MAX_HASHTAGS_PER_POST,
        message: `At most ${MAX_HASHTAGS_PER_POST} hashtags`,
      },
    },
    platforms: { type: [{ type: String, enum: SOCIAL_PLATFORMS }], default: [] },
    source: { type: String, enum: POST_SOURCES, required: true, default: 'manual' },
    /** The AI Studio generation the caption came from (same workspace), if any. */
    generationId: { type: Schema.Types.ObjectId, ref: 'AiGeneration', default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { collection: 'posts', timestamps: true },
);

postSchema.index({ workspaceId: 1, _id: -1 }, { name: 'posts_workspace_recent' });
postSchema.index({ workspaceId: 1, status: 1, _id: -1 }, { name: 'posts_workspace_status_recent' });

export type PostFields = InferSchemaType<typeof postSchema>;

export const PostModel: Model<PostFields> =
  (mongoose.models.Post as Model<PostFields> | undefined) ??
  mongoose.model<PostFields>('Post', postSchema);
