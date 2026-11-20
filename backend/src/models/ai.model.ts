import { AI_FEATURES, AI_PROVIDERS } from '@metaflow/shared';
import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

const tokenCount = { type: Number, default: null, min: 0 };

/**
 * One successful AI Studio generation: the settings it used (the form fields, after brand
 * voice defaults) and what the AI returned. The compiled prompt is never stored.
 */
const aiGenerationSchema = new Schema(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    feature: { type: String, enum: AI_FEATURES, required: true },
    /** Validated against the shared feature schemas before it is written. */
    settings: { type: Schema.Types.Mixed, required: true },
    output: { type: Schema.Types.Mixed, required: true },
    provider: { type: String, enum: AI_PROVIDERS, required: true },
    /** The model that answered. */
    model: { type: String, required: true, maxlength: 100 },
    usage: {
      inputTokens: tokenCount,
      outputTokens: tokenCount,
      totalTokens: tokenCount,
      estimatedCostUsd: { type: Number, default: null, min: 0 },
    },
  },
  { collection: 'ai_generations', timestamps: { createdAt: true, updatedAt: false } },
);

// Newest first per workspace; the ID doubles as the pagination cursor.
aiGenerationSchema.index({ workspaceId: 1, _id: -1 }, { name: 'ai_generations_workspace_recent' });
aiGenerationSchema.index(
  { workspaceId: 1, feature: 1, _id: -1 },
  { name: 'ai_generations_workspace_feature_recent' },
);

export type AiGenerationFields = InferSchemaType<typeof aiGenerationSchema>;

export const AiGenerationModel: Model<AiGenerationFields> =
  (mongoose.models.AiGeneration as Model<AiGenerationFields> | undefined) ??
  mongoose.model<AiGenerationFields>('AiGeneration', aiGenerationSchema);

export const AI_USAGE_STATUSES = ['succeeded', 'failed'] as const;

/**
 * Every AI request, successful or not, for usage reporting and future plan limits. Holds no
 * prompt and no output. Token counts and cost are null when unknown, never zero.
 */
const aiUsageSchema = new Schema(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    feature: { type: String, enum: AI_FEATURES, required: true },
    provider: { type: String, enum: AI_PROVIDERS, required: true },
    /** The configured model. */
    model: { type: String, required: true, maxlength: 100 },
    /** The model that answered, when the provider reported one. */
    servedModel: { type: String, default: null, maxlength: 100 },
    status: { type: String, enum: AI_USAGE_STATUSES, required: true },
    /** For failures: what went wrong (AiErrorKind). */
    errorKind: { type: String, default: null, maxlength: 40 },
    inputTokens: tokenCount,
    outputTokens: tokenCount,
    totalTokens: tokenCount,
    estimatedCostUsd: { type: Number, default: null, min: 0 },
    latencyMs: { type: Number, required: true, min: 0 },
  },
  { collection: 'ai_usage', timestamps: { createdAt: true, updatedAt: false } },
);

aiUsageSchema.index({ workspaceId: 1, createdAt: -1 }, { name: 'ai_usage_workspace_time' });

export type AiUsageFields = InferSchemaType<typeof aiUsageSchema>;

export const AiUsageModel: Model<AiUsageFields> =
  (mongoose.models.AiUsage as Model<AiUsageFields> | undefined) ??
  mongoose.model<AiUsageFields>('AiUsage', aiUsageSchema);
