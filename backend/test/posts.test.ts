import {
  apiErrorResponseSchema,
  captionGenerationResponseSchema,
  postListResponseSchema,
  postResponseSchema,
  workspaceResponseSchema,
} from '@metaflow/shared';
import request, { type Response } from 'supertest';
import { describe, expect, it } from 'vitest';
import type { AiProvider } from '../src/integrations/ai/ai-provider';
import { buildTestApp, testEnv } from './helpers';
import { createInMemoryAiRepositories } from './support/in-memory-ai-repositories';
import { createInMemoryAuthRepositories } from './support/in-memory-auth-repositories';
import { createInMemoryPostRepository } from './support/in-memory-post-repository';
import { createInMemoryWorkspaceRepository } from './support/in-memory-workspace-repository';
import { signInAs } from './support/session-client';

const errorOf = (response: Response) => apiErrorResponseSchema.parse(response.body).error;
const provider: AiProvider = {
  id: 'anthropic',
  generate: () =>
    Promise.resolve({
      output: { captions: [{ text: 'Generated caption' }] },
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      model: 'claude-opus-5-5',
    }),
};

async function setup() {
  const auth = createInMemoryAuthRepositories();
  const workspaces = createInMemoryWorkspaceRepository(auth.users);
  const posts = createInMemoryPostRepository();
  const app = buildTestApp({
    env: testEnv({ AI_PROVIDER: 'anthropic', AI_MODEL: 'claude-opus-5-5', AI_API_KEY: 'test-key' }),
    authRepositories: auth,
    workspaceRepository: workspaces,
    aiRepositories: createInMemoryAiRepositories(),
    postRepository: posts,
    aiProvider: provider,
  });
  const signIn = (name: string) => signInAs(app, auth, name);
  const owner = await signIn('Olivia');
  const workspace = workspaceResponseSchema.parse(
    (await owner.post('/api/workspaces', { name: 'Bloom Bakery' })).body,
  ).workspace;
  const path = (workspaceId = workspace.id) => `/api/workspaces/${workspaceId}/posts`;
  const generate = async (client = owner, workspaceId = workspace.id) =>
    captionGenerationResponseSchema.parse(
      (
        await client.post(`/api/workspaces/${workspaceId}/ai/captions`, {
          topic: 'Croissants',
          platform: 'instagram',
          variations: 1,
        })
      ).body,
    ).generation;
  return { app, posts, workspaces, signIn, owner, workspace, path, generate };
}

describe('drafts', () => {
  it('saves an edited AI Studio caption as a draft linked to its generation', async () => {
    const { owner, path, generate } = await setup();
    const generation = await generate();

    const response = await owner.post(path(), {
      caption: '  Edited: Generated caption  ',
      platforms: ['instagram', 'instagram'],
      hashtags: ['#Croissant', 'Bakery', 'Croissant'],
      generationId: generation.id,
    });

    expect(response.status).toBe(201);
    expect(postResponseSchema.parse(response.body).post).toMatchObject({
      status: 'draft',
      caption: 'Edited: Generated caption',
      platforms: ['instagram'],
      hashtags: ['Croissant', 'Bakery'],
      source: 'ai_studio',
      generationId: generation.id,
      createdBy: owner.user.id,
    });
  });

  it('saves a manual draft and lets staff save drafts too', async () => {
    const { owner, path, signIn, workspaces, workspace } = await setup();
    const staff = await signIn('Sam');
    await workspaces.addMember(workspace.id, staff.user.id, 'staff');
    expect(
      postResponseSchema.parse((await owner.post(path(), { caption: 'Hand-written' })).body).post,
    ).toMatchObject({ source: 'manual', generationId: null, platforms: [] });
    expect((await staff.post(path(), { caption: 'From staff' })).status).toBe(201);
  });

  it.each([
    ['empty caption', { caption: '  ' }, 'body.caption'],
    [
      'Instagram caption over 2,200 characters',
      { caption: 'x'.repeat(2201), platforms: ['instagram'] },
      'body.caption',
    ],
    ['caption over 5,000 characters', { caption: 'x'.repeat(5001) }, 'body.caption'],
    ['unknown platform', { caption: 'x', platforms: ['tiktok'] }, 'body.platforms.0'],
    ['invalid hashtag', { caption: 'x', hashtags: ['two words'] }, 'body.hashtags.0'],
    ['a status', { caption: 'x', status: 'published' }, 'body'],
    ['an author', { caption: 'x', createdBy: 'someone' }, 'body'],
    ['a malformed generation ID', { caption: 'x', generationId: 'nope' }, 'body.generationId'],
  ])('rejects %s', async (_label, body, issuePath) => {
    const { owner, path, posts } = await setup();
    const response = await owner.post(path(), body);
    expect(response.status).toBe(400);
    expect(errorOf(response).details?.map((d) => d.path)).toContain(issuePath);
    expect(posts.store.posts).toEqual([]);
  });

  it('allows a long Facebook-only caption', async () => {
    const { owner, path } = await setup();
    expect(
      (await owner.post(path(), { caption: 'x'.repeat(3000), platforms: ['facebook'] })).status,
    ).toBe(201);
  });

  it('refuses a generation from another workspace', async () => {
    const { owner, path, signIn, generate, posts } = await setup();
    const grace = await signIn('Grace');
    const other = workspaceResponseSchema.parse(
      (await grace.post('/api/workspaces', { name: 'Grace Co' })).body,
    ).workspace;
    const theirs = await generate(grace, other.id);

    const response = await owner.post(path(), { caption: 'x', generationId: theirs.id });
    expect(response.status).toBe(404);
    expect(posts.store.posts).toEqual([]);
  });

  it('lists drafts newest first, per workspace, with pagination', async () => {
    const { owner, path, signIn } = await setup();
    for (const caption of ['One', 'Two', 'Three']) await owner.post(path(), { caption });
    const grace = await signIn('Grace');
    const other = workspaceResponseSchema.parse(
      (await grace.post('/api/workspaces', { name: 'Grace Co' })).body,
    ).workspace;
    await grace.post(path(other.id), { caption: 'Not yours' });

    const first = postListResponseSchema.parse((await owner.get(`${path()}?limit=2`)).body);
    expect(first.posts.map((p) => p.caption)).toEqual(['Three', 'Two']);
    const second = postListResponseSchema.parse(
      (await owner.get(`${path()}?limit=2&before=${first.nextCursor}`)).body,
    );
    expect(second.posts.map((p) => p.caption)).toEqual(['One']);
    expect(second.nextCursor).toBeNull();
    expect(
      postListResponseSchema.parse((await owner.get(`${path()}?status=draft`)).body).posts,
    ).toHaveLength(3);
  });

  it('answers 404 to non-members and 401 without a session', async () => {
    const { app, path, signIn } = await setup();
    const mallory = await signIn('Mallory');
    expect((await mallory.get(path())).status).toBe(404);
    expect((await mallory.post(path(), { caption: 'x' })).status).toBe(404);
    expect((await request(app).get(path())).status).toBe(401);
  });
});
