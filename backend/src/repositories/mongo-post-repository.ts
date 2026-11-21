import { isValidObjectId, Types, type FilterQuery } from 'mongoose';
import { PostModel, type PostFields } from '../models/post.model';
import { escapeRegex } from './mongo-media-repository';
import type { PostContent, PostRecord, PostRepository } from './post-repositories';

type PostDoc = PostFields & { _id: Types.ObjectId; createdAt: Date; updatedAt: Date };
const ids = (values: readonly string[]) => values.map((value) => new Types.ObjectId(value));

/** Posts saved before the content milestone lack the newer fields; they read as empty. */
function toRecord(doc: PostDoc): PostRecord {
  return {
    id: doc._id.toString(),
    workspaceId: doc.workspaceId.toString(),
    status: doc.status,
    revision: doc.revision ?? 0,
    title: doc.title ?? '',
    caption: doc.caption ?? '',
    hashtags: [...(doc.hashtags ?? [])],
    platforms: [...(doc.platforms ?? [])],
    mediaIds: (doc.mediaIds ?? []).map((id) => id.toString()),
    socialAccountIds: (doc.socialAccountIds ?? []).map((id) => id.toString()),
    source: doc.source,
    generationId: doc.generationId?.toString() ?? null,
    reviewEvents: (doc.reviewEvents ?? []).map((event) => ({
      action: event.action,
      by: event.by.toString(),
      at: event.at,
      note: event.note ?? null,
    })),
    scheduledAt: doc.scheduledAt ?? null,
    createdBy: doc.createdBy.toString(),
    updatedBy: (doc.updatedBy ?? doc.createdBy).toString(),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function toFields(changes: Partial<PostContent>): Record<string, unknown> {
  const fields: Record<string, unknown> = { ...changes };
  if (changes.mediaIds) fields.mediaIds = ids(changes.mediaIds);
  if (changes.socialAccountIds) fields.socialAccountIds = ids(changes.socialAccountIds);
  return fields;
}

const validIds = (...values: string[]) => values.every((value) => isValidObjectId(value));
/**
 * Matches a post at `revision`. Posts saved before revisions existed have no field and count
 * as revision 0 (`null` also matches a missing field); `$inc` creates it as 1 on their first
 * change, so no migration is needed.
 */
const atRevision = (revision: number) => (revision === 0 ? { $in: [0, null] } : revision);
const scoped = (workspaceId: string, postId: string) => ({
  _id: new Types.ObjectId(postId),
  workspaceId: new Types.ObjectId(workspaceId),
});

export function createMongoPostRepository(): PostRepository {
  return {
    async create(post) {
      const author = new Types.ObjectId(post.createdBy);
      const created = await PostModel.create({
        ...toFields(post),
        workspaceId: new Types.ObjectId(post.workspaceId),
        status: 'draft',
        source: post.source,
        generationId: post.generationId ? new Types.ObjectId(post.generationId) : null,
        createdBy: author,
        updatedBy: author,
      });
      return toRecord(created.toObject());
    },

    async findInWorkspace(workspaceId, postId) {
      if (!validIds(workspaceId, postId)) return null;
      const doc = await PostModel.findOne(scoped(workspaceId, postId)).lean();
      return doc ? toRecord(doc) : null;
    },

    async list(workspaceId, { status, platform, q, before, limit }) {
      if (!isValidObjectId(workspaceId)) return [];
      const filter: FilterQuery<PostFields> = { workspaceId: new Types.ObjectId(workspaceId) };
      if (status) filter.status = status;
      if (platform) filter.platforms = platform;
      if (before && isValidObjectId(before)) filter._id = { $lt: new Types.ObjectId(before) };
      if (q) {
        const pattern = new RegExp(escapeRegex(q), 'i');
        filter.$or = [{ title: pattern }, { caption: pattern }];
      }
      const docs = await PostModel.find(filter).sort({ _id: -1 }).limit(limit).lean();
      return docs.map((doc) => toRecord(doc as PostDoc));
    },

    async updateContent(workspaceId, postId, { changes, whileStatus, expectedRevision, by }) {
      if (!validIds(workspaceId, postId)) return null;
      const doc = await PostModel.findOneAndUpdate(
        {
          ...scoped(workspaceId, postId),
          status: { $in: whileStatus },
          revision: atRevision(expectedRevision),
        },
        {
          $set: { ...toFields(changes), updatedBy: new Types.ObjectId(by) },
          $inc: { revision: 1 },
        },
        { new: true, runValidators: true },
      ).lean();
      return doc ? toRecord(doc) : null;
    },

    async transition(workspaceId, postId, { from, expectedRevision, to, event }) {
      if (!validIds(workspaceId, postId)) return null;
      const by = new Types.ObjectId(event.by);
      const doc = await PostModel.findOneAndUpdate(
        { ...scoped(workspaceId, postId), status: from, revision: atRevision(expectedRevision) },
        {
          $set: { status: to, updatedBy: by },
          $push: { reviewEvents: { ...event, by } },
          $inc: { revision: 1 },
        },
        { new: true, runValidators: true },
      ).lean();
      return doc ? toRecord(doc) : null;
    },

    async remove(workspaceId, postId, { whileStatus } = {}) {
      if (!validIds(workspaceId, postId)) return false;
      const filter: FilterQuery<PostFields> = scoped(workspaceId, postId);
      if (whileStatus) filter.status = { $in: whileStatus };
      const result = await PostModel.deleteOne(filter);
      return result.deletedCount === 1;
    },

    async findUsingMedia(workspaceId, mediaId, limit) {
      if (!validIds(workspaceId, mediaId)) return [];
      const docs = await PostModel.find({
        workspaceId: new Types.ObjectId(workspaceId),
        mediaIds: new Types.ObjectId(mediaId),
      })
        .sort({ _id: -1 })
        .limit(limit)
        .lean();
      return docs.map((doc) => toRecord(doc as PostDoc));
    },
  };
}
