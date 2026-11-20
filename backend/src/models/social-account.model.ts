import {
  SOCIAL_ACCOUNT_ISSUES,
  SOCIAL_ACCOUNT_STATUSES,
  SOCIAL_ACCOUNT_TYPES,
  SOCIAL_PLATFORMS,
} from '@metaflow/shared';
import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

/** A Facebook Page or Instagram professional account connected to one workspace. */
const socialAccountSchema = new Schema(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
    platform: { type: String, enum: SOCIAL_PLATFORMS, required: true },
    /** The Page ID or Instagram account ID on Meta. */
    externalId: { type: String, required: true, maxlength: 64 },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    username: { type: String, default: null, maxlength: 200 },
    accountType: { type: String, enum: SOCIAL_ACCOUNT_TYPES, required: true },
    profileImageUrl: { type: String, default: null, maxlength: 2048 },
    status: { type: String, enum: SOCIAL_ACCOUNT_STATUSES, required: true, default: 'connected' },
    issue: { type: String, enum: [...SOCIAL_ACCOUNT_ISSUES, null], default: null },
    grantedPermissions: { type: [String], default: [] },
    missingPermissions: { type: [String], default: [] },
    /**
     * The access token, encrypted with AES-256-GCM (utils/secret-box.ts). Never plaintext,
     * never selected by default, never serialized.
     */
    encryptedToken: {
      type: String,
      required: true,
      select: false,
      match: /^v1\.[a-f0-9]{8}\.[\w-]+\.[\w-]+\.[\w-]+$/,
    },
    /** Null when the token has no fixed expiry (Page tokens). */
    tokenExpiresAt: { type: Date, default: null },
    /** For Instagram accounts: the Facebook Page they are linked to. */
    linkedPageId: { type: String, default: null, maxlength: 64 },
    connectedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    connectedAt: { type: Date, required: true },
    lastSyncedAt: { type: Date, default: null },
  },
  { collection: 'social_accounts', timestamps: true },
);

// One connection per external account in a workspace; also serves "accounts of a workspace".
socialAccountSchema.index(
  { workspaceId: 1, platform: 1, externalId: 1 },
  { unique: true, name: 'social_accounts_workspace_platform_external_unique' },
);

socialAccountSchema.set('toJSON', {
  transform: (_doc, ret: Record<string, unknown>) => {
    delete ret.encryptedToken;
    delete ret.__v;
    return ret;
  },
});

export type SocialAccountFields = InferSchemaType<typeof socialAccountSchema>;

export const SocialAccountModel: Model<SocialAccountFields> =
  (mongoose.models.SocialAccount as Model<SocialAccountFields> | undefined) ??
  mongoose.model<SocialAccountFields>('SocialAccount', socialAccountSchema);

/** A pending "connect account" authorization. Single-use and short-lived. */
const oauthStateSchema = new Schema(
  {
    /** SHA-256 (hex) of the `state` value sent to Meta. The raw value is never stored. */
    stateHash: { type: String, required: true, match: /^[a-f0-9]{64}$/ },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
    platform: { type: String, enum: SOCIAL_PLATFORMS, required: true },
    expiresAt: { type: Date, required: true },
    consumedAt: { type: Date, default: null },
  },
  { collection: 'oauth_states', timestamps: { createdAt: true, updatedAt: false } },
);

oauthStateSchema.index({ stateHash: 1 }, { unique: true, name: 'oauth_states_hash_unique' });
oauthStateSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'oauth_states_ttl' });

export type OAuthStateFields = InferSchemaType<typeof oauthStateSchema>;

export const OAuthStateModel: Model<OAuthStateFields> =
  (mongoose.models.OAuthState as Model<OAuthStateFields> | undefined) ??
  mongoose.model<OAuthStateFields>('OAuthState', oauthStateSchema);
