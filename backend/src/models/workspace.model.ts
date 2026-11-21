import {
  BRAND_VOICE_LIMITS,
  BUSINESS_CATEGORIES,
  CONTENT_TONES,
  EMOJI_PREFERENCES,
  DEFAULT_WORKSPACE_LANGUAGE,
  DEFAULT_WORKSPACE_TIMEZONE,
  WORKSPACE_DESCRIPTION_MAX_LENGTH,
  WORKSPACE_LANGUAGES,
  WORKSPACE_NAME_MAX_LENGTH,
  WORKSPACE_ROLES,
  WORKSPACE_STATUSES,
  isValidTimeZone,
} from '@metaflow/shared';
import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

const phraseList = {
  type: [{ type: String, trim: true, maxlength: BRAND_VOICE_LIMITS.phraseLength }],
  default: [],
  validate: {
    validator: (phrases: string[]) => phrases.length <= BRAND_VOICE_LIMITS.phrases,
    message: `At most ${BRAND_VOICE_LIMITS.phrases} entries`,
  },
};

/**
 * How the workspace's content should sound. Embedded in the workspace (one per workspace,
 * read together with it). "About the business" and the content language are the workspace's
 * own `description` and `defaultLanguage`, not duplicated here.
 */
const brandVoiceSchema = new Schema(
  {
    targetAudience: {
      type: String,
      trim: true,
      default: '',
      maxlength: BRAND_VOICE_LIMITS.targetAudience,
    },
    tone: { type: String, enum: CONTENT_TONES.map((tone) => tone.value), required: true },
    personality: {
      type: String,
      trim: true,
      default: '',
      maxlength: BRAND_VOICE_LIMITS.personality,
    },
    writingStyle: {
      type: String,
      trim: true,
      default: '',
      maxlength: BRAND_VOICE_LIMITS.writingStyle,
    },
    wordsToUse: phraseList,
    wordsToAvoid: phraseList,
    emojiPreference: {
      type: String,
      enum: EMOJI_PREFERENCES.map((option) => option.value),
      required: true,
    },
    additionalInstructions: {
      type: String,
      trim: true,
      default: '',
      maxlength: BRAND_VOICE_LIMITS.additionalInstructions,
    },
    updatedAt: { type: Date, required: true },
  },
  { _id: false },
);

const workspaceSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: WORKSPACE_NAME_MAX_LENGTH },
    description: {
      type: String,
      trim: true,
      default: '',
      maxlength: WORKSPACE_DESCRIPTION_MAX_LENGTH,
    },
    category: {
      type: String,
      enum: BUSINESS_CATEGORIES.map((category) => category.value),
      required: true,
      default: 'other',
    },
    /** IANA time zone used to display and schedule this workspace's content. */
    timezone: {
      type: String,
      required: true,
      default: DEFAULT_WORKSPACE_TIMEZONE,
      validate: { validator: isValidTimeZone, message: 'Unknown time zone' },
    },
    defaultLanguage: {
      type: String,
      enum: WORKSPACE_LANGUAGES.map((language) => language.value),
      required: true,
      default: DEFAULT_WORKSPACE_LANGUAGE,
    },
    /** Archived workspaces are hidden and read-only; their data is kept. */
    status: { type: String, enum: WORKSPACE_STATUSES, required: true, default: 'active' },
    archivedAt: { type: Date, default: null },
    /** Who created it (audit only). Access is decided by memberships, never by this field. */
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    /** Null until the brand voice is saved for the first time. */
    brandVoice: { type: brandVoiceSchema, default: null },
    /** An image from the workspace's own media library, set by the owner. */
    logoMediaId: { type: Schema.Types.ObjectId, ref: 'Media', default: null },
  },
  { collection: 'workspaces', timestamps: true },
);

export type WorkspaceFields = InferSchemaType<typeof workspaceSchema>;

export const WorkspaceModel: Model<WorkspaceFields> =
  (mongoose.models.Workspace as Model<WorkspaceFields> | undefined) ??
  mongoose.model<WorkspaceFields>('Workspace', workspaceSchema);

/** One user's role in one workspace. The only source of truth for workspace access. */
const workspaceMembershipSchema = new Schema(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: WORKSPACE_ROLES, required: true },
  },
  { collection: 'workspace_memberships', timestamps: true },
);

workspaceMembershipSchema.index(
  { workspaceId: 1, userId: 1 },
  { unique: true, name: 'memberships_workspace_user_unique' },
);
workspaceMembershipSchema.index({ userId: 1, role: 1 }, { name: 'memberships_user_role' });

export type WorkspaceMembershipFields = InferSchemaType<typeof workspaceMembershipSchema>;

export const WorkspaceMembershipModel: Model<WorkspaceMembershipFields> =
  (mongoose.models.WorkspaceMembership as Model<WorkspaceMembershipFields> | undefined) ??
  mongoose.model<WorkspaceMembershipFields>('WorkspaceMembership', workspaceMembershipSchema);
