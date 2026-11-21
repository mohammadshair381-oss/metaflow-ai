import {
  apiErrorResponseSchema,
  mediaResponseSchema,
  postResponseSchema,
  workspaceResponseSchema,
  type Post,
} from '@metaflow/shared';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request, { type Response } from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import type { PostRepository } from '../src/repositories/post-repositories';
import { createLocalMediaStorage } from '../src/storage/local-media-storage';
import { buildTestApp, FRONTEND_ORIGIN } from './helpers';
import { createInMemoryAuthRepositories } from './support/in-memory-auth-repositories';
import { createInMemoryMediaRepository } from './support/in-memory-media-repository';
import { createInMemoryPostRepository } from './support/in-memory-post-repository';
import { createInMemorySocialRepositories } from './support/in-memory-social-repositories';
import { createInMemoryWorkspaceRepository } from './support/in-memory-workspace-repository';
import { jpegFile } from './support/media-fixtures';
import { signInAs, type SessionClient } from './support/session-client';

/**
 * Races between edits and workflow decisions, made deterministic: the repository wrapper runs a
 * competing request at an exact point, after the service has read the post and done its checks
 * but before its conditional write. No timers or timing assumptions.
 */

const errorOf = (response: Response) => apiErrorResponseSchema.parse(response.body).error;
const postOf = (response: Response) => postResponseSchema.parse(response.body).post;
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

type Interruption = () => Promise<unknown>;

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'metaflow-concurrency-'));
  roots.push(root);
  const auth = createInMemoryAuthRepositories();
  const workspaces = createInMemoryWorkspaceRepository(auth.users);
  const social = createInMemorySocialRepositories();
  const posts = createInMemoryPostRepository();

  // Each interruption runs once, just before the next conditional write of its kind.
  const interrupt: { beforeTransition?: Interruption; beforeUpdateContent?: Interruption } = {};
  const take = (key: keyof typeof interrupt) => {
    const run = interrupt[key];
    interrupt[key] = undefined;
    return run;
  };
  const postRepository: PostRepository = {
    ...posts,
    transition: async (...args) => {
      await take('beforeTransition')?.();
      return posts.transition(...args);
    },
    updateContent: async (...args) => {
      await take('beforeUpdateContent')?.();
      return posts.updateContent(...args);
    },
  };

  const app = buildTestApp({
    authRepositories: auth,
    workspaceRepository: workspaces,
    socialRepositories: social,
    postRepository,
    mediaRepository: createInMemoryMediaRepository(),
    mediaStorage: createLocalMediaStorage(root),
  });
  const signIn = (name: string) => signInAs(app, auth, name);
  const owner = await signIn('Olivia');
  const workspace = workspaceResponseSchema.parse(
    (await owner.post('/api/workspaces', { name: 'Bloom Bakery' })).body,
  ).workspace;
  const addStaff = async (name: string) => {
    const client = await signIn(name);
    await workspaces.addMember(workspace.id, client.user.id, 'staff');
    return client;
  };
  const path = (suffix = '') => `/api/workspaces/${workspace.id}/posts${suffix}`;

  const photo = mediaResponseSchema.parse(
    (
      await request(app)
        .post(`/api/workspaces/${workspace.id}/media`)
        .set('Cookie', owner.cookie)
        .set('Origin', FRONTEND_ORIGIN)
        .attach('file', jpegFile(), 'photo.jpg')
    ).body,
  ).media;
  const page = await social.accounts.upsertConnection({
    workspaceId: workspace.id,
    platform: 'facebook',
    externalId: 'page-1',
    name: 'Bloom Page',
    username: null,
    accountType: 'facebook_page',
    profileImageUrl: null,
    status: 'connected',
    issue: null,
    grantedPermissions: [],
    missingPermissions: [],
    encryptedToken: 'encrypted',
    tokenExpiresAt: null,
    linkedPageId: null,
    connectedBy: owner.user.id,
    at: new Date(),
  });

  /** A Facebook post that passes the platform check. */
  const readyPost = async (client: SessionClient = owner) =>
    postOf(
      await client.post(path(), {
        title: 'Croissant launch',
        caption: 'Fresh every morning',
        platforms: ['facebook'],
        mediaIds: [photo.id],
        socialAccountIds: [page.id],
      }),
    );
  const current = async (post: Post) => postOf(await owner.get(path(`/${post.id}`)));
  /** A workflow request made from what the user saw at `revision`. */
  const act = (
    client: SessionClient,
    post: Post,
    action: string,
    revision: number,
    note?: string,
  ) => client.post(path(`/${post.id}/workflow`), { action, revision, ...(note ? { note } : {}) });
  /** An edit made from a form loaded at `revision`. */
  const edit = (client: SessionClient, post: Post, revision: number, changes: object) =>
    client.patch(path(`/${post.id}`), { revision, ...changes });

  return { owner, addStaff, signIn, posts, interrupt, readyPost, current, act, edit, path };
}

