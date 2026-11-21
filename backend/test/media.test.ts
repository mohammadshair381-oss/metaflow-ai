import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  apiErrorResponseSchema,
  mediaListResponseSchema,
  mediaResponseSchema,
  postResponseSchema,
  workspaceResponseSchema,
  type Media,
} from '@metaflow/shared';
import request, { type Response } from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { createLocalMediaStorage } from '../src/storage/local-media-storage';
import type { MediaStorage } from '../src/storage/media-storage';
import { buildTestApp, FRONTEND_ORIGIN, testEnv } from './helpers';
import { createInMemoryAuthRepositories } from './support/in-memory-auth-repositories';
import { createInMemoryMediaRepository } from './support/in-memory-media-repository';
import { createInMemoryPostRepository } from './support/in-memory-post-repository';
import { createInMemoryWorkspaceRepository } from './support/in-memory-workspace-repository';
import {
  gifFile,
  htmlFile,
  jpegFile,
  mp4File,
  pngFile,
  svgFile,
  webmFile,
  webpFile,
} from './support/media-fixtures';
import { signInAs, type SessionClient } from './support/session-client';

const errorOf = (response: Response) => apiErrorResponseSchema.parse(response.body).error;
const directories: string[] = [];
const tempDirectory = async (prefix: string) => {
  const path = await mkdtemp(join(tmpdir(), prefix));
  directories.push(path);
  return path;
};

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true, maxRetries: 3 })),
  );
});

/** Lists every stored file below the storage root, as `<workspace>/<file>`. */
async function storedFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  for (const folder of await readdir(root)) {
    for (const file of await readdir(join(root, folder))) files.push(`${folder}/${file}`);
  }
  return files;
}

async function setup(
  options: { storage?: 'local' | 'none'; env?: NodeJS.ProcessEnv; uploadLimit?: number } = {},
) {
  const root = await tempDirectory('metaflow-media-');
  const uploads = await tempDirectory('metaflow-uploads-');
  const storage: MediaStorage | null =
    options.storage === 'none' ? null : createLocalMediaStorage(root);
  const auth = createInMemoryAuthRepositories();
  const workspaces = createInMemoryWorkspaceRepository(auth.users);
  const media = createInMemoryMediaRepository();
  const posts = createInMemoryPostRepository();
  const app = buildTestApp({
    env: testEnv(options.env),
    authRepositories: auth,
    workspaceRepository: workspaces,
    mediaRepository: media,
    postRepository: posts,
    mediaStorage: storage,
    mediaUploadTempDir: uploads,
    mediaUploadRateLimits: { windowMs: 60_000, limit: options.uploadLimit ?? 1000 },
  });
  const signIn = (name: string) => signInAs(app, auth, name);
  const owner = await signIn('Olivia');
  const createWorkspace = async (client: SessionClient, name: string) =>
    workspaceResponseSchema.parse((await client.post('/api/workspaces', { name })).body).workspace;
  const workspace = await createWorkspace(owner, 'Bloom Bakery');
  const path = (workspaceId = workspace.id) => `/api/workspaces/${workspaceId}/media`;

  const upload = (
    client: SessionClient,
    file: Buffer,
    filename: string,
    {
      contentType = 'application/octet-stream',
      workspaceId = workspace.id,
      fields = {},
    }: { contentType?: string; workspaceId?: string; fields?: Record<string, string> } = {},
  ) => {
    let call = request(app)
      .post(path(workspaceId))
      .set('Cookie', client.cookie)
      .set('Origin', FRONTEND_ORIGIN);
    for (const [name, value] of Object.entries(fields)) call = call.field(name, value);
    return call.attach('file', file, { filename, contentType });
  };
  const uploaded = async (client: SessionClient, file: Buffer, filename: string, extra = {}) => {
    const response = await upload(client, file, filename, extra);
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return mediaResponseSchema.parse(response.body).media;
  };
  const addStaff = async (name = 'Sam') => {
    const staff = await signIn(name);
    await workspaces.addMember(workspace.id, staff.user.id, 'staff');
    return staff;
  };

  return {
    app,
    root,
    uploads,
    media,
    posts,
    workspaces,
    signIn,
    owner,
    workspace,
    createWorkspace,
    path,
    upload,
    uploaded,
    addStaff,
  };
}

