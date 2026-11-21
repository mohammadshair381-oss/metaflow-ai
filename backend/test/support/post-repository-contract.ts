import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import type { NewPost, PostRepository } from '../../src/repositories/post-repositories';

/**
 * Behavior every PostRepository must share, for the optimistic-concurrency rules in particular.
 * Plain `node:assert`, so the same cases run in Vitest (in-memory, and MongoDB when
 * MONGODB_TEST_URI is set) and in the manual check against a development database.
 */
export interface PostRepositoryTarget {
  repository: PostRepository;
  /** Stores a draft the way posts were saved before revisions existed: no `revision` field. */
  insertLegacyDraft: (workspaceId: string, createdBy: string) => Promise<string>;
}

export const newObjectId = () => randomBytes(12).toString('hex');

const draft = (workspaceId: string, createdBy: string): NewPost => ({
  workspaceId,
  title: 'Contract post',
  caption: 'Original caption',
  hashtags: [],
  platforms: ['facebook'],
  mediaIds: [],
  socialAccountIds: [],
  source: 'manual',
  generationId: null,
  createdBy,
});
const event = (by: string, action: 'submit' | 'withdraw' | 'approve' = 'submit') => ({
  action,
  by,
  at: new Date(),
  note: null,
});
const EDITABLE = ['draft', 'changes_requested'] as const;

export const POST_REPOSITORY_CONTRACT: {
  name: string;
  run: (target: PostRepositoryTarget) => Promise<void>;
}[] = [
  {
    name: 'new posts start at revision 0',
    async run({ repository }) {
      const post = await repository.create(draft(newObjectId(), newObjectId()));
      assert.equal(post.revision, 0);
      assert.equal((await repository.findInWorkspace(post.workspaceId, post.id))?.revision, 0);
    },
  },
  {
    name: 'a content edit at the expected revision applies and increments it',
    async run({ repository }) {
      const user = newObjectId();
      const post = await repository.create(draft(newObjectId(), user));
      const edited = await repository.updateContent(post.workspaceId, post.id, {
        changes: { caption: 'Edited' },
        whileStatus: EDITABLE,
        expectedRevision: 0,
        by: user,
      });
      assert.equal(edited?.revision, 1);
      assert.equal(edited?.caption, 'Edited');
    },
  },
  {
    name: 'a content edit at a stale revision changes nothing',
    async run({ repository }) {
      const user = newObjectId();
      const post = await repository.create(draft(newObjectId(), user));
      const edit = (expectedRevision: number, caption: string) =>
        repository.updateContent(post.workspaceId, post.id, {
          changes: { caption },
          whileStatus: EDITABLE,
          expectedRevision,
          by: user,
        });
      assert.notEqual(await edit(0, 'First'), null);
      assert.equal(await edit(0, 'Stale'), null);
      assert.equal(await edit(5, 'Future'), null);
      const stored = await repository.findInWorkspace(post.workspaceId, post.id);
      assert.equal(stored?.caption, 'First');
      assert.equal(stored?.revision, 1);
    },
  },
  {
    name: 'a content edit is refused once the status is not editable, even at the right revision',
    async run({ repository }) {
      const user = newObjectId();
      const post = await repository.create(draft(newObjectId(), user));
      const submitted = await repository.transition(post.workspaceId, post.id, {
        from: 'draft',
        expectedRevision: 0,
        to: 'awaiting_approval',
        event: event(user),
      });
      assert.equal(submitted?.revision, 1);
      const edit = await repository.updateContent(post.workspaceId, post.id, {
        changes: { caption: 'Too late' },
        whileStatus: EDITABLE,
        expectedRevision: 1,
        by: user,
      });
      assert.equal(edit, null);
      assert.equal(
        (await repository.findInWorkspace(post.workspaceId, post.id))?.caption,
        'Original caption',
      );
    },
  },
  {
    name: 'a transition checks status and revision together, increments and records the event',
    async run({ repository }) {
      const user = newObjectId();
      const post = await repository.create(draft(newObjectId(), user));
      const move = (from: 'draft' | 'awaiting_approval', expectedRevision: number) =>
        repository.transition(post.workspaceId, post.id, {
          from,
          expectedRevision,
          to: from === 'draft' ? 'awaiting_approval' : 'approved',
          event: event(user, from === 'draft' ? 'submit' : 'approve'),
        });
      assert.equal(await move('awaiting_approval', 0), null, 'wrong status');
      const submitted = await move('draft', 0);
      assert.equal(submitted?.status, 'awaiting_approval');
      assert.equal(submitted?.revision, 1);
      assert.equal(await move('awaiting_approval', 0), null, 'right status, stale revision');
      const approved = await move('awaiting_approval', 1);
      assert.equal(approved?.revision, 2);
      assert.deepEqual(
        approved?.reviewEvents.map((e) => e.action),
        ['submit', 'approve'],
      );
    },
  },
  {
    name: 'edits and transitions are scoped by workspace',
    async run({ repository }) {
      const user = newObjectId();
      const post = await repository.create(draft(newObjectId(), user));
      const other = newObjectId();
      assert.equal(
        await repository.transition(other, post.id, {
          from: 'draft',
          expectedRevision: 0,
          to: 'awaiting_approval',
          event: event(user),
        }),
        null,
      );
      assert.equal(
        await repository.updateContent(other, post.id, {
          changes: { caption: 'x' },
          whileStatus: EDITABLE,
          expectedRevision: 0,
          by: user,
        }),
        null,
      );
      const stored = await repository.findInWorkspace(post.workspaceId, post.id);
      assert.equal(stored?.revision, 0);
      assert.equal(stored?.status, 'draft');
    },
  },
  {
    name: 'a post saved before revisions existed reads as revision 0 and takes part normally',
    async run({ repository, insertLegacyDraft }) {
      const workspaceId = newObjectId();
      const user = newObjectId();
      const legacyId = await insertLegacyDraft(workspaceId, user);
      const legacy = await repository.findInWorkspace(workspaceId, legacyId);
      assert.equal(legacy?.revision, 0);
      assert.equal(
        await repository.transition(workspaceId, legacyId, {
          from: 'draft',
          expectedRevision: 1,
          to: 'awaiting_approval',
          event: event(user),
        }),
        null,
        'a legacy post is not at revision 1',
      );
      const submitted = await repository.transition(workspaceId, legacyId, {
        from: 'draft',
        expectedRevision: 0,
        to: 'awaiting_approval',
        event: event(user),
      });
      assert.equal(submitted?.revision, 1);

      const secondId = await insertLegacyDraft(workspaceId, user);
      const edited = await repository.updateContent(workspaceId, secondId, {
        changes: { caption: 'Edited legacy' },
        whileStatus: EDITABLE,
        expectedRevision: 0,
        by: user,
      });
      assert.equal(edited?.revision, 1);
      assert.equal(
        (await repository.list(workspaceId, { limit: 10 })).every((post) => post.revision === 1),
        true,
      );
    },
  },
];