describe('edit and submit racing', () => {
  it('an edit that lands after the submit was checked makes the submit fail', async () => {
    const { owner, interrupt, readyPost, current, act, edit } = await setup();
    const post = await readyPost();

    // The submit reads revision 0 and passes the platform check; then this edit lands.
    interrupt.beforeTransition = () => edit(owner, post, 0, { mediaIds: [], caption: 'Changed' });
    const submit = await act(owner, post, 'submit', post.revision);

    expect(submit.status).toBe(409);
    expect(errorOf(submit)).toMatchObject({
      code: 'CONFLICT',
      message: 'This post was changed by someone else. Reload it and try again.',
    });
    const after = await current(post);
    expect(after).toMatchObject({ status: 'draft', revision: 1, caption: 'Changed', mediaIds: [] });
    expect(after.reviewEvents).toEqual([]);
  });

  it('a submit that lands after the edit was checked makes the edit fail as not editable', async () => {
    const { owner, interrupt, readyPost, current, act, edit } = await setup();
    const post = await readyPost();

    // The edit reads the draft and validates it; then the submit lands.
    interrupt.beforeUpdateContent = () => act(owner, post, 'submit', post.revision);
    const response = await edit(owner, post, 0, { caption: 'Edited too late' });

    expect(response.status).toBe(409);
    expect(errorOf(response)).toMatchObject({
      code: 'INVALID_TRANSITION',
      message: 'This post is awaiting approval. Withdraw it before editing.',
    });
    const after = await current(post);
    expect(after).toMatchObject({
      status: 'awaiting_approval',
      revision: 1,
      caption: 'Fresh every morning',
    });
  });

  it('an edit made after the submit finished is refused as not editable', async () => {
    const { owner, readyPost, act, edit } = await setup();
    const post = await readyPost();
    expect((await act(owner, post, 'submit', 0)).status).toBe(200);
    const response = await edit(owner, post, 1, { caption: 'Later' });
    expect(response.status).toBe(409);
    expect(errorOf(response).code).toBe('INVALID_TRANSITION');
  });

  it('two edits read from the same revision: the second is refused, not merged', async () => {
    const { owner, addStaff, interrupt, readyPost, current, edit } = await setup();
    const staff = await addStaff('Sam');
    const post = await readyPost();

    interrupt.beforeUpdateContent = () =>
      edit(staff, post, 0, { platforms: [], socialAccountIds: [] });
    const response = await edit(owner, post, 0, { caption: 'Owner edit' });

    expect(response.status).toBe(409);
    expect(errorOf(response).code).toBe('CONFLICT');
    expect(await current(post)).toMatchObject({
      revision: 1,
      platforms: [],
      caption: 'Fresh every morning',
    });
  });
});

