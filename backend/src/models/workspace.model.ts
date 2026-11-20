import {
  BUSINESS_CATEGORIES,
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
