import { MEDIA_KINDS, MEDIA_MIME_TYPES, MEDIA_TEXT_LIMITS } from '@metaflow/shared';
import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

/**
 * One file in a workspace's media library. The bytes live in media storage under
 * `storageKey`; this record is the only way to reach them, and only through the media API.
 */
const mediaSchema = new Schema(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
    kind: { type: String, enum: MEDIA_KINDS, required: true },
    /** Detected from the file's content, never taken from the browser. */
    mimeType: { type: String, enum: MEDIA_MIME_TYPES, required: true },
    /** Cleaned display name; never used to locate the file. */
    originalName: {
      type: String,
      required: true,
      trim: true,
      maxlength: MEDIA_TEXT_LIMITS.filename,
    },
    /** Opaque, server-generated key. Never sent to clients. */
    storageKey: { type: String, required: true },
    size: { type: Number, required: true, min: 1 },
    width: { type: Number, default: null },
    height: { type: Number, default: null },
    durationSeconds: { type: Number, default: null },
    altText: { type: String, trim: true, default: '', maxlength: MEDIA_TEXT_LIMITS.altText },
    description: {
      type: String,
      trim: true,
      default: '',
      maxlength: MEDIA_TEXT_LIMITS.description,
    },
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { collection: 'media', timestamps: true },
);

mediaSchema.index({ workspaceId: 1, _id: -1 }, { name: 'media_workspace_recent' });
mediaSchema.index({ workspaceId: 1, kind: 1, _id: -1 }, { name: 'media_workspace_kind_recent' });
mediaSchema.index({ storageKey: 1 }, { unique: true, name: 'media_storage_key_unique' });

export type MediaFields = InferSchemaType<typeof mediaSchema>;

export const MediaModel: Model<MediaFields> =
  (mongoose.models.Media as Model<MediaFields> | undefined) ??
  mongoose.model<MediaFields>('Media', mediaSchema);