describe('media upload', () => {
  it.each([
    ['JPEG', jpegFile(1080, 1350), 'photo.jpg', 'image/jpeg', 'image', 1080, 1350],
    ['PNG', pngFile(640, 480), 'logo.png', 'image/png', 'image', 640, 480],
    ['WebP', webpFile(800, 600), 'banner.webp', 'image/webp', 'image', 800, 600],
    ['GIF', gifFile(320, 240), 'loop.gif', 'image/gif', 'image', 320, 240],
    ['MP4', mp4File(), 'clip.mp4', 'video/mp4', 'video', null, null],
    ['WebM', webmFile(), 'clip.webm', 'video/webm', 'video', null, null],
  ])('stores a %s with its detected metadata', async (_l, file, name, mimeType, kind, w, h) => {
    const { owner, uploaded, root, media, uploads, workspace } = await setup();
    const item = await uploaded(owner, file, name, { fields: { altText: ' Fresh bread ' } });

    expect(item).toMatchObject({
      kind,
      mimeType,
      originalName: name,
      size: file.length,
      width: w,
      height: h,
      durationSeconds: null,
      altText: 'Fresh bread',
      uploadedBy: owner.user.id,
    });
    // The storage key and server paths never reach the client.
    expect(JSON.stringify(item)).not.toMatch(/storageKey|[a-f0-9]{32}\.|metaflow-media/);
    const [stored] = media.store.media;
    expect(stored?.storageKey).toMatch(new RegExp(`^${workspace.id}/[a-f0-9]{32}\\.`));
    expect(await storedFiles(root)).toEqual([stored?.storageKey]);
    expect(await readdir(uploads)).toEqual([]);
  });

  it.each([
    ['an SVG', svgFile(), 'icon.svg', 'image/svg+xml'],
    ['an SVG renamed to .png', svgFile(), 'icon.png', 'image/png'],
    ['HTML renamed to .jpg', htmlFile(), 'photo.jpg', 'image/jpeg'],
    ['HTML', htmlFile(), 'page.html', 'text/html'],
  ])('rejects %s by its content', async (_label, file, name, contentType) => {
    const { owner, upload, root, media, uploads } = await setup();
    const response = await upload(owner, file, name, { contentType });
    expect(response.status).toBe(415);
    expect(errorOf(response).code).toBe('UNSUPPORTED_MEDIA');
    expect(media.store.media).toEqual([]);
    expect(await readdir(root)).toEqual([]);
    expect(await readdir(uploads)).toEqual([]);
  });

  it.each([
    ['a PNG named .jpg', pngFile(), 'photo.jpg', 'image/png'],
    ['a JPEG without an extension', jpegFile(), 'photo', 'image/jpeg'],
    ['a PNG named .exe', pngFile(), 'setup.exe', 'image/png'],
    ['a PNG the browser calls a JPEG', pngFile(), 'photo.png', 'image/jpeg'],
    ['a PNG the browser calls SVG', pngFile(), 'photo.png', 'image/svg+xml'],
  ])('rejects %s', async (_label, file, name, contentType) => {
    const { owner, upload, media } = await setup();
    const response = await upload(owner, file, name, { contentType });
    expect(response.status).toBe(415);
    expect(media.store.media).toEqual([]);
  });

  it('accepts .jpeg as well as .jpg and cleans the displayed name', async () => {
    const { owner, uploaded } = await setup();
    const item = await uploaded(owner, jpegFile(), '../../Bakery\u202E window.jpeg');
    expect(item.originalName).toBe('Bakery window.jpeg');
  });

  it('rejects an empty file and a request without a file', async () => {
    const { owner, upload, path, app } = await setup();
    const empty = await upload(owner, Buffer.alloc(0), 'empty.png');
    expect(empty.status).toBe(400);
    expect(errorOf(empty).message).toMatch(/empty/i);

    const noFile = await request(app)
      .post(path())
      .set('Cookie', owner.cookie)
      .set('Origin', FRONTEND_ORIGIN)
      .field('altText', 'hello');
    expect(noFile.status).toBe(400);

    const json = await owner.post(path(), { file: 'data:image/png;base64,AAAA' });
    expect(json.status).toBe(400);
  });

  it('rejects two files, unknown fields and malformed multipart bodies', async () => {
    const { owner, app, path, uploads, media } = await setup();
    const twoFiles = await request(app)
      .post(path())
      .set('Cookie', owner.cookie)
      .set('Origin', FRONTEND_ORIGIN)
      .attach('file', pngFile(), 'a.png')
      .attach('file', pngFile(), 'b.png');
    expect(twoFiles.status).toBe(400);

    const unknownField = await request(app)
      .post(path())
      .set('Cookie', owner.cookie)
      .set('Origin', FRONTEND_ORIGIN)
      .field('workspaceId', 'someone-else')
      .attach('file', pngFile(), 'a.png');
    expect(unknownField.status).toBe(400);
    expect(errorOf(unknownField).details?.map((d) => d.path)).toContain('body');

    const malformed = await request(app)
      .post(path())
      .set('Cookie', owner.cookie)
      .set('Origin', FRONTEND_ORIGIN)
      .set('Content-Type', 'multipart/form-data; boundary=xyz')
      .send(
        '--xyz\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\n\r\nunterminated',
      );
    expect(malformed.status).toBe(400);

    expect(media.store.media).toEqual([]);
    expect(await readdir(uploads)).toEqual([]);
  });

  it('applies the per-kind size limits after identifying the content', async () => {
    const { owner, upload, media, uploads } = await setup({
      env: { MEDIA_MAX_IMAGE_MB: '1', MEDIA_MAX_VIDEO_MB: '2' },
    });
    const bigImage = await upload(owner, pngFile(10, 10, 1.5 * 1024 * 1024), 'big.png');
    expect(bigImage.status).toBe(413);
    expect(errorOf(bigImage).message).toMatch(/Images can be at most 1\.0 MB/);

    // The same size is fine for a video.
    expect((await upload(owner, mp4File(1.5 * 1024 * 1024), 'clip.mp4')).status).toBe(201);
    expect(media.store.media).toHaveLength(1);
    expect(await readdir(uploads)).toEqual([]);
  });

  it('refuses files above the largest limit while receiving them', async () => {
    const { owner, upload, media, uploads } = await setup({
      env: { MEDIA_MAX_IMAGE_MB: '1', MEDIA_MAX_VIDEO_MB: '1' },
    });
    const response = await upload(owner, mp4File(3 * 1024 * 1024), 'huge.mp4').catch(
      (error: unknown) => error,
    );
    // The server may close the connection before the client finishes sending.
    if (response instanceof Error) expect(response.message).toMatch(/ECONNRESET|EPIPE|socket/i);
    else expect((response as Response).status).toBe(413);
    expect(media.store.media).toEqual([]);
    expect(await readdir(uploads)).toEqual([]);
  });

  it('removes the stored file when saving the record fails', async () => {
    const { owner, upload, media, root } = await setup();
    media.failNextCreate();
    expect((await upload(owner, pngFile(), 'a.png')).status).toBe(500);
    expect(await storedFiles(root)).toEqual([]);
  });

  it('answers 503 when no storage is configured, and still lists the library', async () => {
    const { owner, upload, path } = await setup({ storage: 'none' });
    const response = await upload(owner, pngFile(), 'a.png');
    expect(response.status).toBe(503);
    expect(errorOf(response).code).toBe('INTEGRATION_NOT_CONFIGURED');
    const list = mediaListResponseSchema.parse((await owner.get(path())).body);
    expect(list.limits.uploadsEnabled).toBe(false);
  });

  it('limits uploads per user', async () => {
    const { owner, upload } = await setup({ uploadLimit: 2 });
    expect((await upload(owner, pngFile(), 'a.png')).status).toBe(201);
    expect((await upload(owner, pngFile(), 'b.png')).status).toBe(201);
    expect((await upload(owner, pngFile(), 'c.png')).status).toBe(429);
  });

  it('refuses uploads from non-members, archived workspaces and other origins before storing', async () => {
    const { app, owner, upload, signIn, path, root, uploads, workspace, media } = await setup();
    const mallory = await signIn('Mallory');
    expect((await upload(mallory, pngFile(), 'a.png')).status).toBe(404);

    const foreignOrigin = await request(app)
      .post(path())
      .set('Cookie', owner.cookie)
      .set('Origin', 'https://evil.example')
      .attach('file', pngFile(), 'a.png');
    expect(foreignOrigin.status).toBe(403);

    const anonymous = await request(app)
      .post(path())
      .set('Origin', FRONTEND_ORIGIN)
      .attach('file', pngFile(), 'a.png');
    expect(anonymous.status).toBe(401);

    await owner.post(`/api/workspaces/${workspace.id}/archive`, { confirmName: workspace.name });
    expect((await upload(owner, pngFile(), 'a.png')).status).toBe(404);

    expect(media.store.media).toEqual([]);
    expect(await readdir(root)).toEqual([]);
    expect(await readdir(uploads)).toEqual([]);
  });
});

