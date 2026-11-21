import type { MediaKind, MediaMimeType } from '@metaflow/shared';

/** Data-access contract for media library records. Every method is scoped by the workspace ID. */

export interface MediaRecord {
  id: string;
  workspaceId: string;
  kind: MediaKind;
  mimeType: MediaMimeType;
  originalName: string;
  /** Server-side only: never part of an API response. */
  storageKey: string;
  size: number;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  altText: string;
  description: string;
  uploadedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export type NewMedia = Omit<MediaRecord, 'id' | 'createdAt' | 'updatedAt'>;

export interface MediaListOptions {
  kind?: MediaKind;
  /** Case-insensitive text search in the name, alt text and description. */
  q?: string;
  before?: string;
  limit: number;
}

export interface MediaRepository {
  create(media: NewMedia): Promise<MediaRecord>;
  findInWorkspace(workspaceId: string, mediaId: string): Promise<MediaRecord | null>;
  /** The ones that exist in the workspace, in no particular order. */
  findManyInWorkspace(workspaceId: string, mediaIds: readonly string[]): Promise<MediaRecord[]>;
  /** Newest first. `before` is the ID of the last item already shown. */
  list(workspaceId: string, options: MediaListOptions): Promise<MediaRecord[]>;
  update(
    workspaceId: string,
    mediaId: string,
    changes: Partial<Pick<MediaRecord, 'altText' | 'description'>>,
  ): Promise<MediaRecord | null>;
  /** Deletes the record and returns it; null when it did not exist in the workspace. */
  remove(workspaceId: string, mediaId: string): Promise<MediaRecord | null>;
}