describe('stale edit forms', () => {
  it('two editors load the same revision: the second save is refused and overwrites nothing', async () => {
    const { owner, addStaff, readyPost, current, edit } = await setup();
    const staff = await addStaff('Sam');
    const post = await readyPost();
    // Both open the editor at revision 0.
    const loadedByOwner = (await current(post)).revision;
    const loadedByStaff = loadedByOwner;
    expect(loadedByOwner).toBe(0);

    const first = await edit(owner, post, loadedByOwner, { caption: 'Owner wording' });
    expect(first.status).toBe(200);
    expect(postOf(first).revision).toBe(1);

    const second = await edit(staff, post, loadedByStaff, {
      caption: 'Staff wording',
      title: 'Staff title',
    });
    expect(second.status).toBe(409);
    expect(errorOf(second)).toMatchObject({
      code: 'CONFLICT',
      message: 'This post was changed by someone else. Reload it and try again.',
    });

    // The first editor's changes stand, untouched by the stale form; no revision was used up.
    const after = await current(post);
    expect(after).toMatchObject({
      revision: 1,
      caption: 'Owner wording',
      title: 'Croissant launch',
      updatedBy: owner.user.id,
    });

    // After loading the latest version, the second editor can save.
    const retried = await edit(staff, post, after.revision, { title: 'Staff title' });
    expect(retried.status).toBe(200);
    expect(postOf(retried)).toMatchObject({
      revision: 2,
      caption: 'Owner wording',
      title: 'Staff title',
      updatedBy: staff.user.id,
    });
  });

  it('refuses a form loaded at any other revision, older or newer, without changing anything', async () => {
    const { owner, readyPost, current, edit } = await setup();
    const post = await readyPost();
    await edit(owner, post, 0, { caption: 'One' });
    await edit(owner, post, 1, { caption: 'Two' });
    for (const revision of [0, 1, 3, 99]) {
      const response = await edit(owner, post, revision, { caption: `Stale ${revision}` });
      expect(response.status).toBe(409);
      expect(errorOf(response).code).toBe('CONFLICT');
    }
    expect(await current(post)).toMatchObject({ revision: 2, caption: 'Two' });
  });

  it('requires the revision on every edit', async () => {
    const { owner, readyPost, path, current } = await setup();
    const post = await readyPost();
    for (const body of [
      { caption: 'No revision' },
      { caption: 'x', revision: -1 },
      { caption: 'x', revision: 1.5 },
      { caption: 'x', revision: '0' },
      { caption: 'x', revision: null },
    ]) {
      const response = await owner.patch(path(`/${post.id}`), body);
      expect(response.status).toBe(400);
      expect(errorOf(response).details?.map((d) => d.path)).toContain('body.revision');
    }
    // A revision alone is not an edit.
    expect((await owner.patch(path(`/${post.id}`), { revision: 0 })).status).toBe(400);
    expect((await current(post)).revision).toBe(0);
  });

  it('keeps the edit permissions: any member at the current revision, never outsiders or locked posts', async () => {
    const { owner, addStaff, readyPost, current, act, edit, signIn, path } = await setup();
    const staff = await addStaff('Sam');
    const post = await readyPost();
    // Staff may edit the owner's draft, at the current revision.
    expect((await edit(staff, post, 0, { caption: 'Staff edit' })).status).toBe(200);
    // A non-member gets 404 even with the right revision.
    const mallory = await signIn('Mallory');
    expect((await mallory.patch(path(`/${post.id}`), { revision: 1, caption: 'x' })).status).toBe(
      404,
    );
    // Awaiting approval: refused as not editable even at the current revision.
    await act(owner, post, 'submit', 1);
    const locked = await edit(staff, post, 2, { caption: 'Locked' });
    expect(locked.status).toBe(409);
    expect(errorOf(locked).code).toBe('INVALID_TRANSITION');
    expect(await current(post)).toMatchObject({ revision: 2, caption: 'Staff edit' });
  });
});