describe('media library', () => {
  it('lists newest first with pagination, kind filter and search, per workspace', async () => {
    const { owner, uploaded, path, signIn, createWorkspace, upload } = await setup();
    const first = await uploaded(owner, pngFile(), 'storefront.png', {
      fields: { description: 'Our shop window' },
    });
    await uploaded(owner, mp4File(), 'tour.mp4');
    await uploaded(owner, jpegFile(), 'croissant.jpg', { fields: { altText: 'Butter croissant' } });
    const grace = await signIn('Grace');
    const theirs = await createWorkspace(grace, 'Grace Co');
    await upload(grace, pngFile(), 'secret.png', { workspaceId: theirs.id });

    const page1 = mediaListResponseSchema.parse((await owner.get(`${path()}?limit=2`)).body);
    expect(page1.media.map((m) => m.originalName)).toEqual(['croissant.jpg', 'tour.mp4']);
    expect(page1.limits).toEqual({
      imageBytes: 10 * 1024 * 1024,
      videoBytes: 100 * 1024 * 1024,
      uploadsEnabled: true,
    });
    const page2 = mediaListResponseSchema.parse(
      (await owner.get(`${path()}?limit=2&before=${page1.nextCursor}`)).body,
    );
    expect(page2.media.map((m) => m.id)).toEqual([first.id]);
    expect(page2.nextCursor).toBeNull();

    const videos = mediaListResponseSchema.parse((await owner.get(`${path()}?kind=video`)).body);
    expect(videos.media.map((m) => m.originalName)).toEqual(['tour.mp4']);
    const search = async (q: string) =>
      mediaListResponseSchema
        .parse((await owner.get(`${path()}?q=${encodeURIComponent(q)}`)).body)
        .media.map((m) => m.originalName);
    expect(await search('BUTTER')).toEqual(['croissant.jpg']);
    expect(await search('window')).toEqual(['storefront.png']);
    expect(await search('.*')).toEqual([]);
    expect(await search('secret')).toEqual([]);
  });

  it('updates only the alt text and description', async () => {
    const { owner, uploaded, path, addStaff } = await setup();
    const item = await uploaded(owner, pngFile(), 'a.png');
    const staff = await addStaff();

    const response = await staff.patch(`${path()}/${item.id}`, { altText: 'A sunny shop front' });
    expect(response.status).toBe(200);
    expect(mediaResponseSchema.parse(response.body).media).toMatchObject({
      altText: 'A sunny shop front',
      description: '',
      originalName: 'a.png',
    });
    for (const body of [{}, { originalName: 'x.png' }, { mimeType: 'text/html' }, { size: 1 }]) {
      expect((await owner.patch(`${path()}/${item.id}`, body)).status).toBe(400);
    }
    expect((await owner.patch(`${path()}/${item.id}`, { altText: 'x'.repeat(301) })).status).toBe(
      400,
    );
  });

  it('hides other workspaces’ media behind 404 on every route', async () => {
    const { owner, uploaded, signIn, path, workspace, createWorkspace } = await setup();
    const item = await uploaded(owner, pngFile(), 'a.png');
    const mallory = await signIn('Mallory');
    const malloryWorkspace = await createWorkspace(mallory, 'Mallory Co');

    for (const target of [path(), `${path()}/${item.id}`, `${path()}/${item.id}/file`]) {
      expect((await mallory.get(target)).status).toBe(404);
    }
    expect((await mallory.patch(`${path()}/${item.id}`, { altText: 'x' })).status).toBe(404);
    expect((await mallory.delete(`${path()}/${item.id}`)).status).toBe(404);
    // Their own workspace ID with our media ID: still not found.
    const crossPath = `/api/workspaces/${malloryWorkspace.id}/media/${item.id}`;
    expect((await mallory.get(crossPath)).status).toBe(404);
    expect((await mallory.get(`${crossPath}/file`)).status).toBe(404);
    expect((await mallory.delete(crossPath)).status).toBe(404);
    expect((await owner.get(`/api/workspaces/${workspace.id}/media/not-an-id`)).status).toBe(400);
  });
});

