import {
  mediaFormatLabel,
  formatBytes,
  type Media,
  type MediaLimits,
  type mediaListQuerySchema,
  type updateMediaRequestSchema,
  type uploadMediaFieldsSchema,
} from '@metaflow/shared';
import type { Readable } from 'node:stream';
import type { z } from 'zod';
import {
  claimedTypeMatches,
  extensionOf,
  inspectMediaHead,
  readFileHead,
  sanitizeFileName,
} from '../media/media-inspector';
import type { MediaRecord, MediaRepository } from '../repositories/media-repositories';
import type { PostRepository } from '../repositories/post-repositories';
import type { WorkspaceRepository } from '../repositories/workspace-repositories';
import { createStorageKey, type MediaStorage } from '../storage/media-storage';
import { AppError } from '../utils/app-error';
import type { Logger } from '../utils/logger';
import type { WorkspaceAccess, WorkspaceService } from './workspace.service';

/** A file multer wrote to the server's temporary directory. Removed by the caller. */
export interface UploadedFile {
  path: string;
  originalName: string;
  /** What the browser claimed. Checked against the content, never trusted. */
  claimedMimeType: string;
  size: number;
}

export interface MediaFile {
  media: MediaRecord;
  stream: Readable;
  /** Total size of the file. */
  size: number;
  /** Set when a byte range was served. */
  range: { start: number; end: number } | null;
}

export interface MediaService {
  readonly limits: MediaLimits;
  /** Checked before the upload body is read: membership, and storage being configured. */
  assertCanUpload(userId: string, workspaceId: string): Promise<void>;
  upload(
    userId: string,
    workspaceId: string,
    file: UploadedFile,
    fields: z.output<typeof uploadMediaFieldsSchema>,
  ): Promise<MediaRecord>;
  list(
    userId: string,
    workspaceId: string,
    query: z.output<typeof mediaListQuerySchema>,
  ): Promise<{ media: MediaRecord[]; nextCursor: string | null }>;
  get(userId: string, workspaceId: string, mediaId: string): Promise<MediaRecord>;
  update(
    userId: string,
    workspaceId: string,
    mediaId: string,
    changes: z.output<typeof updateMediaRequestSchema>,
  ): Promise<MediaRecord>;
  /** Refused while posts or the workspace logo use the item. */
  remove(userId: string, workspaceId: string, mediaId: string): Promise<void>;
  /**
   * The file's bytes, for the file endpoint. `range` is resolved by the caller against the
   * total size (see `size`).
   */
  openFile(
    userId: string,
    workspaceId: string,
    mediaId: string,
    pickRange: (size: number) => { start: number; end: number } | null | 'unsatisfiable',
  ): Promise<MediaFile | 'unsatisfiable'>;
  /** Owner only. Image from this workspace's library, or null to remove the logo. */
  setWorkspaceLogo(
    userId: string,
    workspaceId: string,
    mediaId: string | null,
  ): Promise<WorkspaceAccess>;
}

