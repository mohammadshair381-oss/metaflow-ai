import {
  apiErrorResponseSchema,
  mediaResponseSchema,
  postListResponseSchema,
  postResponseSchema,
  workspaceResponseSchema,
  type Post,
  type SocialPlatform,
} from '@metaflow/shared';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request, { type Response } from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { createLocalMediaStorage } from '../src/storage/local-media-storage';
import { buildTestApp, FRONTEND_ORIGIN } from './helpers';
import { createInMemoryAuthRepositories } from './support/in-memory-auth-repositories';
import { createInMemoryMediaRepository } from './support/in-memory-media-repository';
import { createInMemoryPostRepository } from './support/in-memory-post-repository';
import { createInMemorySocialRepositories } from './support/in-memory-social-repositories';
import { createInMemoryWorkspaceRepository } from './support/in-memory-workspace-repository';
import { jpegFile, mp4File, pngFile, webmFile } from './support/media-fixtures';
import { signInAs, type SessionClient } from './support/session-client';

const errorOf = (response: Response) => apiErrorResponseSchema.parse(response.body).error;
const postOf = (response: Response) => postResponseSchema.parse(response.body).post;
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function setup({ staleReads = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'metaflow-posts-'));
  roots.push(root);
  const auth = createInMemoryAuthRepositories();
  const workspaces = createInMemoryWorkspaceRepository(auth.users);
  const social = createInMemorySocialRepositories();
  const posts = createInMemoryPostRepository();
  // Simulates a request that read the post just before another request changed its status.
  let staleStatus: Post['status'] | null = null;
  const postRepository: typeof posts = staleReads
    ? {
        ...posts,
        findInWorkspace: async (workspaceId, postId) => {
          const record = await posts.findInWorkspace(workspaceId, postId);
          return record && staleStatus ? { ...record, status: staleStatus } : record;
        },
      }
    : posts;
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
  const staff = await signIn('Sam');
  const createWorkspace = async (client: SessionClient, name: string) =>
    workspaceResponseSchema.parse((await client.post('/api/workspaces', { name })).body).workspace;
  const workspace = await createWorkspace(owner, 'Bloom Bakery');
  await workspaces.addMember(workspace.id, staff.user.id, 'staff');
  const path = (suffix = '', workspaceId = workspace.id) =>
    `/api/workspaces/${workspaceId}/posts${suffix}`;

  const upload = async (file: Buffer, name: string, workspaceId = workspace.id, client = owner) =>
    mediaResponseSchema.parse(
      (
        await request(app)
          .post(`/api/workspaces/${workspaceId}/media`)
          .set('Cookie', client.cookie)
          .set('Origin', FRONTEND_ORIGIN)
          .attach('file', file, name)
      ).body,
    ).media;

  const connect = async (
    platform: SocialPlatform,
    {
      workspaceId = workspace.id,
      status = 'connected' as const,
      name = `${platform} account`,
    } = {},
  ) =>
    social.accounts.upsertConnection({
      workspaceId,
      platform,
      externalId: `${platform}-${Math.random()}`,
      name,
      username: platform === 'instagram' ? 'bloom' : null,
      accountType: platform === 'instagram' ? 'instagram_professional' : 'facebook_page',
      profileImageUrl: null,
      status,
      issue: status === 'connected' ? null : 'token_invalid',
      grantedPermissions: [],
      missingPermissions: [],
      encryptedToken: 'encrypted',
      tokenExpiresAt: null,
      linkedPageId: null,
      connectedBy: owner.user.id,
      at: new Date(),
    });

  /** A post that passes the Instagram and Facebook rules. */
  const readyPost = async (client = owner) => {
    const photo = await upload(jpegFile(), 'photo.jpg');
    const instagram = await connect('instagram');
    const facebook = await connect('facebook');
    const response = await client.post(path(), {
      title: 'Croissant launch',
      caption: 'Fresh croissants every morning',
      hashtags: ['bakery'],
      platforms: ['instagram', 'facebook'],
      mediaIds: [photo.id],
      socialAccountIds: [instagram.id, facebook.id],
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return postOf(response);
  };

  /**
   * A workflow request from a user looking at the latest version of the post (its current
   * revision). Stale views are covered in post-concurrency.test.ts.
   */
  const act = async (client: SessionClient, post: Post, action: string, note?: string) => {
    const latest = await client.get(path(`/${post.id}`));
    const revision = latest.status === 200 ? postOf(latest).revision : 0;
    return client.post(
      path(`/${post.id}/workflow`),
      note === undefined ? { action, revision } : { action, revision, note },
    );
  };
  /**
   * An edit from a user looking at the latest version of the post (its current revision).
   * Stale forms are covered in post-concurrency.test.ts.
   */
  const edit = async (client: SessionClient, post: Post, changes: object) => {
    const latest = await client.get(path(`/${post.id}`));
    const revision = latest.status === 200 ? postOf(latest).revision : 0;
    return client.patch(path(`/${post.id}`), { revision, ...changes });
  };

  return {
    app,
    owner,
    staff,
    signIn,
    workspace,
    workspaces,
    social,
    posts,
    path,
    upload,
    connect,
    readyPost,
    act,
    edit,
    createWorkspace,
    setStaleStatus: (status: Post['status'] | null) => {
      staleStatus = status;
    },
  };
}

describe('post content', () => {
  it('creates a draft with media and accounts resolved in order', async () => {
    const { owner, path, upload, connect } = await setup();
    const video = await upload(mp4File(), 'clip.mp4');
    const photo = await upload(pngFile(1200, 800), 'photo.png');
    const page = await connect('facebook', { name: 'Bloom Page' });

    const post = postOf(
      await owner.post(path(), {
        title: '  Summer menu  ',
        caption: 'Hello',
        platforms: ['facebook'],
        mediaIds: [photo.id, video.id, photo.id],
        socialAccountIds: [page.id],
      }),
    );
    expect(post).toMatchObject({
      status: 'draft',
      title: 'Summer menu',
      mediaIds: [photo.id, video.id],
      socialAccountIds: [page.id],
      createdBy: owner.user.id,
      updatedBy: owner.user.id,
      scheduledAt: null,
      reviewEvents: [],
    });
    expect(post.media.map((m) => [m.id, m.kind, m.width])).toEqual([
      [photo.id, 'image', 1200],
      [video.id, 'video', null],
    ]);
    expect(post.socialAccounts).toEqual([
      {
        id: page.id,
        platform: 'facebook',
        name: 'Bloom Page',
        username: null,
        status: 'connected',
      },
    ]);
    // Facebook allows one video or photos only.
    expect(post.readiness.ready).toBe(false);
    expect(post.readiness.issues.map((i) => i.message)).toContain(
      'Facebook posts can have one video, or photos only, not both.',
    );
  });

  it('saves a title-only or media-only draft, but not an empty one', async () => {
    const { owner, path, upload } = await setup();
    expect((await owner.post(path(), { title: 'Idea for Friday' })).status).toBe(201);
    const photo = await upload(jpegFile(), 'a.jpg');
    expect((await owner.post(path(), { mediaIds: [photo.id] })).status).toBe(201);
    const empty = await owner.post(path(), { title: ' ', caption: ' ' });
    expect(empty.status).toBe(400);
    expect(errorOf(empty).details?.map((d) => d.path)).toContain('body.caption');
  });

  it('refuses media and accounts from another workspace, and accounts on unselected platforms', async () => {
    const { owner, path, upload, connect, signIn, createWorkspace, posts } = await setup();
    const grace = await signIn('Grace');
    const theirs = await createWorkspace(grace, 'Grace Co');
    const theirPhoto = await upload(jpegFile(), 'x.jpg', theirs.id, grace);
    const theirAccount = await connect('facebook', { workspaceId: theirs.id });
    const ourInstagram = await connect('instagram');

    const foreignMedia = await owner.post(path(), { title: 'x', mediaIds: [theirPhoto.id] });
    expect(foreignMedia.status).toBe(400);
    expect(errorOf(foreignMedia).details).toEqual([
      { path: 'body.mediaIds.0', message: 'Media not found' },
    ]);
    const foreignAccount = await owner.post(path(), {
      title: 'x',
      platforms: ['facebook'],
      socialAccountIds: [theirAccount.id],
    });
    expect(errorOf(foreignAccount).details).toEqual([
      { path: 'body.socialAccountIds.0', message: 'Account not found' },
    ]);
    const wrongPlatform = await owner.post(path(), {
      title: 'x',
      platforms: ['facebook'],
      socialAccountIds: [ourInstagram.id],
    });
    expect(errorOf(wrongPlatform).details?.[0]?.message).toBe(
      'Select Instagram to post to this Instagram account',
    );
    expect(posts.store.posts).toEqual([]);
  });

  it.each([
    ['a status', { status: 'approved' }],
    ['an author', { createdBy: '0'.repeat(24) }],
    ['review events', { reviewEvents: [] }],
    ['a workspace', { workspaceId: '0'.repeat(24) }],
    ['a schedule', { scheduledAt: new Date().toISOString() }],
    ['nothing', {}],
    [
      'too many media items',
      { mediaIds: Array.from({ length: 11 }, (_, i) => i.toString(16).padStart(24, '0')) },
    ],
  ])('rejects an edit that sends %s', async (_label, body) => {
    const { owner, path } = await setup();
    const post = postOf(await owner.post(path(), { title: 'Draft' }));
    // With a valid revision, so each case fails for its own reason.
    const response = await owner.patch(path(`/${post.id}`), { revision: post.revision, ...body });
    expect(response.status).toBe(400);
  });

  it('edits, attaches and removes media, recording the editor', async () => {
    const { owner, staff, path, upload, edit } = await setup();
    const post = postOf(await owner.post(path(), { title: 'Draft' }));
    const photo = await upload(jpegFile(), 'a.jpg');

    const edited = postOf(
      await edit(staff, post, { caption: 'New caption', mediaIds: [photo.id] }),
    );
    expect(edited).toMatchObject({
      title: 'Draft',
      caption: 'New caption',
      mediaIds: [photo.id],
      updatedBy: staff.user.id,
      createdBy: owner.user.id,
    });
    const removed = postOf(await edit(owner, post, { mediaIds: [] }));
    expect(removed.media).toEqual([]);
    expect(postOf(await owner.get(path(`/${post.id}`))).caption).toBe('New caption');
  });

  it('keeps references to deleted accounts but reports them', async () => {
    const { owner, path, connect, social, workspace, edit } = await setup();
    const page = await connect('facebook');
    const post = postOf(
      await owner.post(path(), {
        caption: 'Hi',
        platforms: ['facebook'],
        socialAccountIds: [page.id],
      }),
    );
    await social.accounts.remove(workspace.id, page.id);

    const reloaded = postOf(await owner.get(path(`/${post.id}`)));
    expect(reloaded.socialAccountIds).toEqual([page.id]);
    expect(reloaded.socialAccounts).toEqual([]);
    expect(reloaded.readiness.issues.map((i) => i.message)).toContain(
      'A selected account is no longer connected. Remove it.',
    );
    // Other changes can still be saved.
    expect((await edit(owner, post, { caption: 'Hello' })).status).toBe(200);
  });

  it('lists with status, platform and text filters, newest first, with pagination', async () => {
    const { owner, path, readyPost, act } = await setup();
    await owner.post(path(), { title: 'Facebook only', platforms: ['facebook'] });
    await owner.post(path(), { title: 'Weekend special', caption: 'Pastries' });
    const ready = await readyPost();
    await act(owner, ready, 'submit');

    const titles = async (query: string) =>
      postListResponseSchema
        .parse((await owner.get(path(`?${query}`))).body)
        .posts.map((p) => p.title);
    expect(await titles('')).toEqual(['Croissant launch', 'Weekend special', 'Facebook only']);
    expect(await titles('status=awaiting_approval')).toEqual(['Croissant launch']);
    expect(await titles('platform=facebook')).toEqual(['Croissant launch', 'Facebook only']);
    expect(await titles('platform=instagram')).toEqual(['Croissant launch']);
    expect(await titles('q=PASTR')).toEqual(['Weekend special']);
    expect(await titles('q=(')).toEqual([]);

    const first = postListResponseSchema.parse((await owner.get(path('?limit=2'))).body);
    const second = postListResponseSchema.parse(
      (await owner.get(path(`?limit=2&before=${first.nextCursor}`))).body,
    );
    expect(second.posts.map((p) => p.title)).toEqual(['Facebook only']);
    expect(second.nextCursor).toBeNull();
    expect((await owner.get(path('?status=unknown'))).status).toBe(400);
  });

  it('duplicates as a new draft without copying files or approval', async () => {
    const { owner, staff, path, readyPost, act } = await setup();
    const original = await readyPost();
    await act(owner, original, 'submit');
    await act(owner, original, 'approve');

    const copy = postOf(await staff.post(path(`/${original.id}/duplicate`)));
    expect(copy).toMatchObject({
      status: 'draft',
      title: 'Croissant launch (copy)',
      caption: original.caption,
      mediaIds: original.mediaIds,
      socialAccountIds: original.socialAccountIds,
      reviewEvents: [],
      createdBy: staff.user.id,
      source: 'manual',
      generationId: null,
    });
    expect(copy.id).not.toBe(original.id);
    expect(postOf(await owner.get(path(`/${original.id}`))).status).toBe('approved');
  });
});

describe('approval workflow', () => {
  it('runs submit → request changes → submit → approve → reopen, recording each step', async () => {
    const { owner, staff, readyPost, act, edit } = await setup();
    const post = await readyPost(staff);

    expect(postOf(await act(staff, post, 'submit')).status).toBe('awaiting_approval');
    const changes = postOf(await act(owner, post, 'request_changes', 'Add the price'));
    expect(changes.status).toBe('changes_requested');
    // Editable again while changes are requested.
    expect((await edit(staff, post, { caption: 'Croissants, €2' })).status).toBe(200);
    await act(staff, post, 'submit');
    const approved = postOf(await act(owner, post, 'approve'));
    expect(approved.status).toBe('approved');
    expect(approved.reviewEvents.map((e) => [e.action, e.by, e.note])).toEqual([
      ['submit', staff.user.id, null],
      ['request_changes', owner.user.id, 'Add the price'],
      ['submit', staff.user.id, null],
      ['approve', owner.user.id, null],
    ]);
    expect(approved.reviewEvents.every((e) => !Number.isNaN(Date.parse(e.at)))).toBe(true);

    const reopened = postOf(await act(staff, post, 'reopen'));
    expect(reopened.status).toBe('draft');
    expect(reopened.reviewEvents.at(-1)).toMatchObject({ action: 'reopen', by: staff.user.id });
  });

  it('never lets staff approve or request changes', async () => {
    const { staff, readyPost, act } = await setup();
    const post = await readyPost(staff);
    await act(staff, post, 'submit');
    for (const action of ['approve', 'request_changes']) {
      const response = await act(staff, post, action);
      expect(response.status).toBe(403);
      expect(errorOf(response).code).toBe('PERMISSION_DENIED');
    }
  });

  it('lets an owner approve their own submission, and records it', async () => {
    const { owner, readyPost, act } = await setup();
    const post = await readyPost();
    await act(owner, post, 'submit');
    const approved = postOf(await act(owner, post, 'approve'));
    expect(approved.reviewEvents.map((e) => [e.action, e.by])).toEqual([
      ['submit', owner.user.id],
      ['approve', owner.user.id],
    ]);
  });

  it('lets only the submitter or an owner withdraw', async () => {
    const { owner, staff, signIn, workspaces, workspace, readyPost, act } = await setup();
    const other = await signIn('Taylor');
    await workspaces.addMember(workspace.id, other.user.id, 'staff');
    const post = await readyPost(staff);
    await act(staff, post, 'submit');

    expect((await act(other, post, 'withdraw')).status).toBe(403);
    expect(postOf(await act(staff, post, 'withdraw')).status).toBe('draft');
    await act(staff, post, 'submit');
    expect(postOf(await act(owner, post, 'withdraw')).status).toBe('draft');
  });

  it.each([
    ['approve a draft', [], 'approve'],
    ['withdraw a draft', [], 'withdraw'],
    ['reopen a draft', [], 'reopen'],
    ['submit twice', ['submit'], 'submit'],
    ['request changes on an approved post', ['submit', 'approve'], 'request_changes'],
  ])('refuses to %s', async (_label, steps, action) => {
    const { owner, readyPost, act } = await setup();
    const post = await readyPost();
    for (const step of steps) await act(owner, post, step);
    const response = await act(owner, post, action);
    expect(response.status).toBe(409);
    expect(errorOf(response).code).toBe('INVALID_TRANSITION');
  });

  it('locks the content while awaiting approval or approved', async () => {
    const { owner, readyPost, act, edit } = await setup();
    const post = await readyPost();
    await act(owner, post, 'submit');
    const locked = await edit(owner, post, { caption: 'Sneaky edit' });
    expect(locked.status).toBe(409);
    expect(errorOf(locked).message).toMatch(/Withdraw it before editing/);
    await act(owner, post, 'approve');
    expect(errorOf(await edit(owner, post, { caption: 'x' })).message).toMatch(
      /Reopen it before editing/,
    );
  });

  it('refuses to submit or approve a post that breaks its platform rules', async () => {
    const { owner, path, upload, connect, act } = await setup();
    const instagram = await connect('instagram');
    const webm = await upload(webmFile(), 'clip.webm');
    const post = postOf(
      await owner.post(path(), {
        caption: 'Watch this',
        platforms: ['instagram', 'facebook'],
        mediaIds: [webm.id],
        socialAccountIds: [instagram.id],
      }),
    );
    expect(post.readiness.ready).toBe(false);

    const response = await act(owner, post, 'submit');
    expect(response.status).toBe(422);
    expect(errorOf(response).code).toBe('POST_NOT_READY');
    const details = errorOf(response).details ?? [];
    const messageAt = (path: string) => details.find((detail) => detail.path === path)?.message;
    expect(messageAt('facebook.socialAccounts')).toMatch(/Select a Facebook account/);
    expect(messageAt('instagram.media')).toMatch(/must be MP4/);
    expect(messageAt('facebook.media')).toMatch(/must be MP4/);
    expect(postOf(await owner.get(path(`/${post.id}`))).status).toBe('draft');
  });

  it('rechecks readiness at approval: a disconnected account blocks it', async () => {
    const { owner, readyPost, act, social, workspace } = await setup();
    const post = await readyPost();
    await act(owner, post, 'submit');
    const [account] = post.socialAccounts;
    await social.accounts.update(workspace.id, account?.id ?? '', { status: 'needs_reconnect' });
    const response = await act(owner, post, 'approve');
    expect(response.status).toBe(422);
    expect(errorOf(response).details?.[0]?.message).toMatch(/needs to be reconnected/);
  });

  it('lets only one of two simultaneous approvals win', async () => {
    const { owner, readyPost, act } = await setup();
    const post = await readyPost();
    await act(owner, post, 'submit');
    const results = await Promise.all([
      act(owner, post, 'approve'),
      act(owner, post, 'request_changes', 'No'),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });

  it('refuses a transition when the status changed after it was read (compare-and-set)', async () => {
    const { owner, readyPost, act, path, setStaleStatus, posts } = await setup({
      staleReads: true,
    });
    const post = await readyPost();
    await act(owner, post, 'submit');
    await act(owner, post, 'approve');
    // This request still sees "awaiting approval"; the stored post is already approved.
    setStaleStatus('awaiting_approval');
    const response = await act(owner, post, 'request_changes', 'Too late');
    expect(response.status).toBe(409);
    expect(errorOf(response).message).toMatch(/changed by someone else/);
    setStaleStatus(null);
    expect(postOf(await owner.get(path(`/${post.id}`))).status).toBe('approved');
    expect(posts.store.posts[0]?.reviewEvents.map((e) => e.action)).toEqual(['submit', 'approve']);
  });

  it('refuses an edit when the post was submitted after it was read', async () => {
    const { owner, readyPost, act, path, setStaleStatus, edit } = await setup({ staleReads: true });
    const post = await readyPost();
    await act(owner, post, 'submit');
    setStaleStatus('draft');
    const response = await edit(owner, post, { caption: 'Edited too late' });
    expect(response.status).toBe(409);
    setStaleStatus(null);
    expect(postOf(await owner.get(path(`/${post.id}`))).caption).toBe(post.caption);
  });

  it('rejects unknown actions and over-long notes', async () => {
    const { owner, readyPost, act } = await setup();
    const post = await readyPost();
    expect((await act(owner, post, 'publish')).status).toBe(400);
    await act(owner, post, 'submit');
    expect((await act(owner, post, 'request_changes', 'x'.repeat(501))).status).toBe(400);
  });
});

describe('post deletion and access', () => {
  it('lets owners delete any post and staff only their own editable posts', async () => {
    const { owner, staff, path, readyPost, act } = await setup();
    const ownersDraft = postOf(await owner.post(path(), { title: 'Owner draft' }));
    const staffDraft = postOf(await staff.post(path(), { title: 'Staff draft' }));
    const staffSubmitted = await readyPost(staff);
    await act(staff, staffSubmitted, 'submit');

    expect((await staff.delete(path(`/${ownersDraft.id}`))).status).toBe(403);
    expect((await staff.delete(path(`/${staffSubmitted.id}`))).status).toBe(403);
    expect((await staff.delete(path(`/${staffDraft.id}`))).status).toBe(204);
    expect((await owner.delete(path(`/${staffSubmitted.id}`))).status).toBe(204);
    expect((await owner.delete(path(`/${ownersDraft.id}`))).status).toBe(204);
    expect((await owner.get(path(`/${ownersDraft.id}`))).status).toBe(404);
  });

  it('answers 404 to non-members on every route, and 401 without a session', async () => {
    const { app, owner, path, signIn, createWorkspace, edit } = await setup();
    const post = postOf(await owner.post(path(), { title: 'Private' }));
    const mallory = await signIn('Mallory');
    const theirs = await createWorkspace(mallory, 'Mallory Co');

    expect((await mallory.get(path(`/${post.id}`))).status).toBe(404);
    expect((await edit(mallory, post, { title: 'x' })).status).toBe(404);
    expect((await mallory.delete(path(`/${post.id}`))).status).toBe(404);
    expect((await mallory.post(path(`/${post.id}/duplicate`))).status).toBe(404);
    expect(
      (await mallory.post(path(`/${post.id}/workflow`), { action: 'submit', revision: 0 })).status,
    ).toBe(404);
    // Their own workspace with our post ID.
    expect((await mallory.get(path(`/${post.id}`, theirs.id))).status).toBe(404);
    expect((await mallory.post(path(`/${post.id}/duplicate`, theirs.id))).status).toBe(404);
    expect((await request(app).get(path(`/${post.id}`))).status).toBe(401);
  });

  it('makes posts of an archived workspace unreachable', async () => {
    const { owner, path, workspace, edit } = await setup();
    const post = postOf(await owner.post(path(), { title: 'Before archiving' }));
    await owner.post(`/api/workspaces/${workspace.id}/archive`, { confirmName: workspace.name });
    expect((await owner.get(path())).status).toBe(404);
    expect((await owner.get(path(`/${post.id}`))).status).toBe(404);
    expect((await edit(owner, post, { title: 'x' })).status).toBe(404);
    expect((await owner.get(`/api/workspaces/${workspace.id}/media`)).status).toBe(404);
  });
});