describe('media file serving', () => {
  it('streams the file with safe headers', async () => {
    const { owner, uploaded, path } = await setup();
    const file = pngFile(4, 4);
    const item = await uploaded(owner, file, 'Café menu.png');

    const response = await owner.get(`${path()}/${item.id}/file`).buffer(true);
    expect(response.status).toBe(200);
    expect(Buffer.from(response.body as Buffer).equals(file)).toBe(true);
    expect(response.headers).toMatchObject({
      'content-type': 'image/png',
      'content-length': String(file.length),
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
      'cross-origin-resource-policy': 'same-site',
      'cache-control': 'private, max-age=300',
      'accept-ranges': 'bytes',
      'content-disposition': `inline; filename="Caf_ menu.png"; filename*=UTF-8''Caf%C3%A9%20menu.png`,
    });

    const download = await owner.get(`${path()}/${item.id}/file?download=1`);
    expect(download.headers['content-disposition']).toMatch(/^attachment;/);
  });

  it('serves byte ranges for video seeking', async () => {
    const { owner, uploaded, path } = await setup();
    const file = mp4File(1000);
    const item = await uploaded(owner, file, 'clip.mp4');
    const target = `${path()}/${item.id}/file`;

    const partial = await owner.get(target).set('Range', 'bytes=0-9').buffer(true);
    expect(partial.status).toBe(206);
    expect(partial.headers['content-range']).toBe(`bytes 0-9/${file.length}`);
    expect(Buffer.from(partial.body as Buffer).equals(file.subarray(0, 10))).toBe(true);

    const unsatisfiable = await owner.get(target).set('Range', `bytes=${file.length + 10}-`);
    expect(unsatisfiable.status).toBe(416);
    expect(unsatisfiable.headers['content-range']).toBe(`bytes */${file.length}`);

    const malformed = await owner.get(target).set('Range', 'bytes=nonsense');
    expect(malformed.status).toBe(200);
  });

  it('answers 404 when the stored file has gone missing', async () => {
    const { owner, uploaded, path, root, media } = await setup();
    const item = await uploaded(owner, pngFile(), 'a.png');
    await rm(join(root, ...(media.store.media[0]?.storageKey ?? '').split('/')));
    expect((await owner.get(`${path()}/${item.id}/file`)).status).toBe(404);
  });
});