export function toMedia(record: MediaRecord): Media {
  return {
    id: record.id,
    kind: record.kind,
    mimeType: record.mimeType,
    originalName: record.originalName,
    size: record.size,
    width: record.width,
    height: record.height,
    durationSeconds: record.durationSeconds,
    altText: record.altText,
    description: record.description,
    uploadedBy: record.uploadedBy,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

const MEDIA_NOT_FOUND = () => new AppError('NOT_FOUND', 'Media not found');
const SUPPORTED = 'Upload a JPEG, PNG, WebP or GIF image, or an MP4 or WebM video.';

export function createMediaService({
  workspaces,
  workspaceRepository,
  media,
  posts,
  storage,
  maxImageBytes,
  maxVideoBytes,
  logger,
}: {
  workspaces: Pick<WorkspaceService, 'requireAccess'>;
  workspaceRepository: Pick<WorkspaceRepository, 'setLogo'>;
  media: MediaRepository;
  posts: Pick<PostRepository, 'findUsingMedia'>;
  /** Null when no storage is configured: uploads and file reads answer 503. */
  storage: MediaStorage | null;
  maxImageBytes: number;
  maxVideoBytes: number;
  logger: Logger;
}): MediaService {
  const limits: MediaLimits = {
    imageBytes: maxImageBytes,
    videoBytes: maxVideoBytes,
    uploadsEnabled: storage !== null,
  };

  const requireStorage = () => {
    if (!storage) {
      throw new AppError(
        'INTEGRATION_NOT_CONFIGURED',
        'Media storage is not configured on the server yet.',
      );
    }
    return storage;
  };

  async function findMedia(workspaceId: string, mediaId: string) {
    const record = await media.findInWorkspace(workspaceId, mediaId);
    if (!record) throw MEDIA_NOT_FOUND();
    return record;
  }

  return {
    limits,

    async assertCanUpload(userId, workspaceId) {
      await workspaces.requireAccess(userId, workspaceId);
      requireStorage();
    },

    async upload(userId, workspaceId, file, fields) {
      await workspaces.requireAccess(userId, workspaceId);
      const store = requireStorage();

      if (file.size === 0) throw new AppError('BAD_REQUEST', 'The file is empty.');
      const inspected = inspectMediaHead(await readFileHead(file.path));
      if (!inspected) {
        throw new AppError('UNSUPPORTED_MEDIA', `This file type isn't supported. ${SUPPORTED}`);
      }
      const label = mediaFormatLabel(inspected.mimeType);
      const extension = extensionOf(file.originalName);
      const allowed = inspected.mimeType === 'image/jpeg' ? ['jpg', 'jpeg'] : [inspected.extension];
      if (!allowed.includes(extension)) {
        throw new AppError(
          'UNSUPPORTED_MEDIA',
          `This file is a ${label} ${inspected.kind}, but its name ends in "${extension ? `.${extension}` : 'no extension'}". Rename it to .${inspected.extension} and try again.`,
        );
      }
      if (!claimedTypeMatches(file.claimedMimeType, inspected.mimeType)) {
        throw new AppError(
          'UNSUPPORTED_MEDIA',
          `The file's contents don't match its type. ${SUPPORTED}`,
        );
      }
      const maxBytes = inspected.kind === 'image' ? maxImageBytes : maxVideoBytes;
      if (file.size > maxBytes) {
        throw new AppError(
          'PAYLOAD_TOO_LARGE',
          `${inspected.kind === 'image' ? 'Images' : 'Videos'} can be at most ${formatBytes(maxBytes)}.`,
        );
      }

      const storageKey = createStorageKey(workspaceId, inspected.extension);
      await store.put(storageKey, file.path, { contentType: inspected.mimeType });
      try {
        return await media.create({
          workspaceId,
          kind: inspected.kind,
          mimeType: inspected.mimeType,
          originalName: sanitizeFileName(file.originalName, extension),
          storageKey,
          size: file.size,
          width: inspected.width,
          height: inspected.height,
          durationSeconds: null,
          altText: fields.altText,
          description: fields.description,
          uploadedBy: userId,
        });
      } catch (error) {
        // No record points at the file: remove it so it does not linger unreachable.
        await store.delete(storageKey).catch((cleanupError: unknown) => {
          logger.error('media.orphan_cleanup_failed', { workspaceId, error: cleanupError });
        });
        throw error;
      }
    },

    async list(userId, workspaceId, { limit, ...filters }) {
      await workspaces.requireAccess(userId, workspaceId);
      const page = await media.list(workspaceId, { ...filters, limit: limit + 1 });
      const items = page.slice(0, limit);
      return {
        media: items,
        nextCursor: page.length > limit ? (items.at(-1)?.id ?? null) : null,
      };
    },

    async get(userId, workspaceId, mediaId) {
      await workspaces.requireAccess(userId, workspaceId);
      return findMedia(workspaceId, mediaId);
    },

    async update(userId, workspaceId, mediaId, changes) {
      await workspaces.requireAccess(userId, workspaceId);
      const defined = Object.fromEntries(
        Object.entries(changes).filter(([, value]) => value !== undefined),
      );
      const updated = await media.update(workspaceId, mediaId, defined);
      if (!updated) throw MEDIA_NOT_FOUND();
      return updated;
    },

    async remove(userId, workspaceId, mediaId) {
      const { role, workspace } = await workspaces.requireAccess(userId, workspaceId);
      const record = await findMedia(workspaceId, mediaId);
      if (role !== 'owner' && record.uploadedBy !== userId) {
        throw new AppError(
          'PERMISSION_DENIED',
          'Staff can delete only media they uploaded themselves.',
        );
      }
      if (workspace.logoMediaId === mediaId) {
        throw new AppError(
          'MEDIA_IN_USE',
          'This image is the workspace logo. Choose another logo or remove it first.',
        );
      }
      const users = await posts.findUsingMedia(workspaceId, mediaId, 6);
      if (users.length > 0) {
        const count =
          users.length > 5
            ? 'more than 5 posts'
            : users.length === 1
              ? '1 post'
              : `${users.length} posts`;
        throw new AppError(
          'MEDIA_IN_USE',
          `This media is attached to ${count}. Remove it from them before deleting it.`,
        );
      }

      // The record goes first: once it is gone nothing can reference or serve the file.
      const removed = await media.remove(workspaceId, mediaId);
      if (!removed) throw MEDIA_NOT_FOUND();
      if (storage) {
        await storage.delete(removed.storageKey).catch((error: unknown) => {
          // The file is unreachable without its record; it can be cleaned up later.
          logger.error('media.file_delete_failed', { workspaceId, mediaId, error });
        });
      } else {
        logger.warn('media.file_delete_skipped_no_storage', { workspaceId, mediaId });
      }
    },

    async openFile(userId, workspaceId, mediaId, pickRange) {
      await workspaces.requireAccess(userId, workspaceId);
      const record = await findMedia(workspaceId, mediaId);
      const store = requireStorage();
      const size = await store.size(record.storageKey);
      if (size === null) {
        logger.warn('media.file_missing', { workspaceId, mediaId });
        throw new AppError('NOT_FOUND', 'The file for this media item is missing.');
      }
      const range = pickRange(size);
      if (range === 'unsatisfiable') return 'unsatisfiable';
      const stream = await store.open(record.storageKey, range ?? undefined);
      if (!stream) throw new AppError('NOT_FOUND', 'The file for this media item is missing.');
      return { media: record, stream, size, range };
    },

    async setWorkspaceLogo(userId, workspaceId, mediaId) {
      const access = await workspaces.requireAccess(userId, workspaceId, { role: 'owner' });
      if (mediaId !== null) {
        const record = await findMedia(workspaceId, mediaId);
        if (record.kind !== 'image') {
          throw new AppError('UNSUPPORTED_MEDIA', 'Choose an image for the logo, not a video.');
        }
      }
      const workspace = await workspaceRepository.setLogo(workspaceId, mediaId);
      if (!workspace) throw new AppError('NOT_FOUND', 'Workspace not found');
      return { workspace, role: access.role };
    },
  };
}
