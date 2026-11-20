import type { PostRecord, PostRepository } from '../../src/repositories/post-repositories';
import { createIdSequence } from './in-memory-ai-repositories';

export interface InMemoryPostRepository extends PostRepository {
  store: { posts: PostRecord[] };
}

export function createInMemoryPostRepository(): InMemoryPostRepository {
  const posts: PostRecord[] = [];
  const nextId = createIdSequence(0x100000);

  return {
    store: { posts },

    createDraft(draft) {
      const at = new Date();
      const post: PostRecord = {
        ...structuredClone(draft),
        id: nextId(),
        status: 'draft',
        createdAt: at,
        updatedAt: at,
      };
      posts.push(post);
      return Promise.resolve(structuredClone(post));
    },

    list(workspaceId, { status, before, limit }) {
      return Promise.resolve(
        posts
          .filter((p) => p.workspaceId === workspaceId)
          .filter((p) => !status || p.status === status)
          .filter((p) => !before || p.id < before)
          .sort((a, b) => (a.id < b.id ? 1 : -1))
          .slice(0, limit)
          .map((p) => structuredClone(p)),
      );
    },
  };
}