describe('simultaneous workflow decisions', () => {
  it('two decisions made on the same revision: only the first applies', async () => {
    const { owner, readyPost, current, act } = await setup();
    const post = await readyPost();
    await act(owner, post, 'submit', 0);
    const seen = (await current(post)).revision;

    expect((await act(owner, post, 'approve', seen)).status).toBe(200);
    const late = await act(owner, post, 'request_changes', seen, 'Too late');
    expect(late.status).toBe(409);
    expect(errorOf(late).code).toBe('CONFLICT');
    const after = await current(post);
    expect(after.status).toBe('approved');
    expect(after.reviewEvents.map((e) => e.action)).toEqual(['submit', 'approve']);
  });

  it('a decision that loses the race inside the server changes nothing', async () => {
    const { owner, interrupt, readyPost, current, act } = await setup();
    const post = await readyPost();
    await act(owner, post, 'submit', 0);

    // Approve reads revision 1; a request for changes on the same revision lands first.
    interrupt.beforeTransition = () => act(owner, post, 'request_changes', 1, 'Add the price');
    const approve = await act(owner, post, 'approve', 1);

    expect(approve.status).toBe(409);
    expect(errorOf(approve).code).toBe('CONFLICT');
    const after = await current(post);
    expect(after).toMatchObject({ status: 'changes_requested', revision: 2 });
    expect(after.reviewEvents.map((e) => [e.action, e.note])).toEqual([
      ['submit', null],
      ['request_changes', 'Add the price'],
    ]);
  });

  it('never approves content changed since the owner looked at it', async () => {
    const { owner, addStaff, readyPost, current, act, edit } = await setup();
    const staff = await addStaff('Sam');
    const post = await readyPost(staff);
    await act(staff, post, 'submit', 0);
    const seenByOwner = (await current(post)).revision;

    // Meanwhile: withdrawn, edited and submitted again.
    await act(staff, post, 'withdraw', seenByOwner);
    await edit(staff, post, (await current(post)).revision, { caption: 'Different content' });
    await act(staff, post, 'submit', (await current(post)).revision);

    const approve = await act(owner, post, 'approve', seenByOwner);
    expect(approve.status).toBe(409);
    expect(errorOf(approve).code).toBe('CONFLICT');
    expect((await current(post)).status).toBe('awaiting_approval');
  });
});

describe('withdraw and resubmit racing', () => {
  it('an old submitter cannot withdraw a newer submission made by someone else', async () => {
    const { owner, addStaff, readyPost, current, act, edit } = await setup();
    const alice = await addStaff('Alice');
    const bob = await addStaff('Bob');
    const post = await readyPost(alice);
    await act(alice, post, 'submit', 0);
    const seenByAlice = (await current(post)).revision;

    await act(owner, post, 'withdraw', seenByAlice);
    await edit(bob, post, (await current(post)).revision, { caption: 'Bob’s version' });
    await act(bob, post, 'submit', (await current(post)).revision);
    const before = await current(post);

    // Stale view: Alice still sees her own submission.
    const stale = await act(alice, post, 'withdraw', seenByAlice);
    expect(stale.status).toBe(409);
    expect(errorOf(stale).code).toBe('CONFLICT');
    // Fresh view: it is Bob's submission, which Alice may not withdraw.
    const fresh = await act(alice, post, 'withdraw', before.revision);
    expect(fresh.status).toBe(403);
    expect(errorOf(fresh).code).toBe('PERMISSION_DENIED');

    const after = await current(post);
    expect(after).toEqual(before);
    expect(after.reviewEvents.at(-1)).toMatchObject({ action: 'submit', by: bob.user.id });
  });

  it('a withdrawal checked against the old submitter fails if a resubmit lands before it writes', async () => {
    const { owner, addStaff, interrupt, readyPost, current, act } = await setup();
    const alice = await addStaff('Alice');
    const bob = await addStaff('Bob');
    const post = await readyPost(alice);
    await act(alice, post, 'submit', 0);

    // Alice's withdrawal reads revision 1 (her submission) and passes the submitter check;
    // before it writes, the owner withdraws and Bob submits again.
    interrupt.beforeTransition = async () => {
      await act(owner, post, 'withdraw', 1);
      await act(bob, post, 'submit', 2);
    };
    const response = await act(alice, post, 'withdraw', 1);

    expect(response.status).toBe(409);
    expect(errorOf(response).code).toBe('CONFLICT');
    const after = await current(post);
    expect(after).toMatchObject({ status: 'awaiting_approval', revision: 3 });
    expect(after.reviewEvents.map((e) => [e.action, e.by])).toEqual([
      ['submit', alice.user.id],
      ['withdraw', owner.user.id],
      ['submit', bob.user.id],
    ]);
  });

  it('keeps the owner able to withdraw any current submission', async () => {
    const { owner, addStaff, readyPost, current, act } = await setup();
    const alice = await addStaff('Alice');
    const post = await readyPost(alice);
    await act(alice, post, 'submit', 0);
    expect((await act(owner, post, 'withdraw', 1)).status).toBe(200);
    expect((await current(post)).status).toBe('draft');
  });
});