describe('media deletion', () => {
  const attach = async (client: SessionClient, workspaceId: string, item: Media) =>
    postResponseSchema.parse(
      (
        await client.post(`/api/workspaces/${workspaceId}/posts`, {
          title: 'Uses media',
          mediaIds: [item.id],
        })
      ).body,
    ).post;

  it('deletes the record and the file', async () => {
    const { owner, uploaded, path, root, media } = await setup();
    const item = await uploaded(owner, pngFile(), 'a.png');
    expect((await owner.delete(`${path()}/${item.id}`)).status).toBe(204);
    expect(media.store.media).toEqual([]);
    expect(await storedFiles(root)).toEqual([]);
    expect((await owner.get(`${path()}/${item.id}`)).status).toBe(404);
  });

  it('refuses while a post uses the media, and allows it once removed', async () => {
    const { owner, uploaded, path, workspace, root } = await setup();
    const item = await uploaded(owner, pngFile(), 'a.png');
    const post = await attach(owner, workspace.id, item);

    const refused = await owner.delete(`${path()}/${item.id}`);
    expect(refused.status).toBe(409);
    expect(errorOf(refused)).toMatchObject({ code: 'MEDIA_IN_USE' });
    expect(errorOf(refused).message).toMatch(/1 post/);
    expect(await storedFiles(root)).toHaveLength(1);

    await owner.patch(`/api/workspaces/${workspace.id}/posts/${post.id}`, {
      revision: post.revision,
      mediaIds: [],
    });
    expect((await owner.delete(`${path()}/${item.id}`)).status).toBe(204);
  });

  it('never deletes media when a post is deleted or duplicated', async () => {
    const { owner, uploaded, workspace, root, media } = await setup();
    const item = await uploaded(owner, pngFile(), 'a.png');
    const post = await attach(owner, workspace.id, item);
    const posts = `/api/workspaces/${workspace.id}/posts`;

    const copy = postResponseSchema.parse(
      (await owner.post(`${posts}/${post.id}/duplicate`)).body,
    ).post;
    expect(copy.mediaIds).toEqual([item.id]);
    expect(media.store.media).toHaveLength(1);
    expect(await storedFiles(root)).toHaveLength(1);

    expect((await owner.delete(`${posts}/${post.id}`)).status).toBe(204);
    expect((await owner.delete(`${posts}/${copy.id}`)).status).toBe(204);
    expect(media.store.media).toHaveLength(1);
    expect(await storedFiles(root)).toHaveLength(1);
  });

  it('lets staff delete only their own uploads', async () => {
    const { owner, uploaded, path, addStaff } = await setup();
    const staff = await addStaff();
    const ownersItem = await uploaded(owner, pngFile(), 'owner.png');
    const staffItem = await uploaded(staff, pngFile(), 'staff.png');

    const denied = await staff.delete(`${path()}/${ownersItem.id}`);
    expect(denied.status).toBe(403);
    expect(errorOf(denied).code).toBe('PERMISSION_DENIED');
    expect((await staff.delete(`${path()}/${staffItem.id}`)).status).toBe(204);
    expect((await owner.delete(`${path()}/${ownersItem.id}`)).status).toBe(204);
  });
});

