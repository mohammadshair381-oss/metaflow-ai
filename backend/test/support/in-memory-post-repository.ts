import type { PostRecord, PostRepository } from '../../src/repositories/post-repositories';
import { createIdSequence } from './in-memory-ai-repositories';

export interface InMemoryPostRepository extends PostRepository {
  store: { posts: PostRecord[] };
}

/**
 * Behaves like the MongoDB repository where the service depends on it: lookups scoped by
 * workspace, status checked in the same step as the change (compare-and-set), records copied.
 */
export function createInMemoryPostRepository(): InMemoryPostRepository {
  const posts: PostRecord[] = [];
  const nextId = createIdSequence(0x100000);
  let clock = Date.now();
  const tick = () => new Date((clock += 1));
  const find = (workspaceId: string, postId: string) =>
    posts.find((post) => post.workspaceId === workspaceId && post.id === postId);
  /** Like the MongoDB repository: a record saved without a revision counts as revision 0. */
  const revisionOf = (post: PostRecord) => (post.revision as number | undefined) ?? 0;
  const copy = (post: PostRecord): PostRecord => ({
    ...structuredClone(post),
    revision: revisionOf(post),
  });

  return {
    store: { posts },

    create(input) {
      const at = tick();
      const post: PostRecord = {
        ...structuredClone(input),
        id: nextId(),
        status: 'draft',
        revision: 0,
        reviewEvents: [],
        scheduledAt: null,
        updatedBy: input.createdBy,
        createdAt: at,
        updatedAt: at,
      };
      posts.push(post);
      return Promise.resolve(copy(post));
    },

    findInWorkspace(workspaceId, postId) {
      const post = find(workspaceId, postId);
      return Promise.resolve(post ? copy(post) : null);
    },

    list(workspaceId, { status, platform, q, before, limit }) {
      const term = q?.toLowerCase();
      return Promise.resolve(
        posts
          .filter((p) => p.workspaceId === workspaceId)
          .filter((p) => !status || p.status === status)
          .filter((p) => !platform || p.platforms.includes(platform))
          .filter(
            (p) =>
              !term ||
              p.title.toLowerCase().includes(term) ||
              p.caption.toLowerCase().includes(term),
          )
          .filter((p) => !before || p.id < before)
          .sort((a, b) => (a.id < b.id ? 1 : -1))
          .slice(0, limit)
          .map((p) => copy(p)),
      );
    },

    updateContent(workspaceId, postId, { changes, whileStatus, expectedRevision, by }) {
      const post = find(workspaceId, postId);
      if (!post || !whileStatus.includes(post.status) || revisionOf(post) !== expectedRevision) {
        return Promise.resolve(null);
      }
      Object.assign(post, structuredClone(changes), {
        updatedBy: by,
        updatedAt: tick(),
        revision: revisionOf(post) + 1,
      });
      return Promise.resolve(copy(post));
    },

    transition(workspaceId, postId, { from, expectedRevision, to, event }) {
      const post = find(workspaceId, postId);
      if (!post || post.status !== from || revisionOf(post) !== expectedRevision) {
        return Promise.resolve(null);
      }
      post.revision = revisionOf(post) + 1;
      post.status = to;
      post.updatedBy = event.by;
      post.updatedAt = tick();
      post.reviewEvents.push(structuredClone(event));
      return Promise.resolve(copy(post));
    },

    remove(workspaceId, postId, { whileStatus } = {}) {
      const post = find(workspaceId, postId);
      if (!post || (whileStatus && !whileStatus.includes(post.status))) {
        return Promise.resolve(false);
      }
      posts.splice(posts.indexOf(post), 1);
      return Promise.resolve(true);
    },

    findUsingMedia(workspaceId, mediaId, limit) {
      return Promise.resolve(
        posts
          .filter((p) => p.workspaceId === workspaceId && p.mediaIds.includes(mediaId))
          .sort((a, b) => (a.id < b.id ? 1 : -1))
          .slice(0, limit)
          .map((p) => copy(p)),
      );
    },
  };
}