describe('revisions', () => {
  it('increase by one with every edit and workflow step, and never on a refused request', async () => {
    const { owner, addStaff, readyPost, current, act, edit, path } = await setup();
    const staff = await addStaff('Sam');
    const post = await readyPost();
    const revisions = [post.revision];
    const record = async () => revisions.push((await current(post)).revision);

    await edit(owner, post, 0, { title: 'Renamed' });
    await record();
    await act(owner, post, 'submit', 1);
    await record();
    await act(owner, post, 'request_changes', 2, 'Shorter');
    await record();
    await edit(owner, post, 3, { caption: 'Short' });
    await record();
    await act(owner, post, 'submit', 4);
    await record();
    await act(owner, post, 'approve', 5);
    await record();
    await act(owner, post, 'reopen', 6);
    await record();
    expect(revisions).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);

    // Refused requests: stale revision, wrong status, no permission, invalid content.
    expect((await act(owner, post, 'submit', 3)).status).toBe(409);
    expect((await act(owner, post, 'approve', 7)).status).toBe(409);
    expect((await act(staff, post, 'approve', 7)).status).toBe(403);
    expect((await edit(owner, post, 7, { title: '', caption: '', mediaIds: [] })).status).toBe(400);
    expect((await current(post)).revision).toBe(7);

    const copy = postOf(await owner.post(path(`/${post.id}/duplicate`)));
    expect(copy.revision).toBe(0);
  });

  it('requires the revision in workflow requests', async () => {
    const { owner, readyPost, path } = await setup();
    const post = await readyPost();
    for (const body of [
      { action: 'submit' },
      { action: 'submit', revision: -1 },
      { action: 'submit', revision: 0.5 },
      { action: 'submit', revision: '0' },
    ]) {
      const response = await owner.post(path(`/${post.id}/workflow`), body);
      expect(response.status).toBe(400);
      expect(errorOf(response).details?.map((d) => d.path)).toContain('body.revision');
    }
  });

  it('treats a post saved before revisions existed as revision 0', async () => {
    const { owner, posts, current, act, edit, readyPost } = await setup();
    const post = await readyPost();
    const stored = posts.store.posts.find((entry) => entry.id === post.id);
    if (!stored) throw new Error('post not stored');
    delete (stored as Partial<typeof stored>).revision;

    expect((await current(post)).revision).toBe(0);
    expect((await act(owner, post, 'submit', 1)).status).toBe(409);
    expect((await act(owner, post, 'submit', 0)).status).toBe(200);
    expect((await current(post)).revision).toBe(1);
    expect((await act(owner, post, 'withdraw', 1)).status).toBe(200);
    expect(postOf(await edit(owner, post, 2, { caption: 'Edited' })).revision).toBe(3);
  });
});
