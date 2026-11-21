import type { MediaRecord, MediaRepository } from '../../src/repositories/media-repositories';
import { createIdSequence } from './in-memory-ai-repositories';

export interface InMemoryMediaRepository extends MediaRepository {
  store: { media: MediaRecord[] };
  /** Makes the next `create` fail, like a database outage after the file was stored. */
  failNextCreate(): void;
}

/** Behaves like the MongoDB repository: every lookup scoped by workspace, records copied out. */
export function createInMemoryMediaRepository(): InMemoryMediaRepository {
  const media: MediaRecord[] = [];
  const nextId = createIdSequence(0x200000);
  let clock = Date.now();
  const tick = () => new Date((clock += 1));
  let failCreate = false;
  const find = (workspaceId: string, mediaId: string) =>
    media.find((item) => item.workspaceId === workspaceId && item.id === mediaId);

  return {
    store: { media },
    failNextCreate: () => {
      failCreate = true;
    },

    create(input) {
      if (failCreate) {
        failCreate = false;
        return Promise.reject(new Error('database unavailable'));
      }
      const at = tick();
      const record: MediaRecord = {
        ...structuredClone(input),
        id: nextId(),
        createdAt: at,
        updatedAt: at,
      };
      media.push(record);
      return Promise.resolve(structuredClone(record));
    },

    findInWorkspace(workspaceId, mediaId) {
      const record = find(workspaceId, mediaId);
      return Promise.resolve(record ? structuredClone(record) : null);
    },

    findManyInWorkspace(workspaceId, mediaIds) {
      return Promise.resolve(
        media
          .filter((item) => item.workspaceId === workspaceId && mediaIds.includes(item.id))
          .map((item) => structuredClone(item)),
      );
    },

    list(workspaceId, { kind, q, before, limit }) {
      const term = q?.toLowerCase();
      return Promise.resolve(
        media
          .filter((item) => item.workspaceId === workspaceId)
          .filter((item) => !kind || item.kind === kind)
          .filter(
            (item) =>
              !term ||
              [item.originalName, item.altText, item.description].some((text) =>
                text.toLowerCase().includes(term),
              ),
          )
          .filter((item) => !before || item.id < before)
          .sort((a, b) => (a.id < b.id ? 1 : -1))
          .slice(0, limit)
          .map((item) => structuredClone(item)),
      );
    },

    update(workspaceId, mediaId, changes) {
      const record = find(workspaceId, mediaId);
      if (!record) return Promise.resolve(null);
      Object.assign(record, changes, { updatedAt: tick() });
      return Promise.resolve(structuredClone(record));
    },

    remove(workspaceId, mediaId) {
      const record = find(workspaceId, mediaId);
      if (!record) return Promise.resolve(null);
      media.splice(media.indexOf(record), 1);
      return Promise.resolve(structuredClone(record));
    },
  };
}
