import { isValidObjectId, Types, type FilterQuery } from 'mongoose';
import { MediaModel, type MediaFields } from '../models/media.model';
import type { MediaRecord, MediaRepository } from './media-repositories';

type MediaDoc = MediaFields & { _id: Types.ObjectId; createdAt: Date; updatedAt: Date };

function toRecord(doc: MediaDoc): MediaRecord {
  return {
    id: doc._id.toString(),
    workspaceId: doc.workspaceId.toString(),
    kind: doc.kind,
    mimeType: doc.mimeType,
    originalName: doc.originalName,
    storageKey: doc.storageKey,
    size: doc.size,
    width: doc.width ?? null,
    height: doc.height ?? null,
    durationSeconds: doc.durationSeconds ?? null,
    altText: doc.altText,
    description: doc.description,
    uploadedBy: doc.uploadedBy.toString(),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

/** Escapes a search term so it matches literally inside a regular expression. */
export const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const scoped = (workspaceId: string, mediaId: string) => ({
  _id: new Types.ObjectId(mediaId),
  workspaceId: new Types.ObjectId(workspaceId),
});

export function createMongoMediaRepository(): MediaRepository {
  return {
    async create(media) {
      const created = await MediaModel.create({
        ...media,
        workspaceId: new Types.ObjectId(media.workspaceId),
        uploadedBy: new Types.ObjectId(media.uploadedBy),
      });
      return toRecord(created.toObject());
    },

    async findInWorkspace(workspaceId, mediaId) {
      if (!isValidObjectId(workspaceId) || !isValidObjectId(mediaId)) return null;
      const doc = await MediaModel.findOne(scoped(workspaceId, mediaId)).lean();
      return doc ? toRecord(doc) : null;
    },

    async findManyInWorkspace(workspaceId, mediaIds) {
      const ids = mediaIds.filter((id) => isValidObjectId(id));
      if (!isValidObjectId(workspaceId) || ids.length === 0) return [];
      const docs = await MediaModel.find({
        workspaceId: new Types.ObjectId(workspaceId),
        _id: { $in: ids.map((id) => new Types.ObjectId(id)) },
      }).lean();
      return docs.map((doc) => toRecord(doc as MediaDoc));
    },

    async list(workspaceId, { kind, q, before, limit }) {
      if (!isValidObjectId(workspaceId)) return [];
      const filter: FilterQuery<MediaFields> = { workspaceId: new Types.ObjectId(workspaceId) };
      if (kind) filter.kind = kind;
      if (before && isValidObjectId(before)) filter._id = { $lt: new Types.ObjectId(before) };
      if (q) {
        const pattern = new RegExp(escapeRegex(q), 'i');
        filter.$or = [{ originalName: pattern }, { altText: pattern }, { description: pattern }];
      }
      const docs = await MediaModel.find(filter).sort({ _id: -1 }).limit(limit).lean();
      return docs.map((doc) => toRecord(doc as MediaDoc));
    },

    async update(workspaceId, mediaId, changes) {
      if (!isValidObjectId(workspaceId) || !isValidObjectId(mediaId)) return null;
      const doc = await MediaModel.findOneAndUpdate(
        scoped(workspaceId, mediaId),
        { $set: changes },
        { new: true, runValidators: true },
      ).lean();
      return doc ? toRecord(doc) : null;
    },

    async remove(workspaceId, mediaId) {
      if (!isValidObjectId(workspaceId) || !isValidObjectId(mediaId)) return null;
      const doc = await MediaModel.findOneAndDelete(scoped(workspaceId, mediaId)).lean();
      return doc ? toRecord(doc) : null;
    },
  };
}
