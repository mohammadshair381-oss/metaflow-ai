import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

export const SESSION_REVOKE_REASONS = ['logout', 'logout_all', 'replaced'] as const;
export type SessionRevokeReason = (typeof SESSION_REVOKE_REASONS)[number];

const sessionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    /** SHA-256 (hex) of the opaque token. The raw token is never stored. */
    tokenHash: { type: String, required: true, match: /^[a-f0-9]{64}$/ },
    /** Absolute expiry. MongoDB's TTL monitor deletes the document after this time. */
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    revokedReason: { type: String, enum: SESSION_REVOKE_REASONS, default: null },
  },
  { collection: 'sessions', timestamps: { createdAt: true, updatedAt: false } },
);

sessionSchema.index({ tokenHash: 1 }, { unique: true, name: 'sessions_token_hash_unique' });
sessionSchema.index({ userId: 1, revokedAt: 1 }, { name: 'sessions_user_revoked' });
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'sessions_expires_ttl' });

export type SessionFields = InferSchemaType<typeof sessionSchema>;

export const SessionModel: Model<SessionFields> =
  (mongoose.models.Session as Model<SessionFields> | undefined) ??
  mongoose.model<SessionFields>('Session', sessionSchema);