describe('workspace logo', () => {
  it('lets the owner choose and remove a library image as the logo', async () => {
    const { owner, uploaded, workspace, path } = await setup();
    const image = await uploaded(owner, pngFile(), 'logo.png');
    const logo = `/api/workspaces/${workspace.id}/logo`;

    const set = await owner.put(logo, { mediaId: image.id });
    expect(set.status).toBe(200);
    expect(workspaceResponseSchema.parse(set.body).workspace.logoMediaId).toBe(image.id);
    expect(
      workspaceResponseSchema.parse((await owner.get(`/api/workspaces/${workspace.id}`)).body)
        .workspace.logoMediaId,
    ).toBe(image.id);

    // In use as the logo: cannot be deleted.
    const refused = await owner.delete(`${path()}/${image.id}`);
    expect(refused.status).toBe(409);
    expect(errorOf(refused).code).toBe('MEDIA_IN_USE');

    const cleared = await owner.put(logo, { mediaId: null });
    expect(workspaceResponseSchema.parse(cleared.body).workspace.logoMediaId).toBeNull();
    // Removing the logo keeps the image in the library.
    expect((await owner.get(`${path()}/${image.id}`)).status).toBe(200);
    expect((await owner.delete(`${path()}/${image.id}`)).status).toBe(204);
  });

  it('refuses staff, videos, other workspaces’ media and unknown IDs', async () => {
    const { owner, uploaded, workspace, addStaff, signIn, createWorkspace, upload } = await setup();
    const image = await uploaded(owner, pngFile(), 'logo.png');
    const video = await uploaded(owner, mp4File(), 'clip.mp4');
    const staff = await addStaff();
    const logo = `/api/workspaces/${workspace.id}/logo`;

    expect((await staff.put(logo, { mediaId: image.id })).status).toBe(403);
    expect((await owner.put(logo, { mediaId: video.id })).status).toBe(415);

    const grace = await signIn('Grace');
    const theirs = await createWorkspace(grace, 'Grace Co');
    const theirImage = mediaResponseSchema.parse(
      (await upload(grace, pngFile(), 'x.png', { workspaceId: theirs.id })).body,
    ).media;
    expect((await owner.put(logo, { mediaId: theirImage.id })).status).toBe(404);
    expect((await grace.put(logo, { mediaId: theirImage.id })).status).toBe(404);
    expect((await owner.put(logo, { mediaId: '0'.repeat(24) })).status).toBe(404);
    expect((await owner.put(logo, { mediaId: 'x' })).status).toBe(400);
    expect((await owner.put(logo, {})).status).toBe(400);
  });
});
