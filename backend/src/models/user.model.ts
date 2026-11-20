import { ACCOUNT_STATUSES, EMAIL_MAX_LENGTH, NAME_MAX_LENGTH } from '@metaflow/shared';
import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: NAME_MAX_LENGTH },
    /** Stored normalized (trimmed, lower-case); the unique index makes each address register once. */
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: EMAIL_MAX_LENGTH,
    },
    /** scrypt hash. Never selected by default, never serialized. */
    passwordHash: { type: String, required: true, select: false },
    status: { type: String, enum: ACCOUNT_STATUSES, required: true, default: 'active' },
    /** Set when the address is verified. No verification flow exists yet. */
    emailVerifiedAt: { type: Date, default: null },
  },
  { collection: 'users', timestamps: true },
);

userSchema.index({ email: 1 }, { unique: true, name: 'users_email_unique' });

// Defence in depth: even a document loaded with the hash cannot serialize it.
userSchema.set('toJSON', {
  transform: (_doc, ret: Record<string, unknown>) => {
    delete ret.passwordHash;
    delete ret.__v;
    return ret;
  },
});

export type UserFields = InferSchemaType<typeof userSchema>;

export const UserModel: Model<UserFields> =
  (mongoose.models.User as Model<UserFields> | undefined) ??
  mongoose.model<UserFields>('User', userSchema);
