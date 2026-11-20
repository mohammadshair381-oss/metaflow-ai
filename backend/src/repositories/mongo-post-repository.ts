import { isValidObjectId, Types, type FilterQuery } from 'mongoose';
import { PostModel, type PostFields } from '../models/post.model';
import type { PostRecord, PostRepository } from './post-repositories';

type PostDoc = PostFields & { _id: Types.ObjectId; createdAt: Date; updatedAt: Date };

function toRecord(doc: PostDoc): PostRecord {
  return {
    id: doc._id.toString(),
    workspaceId: doc.workspaceId.toString(),
    status: doc.status,
    caption: doc.caption,
    hashtags: [...doc.hashtags],
    platforms: [...doc.platforms],
    source: doc.source,
    generationId: doc.generationId?.toString() ?? null,
    createdBy: doc.createdBy.toString(),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

export function createMongoPostRepository(): PostRepository {
  return {
    async createDraft(draft) {
      const author = new Types.ObjectId(draft.createdBy);
      const created = await PostModel.create({
        workspaceId: new Types.ObjectId(draft.workspaceId),
        status: 'draft',
        caption: draft.caption,
        hashtags: draft.hashtags,
        platforms: draft.platforms,
        source: draft.source,
        generationId: draft.generationId ? new Types.ObjectId(draft.generationId) : null,
        createdBy: author,
        updatedBy: author,
      });
      return toRecord(created.toObject());
    },

    async list(workspaceId, { status, before, limit }) {
      if (!isValidObjectId(workspaceId)) return [];
      const filter: FilterQuery<PostFields> = { workspaceId: new Types.ObjectId(workspaceId) };
      if (status) filter.status = status;
      if (before && isValidObjectId(before)) filter._id = { $lt: new Types.ObjectId(before) };
      const docs = await PostModel.find(filter).sort({ _id: -1 }).limit(limit).lean();
      return docs.map((doc) => toRecord(doc as PostDoc));
    },
  };
}
