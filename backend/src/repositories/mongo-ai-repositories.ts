import {
  captionOutputSchema,
  captionSettingsSchema,
  hashtagOutputSchema,
  hashtagSettingsSchema,
  ideasOutputSchema,
  ideasSettingsSchema,
} from '@metaflow/shared';
import { isValidObjectId, Types, type FilterQuery } from 'mongoose';
import { AiGenerationModel, AiUsageModel, type AiGenerationFields } from '../models/ai.model';
import type {
  AiGenerationRecord,
  AiRepositories,
  AiUsageTotals,
  GenerationContent,
} from './ai-repositories';

type GenerationDoc = AiGenerationFields & { _id: Types.ObjectId; createdAt: Date };

/** Stored content is re-validated on the way out, so the API never returns malformed history. */
function toContent(doc: GenerationDoc): GenerationContent | null {
  switch (doc.feature) {
    case 'caption': {
      const settings = captionSettingsSchema.safeParse(doc.settings);
      const output = captionOutputSchema.safeParse(doc.output);
      return settings.success && output.success
        ? { feature: 'caption', settings: settings.data, output: output.data }
        : null;
    }
    case 'hashtags': {
      const settings = hashtagSettingsSchema.safeParse(doc.settings);
      const output = hashtagOutputSchema.safeParse(doc.output);
      return settings.success && output.success
        ? { feature: 'hashtags', settings: settings.data, output: output.data }
        : null;
    }
    case 'ideas': {
      const settings = ideasSettingsSchema.safeParse(doc.settings);
      const output = ideasOutputSchema.safeParse(doc.output);
      return settings.success && output.success
        ? { feature: 'ideas', settings: settings.data, output: output.data }
        : null;
    }
  }
}

function toRecord(doc: GenerationDoc): AiGenerationRecord | null {
  const content = toContent(doc);
  if (!content) return null;
  return {
    ...content,
    id: doc._id.toString(),
    workspaceId: doc.workspaceId.toString(),
    userId: doc.userId.toString(),
    provider: doc.provider,
    model: doc.model,
    usage: {
      inputTokens: doc.usage?.inputTokens ?? null,
      outputTokens: doc.usage?.outputTokens ?? null,
      totalTokens: doc.usage?.totalTokens ?? null,
      estimatedCostUsd: doc.usage?.estimatedCostUsd ?? null,
    },
    createdAt: doc.createdAt,
  };
}

export function createMongoAiRepositories(): AiRepositories {
  return {
    generations: {
      async create(generation) {
        const created = await AiGenerationModel.create({
          ...generation,
          workspaceId: new Types.ObjectId(generation.workspaceId),
          userId: new Types.ObjectId(generation.userId),
        });
        const record = toRecord(created.toObject());
        if (!record) throw new Error('Stored generation failed validation');
        return record;
      },

      async list(workspaceId, { feature, before, limit }) {
        if (!isValidObjectId(workspaceId)) return [];
        const filter: FilterQuery<AiGenerationFields> = {
          workspaceId: new Types.ObjectId(workspaceId),
        };
        if (feature) filter.feature = feature;
        if (before && isValidObjectId(before)) filter._id = { $lt: new Types.ObjectId(before) };
        const docs = await AiGenerationModel.find(filter).sort({ _id: -1 }).limit(limit).lean();
        return docs.flatMap((doc) => toRecord(doc as GenerationDoc) ?? []);
      },

      async findInWorkspace(workspaceId, generationId) {
        if (!isValidObjectId(workspaceId) || !isValidObjectId(generationId)) return null;
        const doc = await AiGenerationModel.findOne({
          _id: new Types.ObjectId(generationId),
          workspaceId: new Types.ObjectId(workspaceId),
        }).lean();
        return doc ? toRecord(doc) : null;
      },
    },

    usage: {
      async record(entry) {
        await AiUsageModel.create({
          ...entry,
          workspaceId: new Types.ObjectId(entry.workspaceId),
          userId: new Types.ObjectId(entry.userId),
        });
      },

      async summarize(workspaceId, from, to): Promise<AiUsageTotals> {
        const empty: AiUsageTotals = {
          requests: 0,
          succeeded: 0,
          failed: 0,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          requestsWithoutTokenData: 0,
          estimatedCostUsd: null,
          requestsWithoutCost: 0,
        };
        if (!isValidObjectId(workspaceId)) return empty;
        const isNull = (field: string) => ({
          $cond: [{ $eq: [{ $ifNull: [field, null] }, null] }, 1, 0],
        });
        const [totals] = await AiUsageModel.aggregate<{
          requests: number;
          succeeded: number;
          failed: number;
          inputTokens: number;
          outputTokens: number;
          totalTokens: number;
          requestsWithoutTokenData: number;
          estimatedCostUsd: number;
          requestsWithCost: number;
          requestsWithoutCost: number;
        }>([
          {
            $match: {
              workspaceId: new Types.ObjectId(workspaceId),
              createdAt: { $gte: from, $lt: to },
            },
          },
          {
            $group: {
              _id: null,
              requests: { $sum: 1 },
              succeeded: { $sum: { $cond: [{ $eq: ['$status', 'succeeded'] }, 1, 0] } },
              failed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
              // $sum ignores nulls, so unknown counts never become zeros in the totals.
              inputTokens: { $sum: '$inputTokens' },
              outputTokens: { $sum: '$outputTokens' },
              totalTokens: { $sum: '$totalTokens' },
              requestsWithoutTokenData: { $sum: isNull('$totalTokens') },
              estimatedCostUsd: { $sum: '$estimatedCostUsd' },
              requestsWithoutCost: { $sum: isNull('$estimatedCostUsd') },
              requestsWithCost: {
                $sum: { $cond: [{ $eq: [{ $ifNull: ['$estimatedCostUsd', null] }, null] }, 0, 1] },
              },
            },
          },
        ]);
        if (!totals) return empty;
        return {
          requests: totals.requests,
          succeeded: totals.succeeded,
          failed: totals.failed,
          inputTokens: totals.inputTokens,
          outputTokens: totals.outputTokens,
          totalTokens: totals.totalTokens,
          requestsWithoutTokenData: totals.requestsWithoutTokenData,
          estimatedCostUsd: totals.requestsWithCost > 0 ? totals.estimatedCostUsd : null,
          requestsWithoutCost: totals.requestsWithoutCost,
        };
      },
    },
  };
}
