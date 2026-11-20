import {
  MAX_OWNED_WORKSPACES,
  apiErrorResponseSchema,
  workspaceListResponseSchema,
  workspaceMemberListResponseSchema,
  workspaceResponseSchema,
} from '@metaflow/shared';
import request, { type Response } from 'supertest';
import { describe, expect, it } from 'vitest';
import { hashPassword } from '../src/utils/password';
import { generateSessionToken, hashSessionToken } from '../src/utils/session-token';
import { FRONTEND_ORIGIN, buildTestApp } from './helpers';
import { createInMemoryAuthRepositories } from './support/in-memory-auth-repositories';
import { createInMemoryWorkspaceRepository } from './support/in-memory-workspace-repository';

const errorOf = (response: Response) => apiErrorResponseSchema.parse(response.body).error;
const UNKNOWN_ID = 'f'.repeat(24);

/** An app with real auth and workspace services on in-memory repositories. */
async function setup() {
  const auth = createInMemoryAuthRepositories();
  const workspaces = createInMemoryWorkspaceRepository(auth.users);
  const app = buildTestApp({ authRepositories: auth, workspaceRepository: workspaces });
  // One cheap hash for all users: sessions are created directly, not through login.
  const passwordHash = await hashPassword('irrelevant', {
    N: 16,
    r: 1,
    p: 1,
    keyLength: 32,
    saltLength: 16,
  });

  /** Creates a user with a live session and returns an agent-like helper bound to their cookie. */
  async function signIn(name: string) {
    const user = await auth.users.create({
      name,
      email: `${name.toLowerCase()}@example.com`,
      passwordHash,
    });
    const token = generateSessionToken();
    await auth.sessions.create({
      userId: user.id,
      tokenHash: hashSessionToken(token),
      expiresAt: new Date(Date.now() + 60_000),
    });
    const cookie = `metaflow_session=${token}`;
    return {
      user,
      get: (path: string) => request(app).get(path).set('Cookie', cookie),
      post: (path: string, body?: object) =>
        request(app).post(path).set('Cookie', cookie).set('Origin', FRONTEND_ORIGIN).send(body),
      patch: (path: string, body?: object) =>
        request(app).patch(path).set('Cookie', cookie).set('Origin', FRONTEND_ORIGIN).send(body),
    };
  }

  type Client = Awaited<ReturnType<typeof signIn>>;
  async function createWorkspace(client: Client, body: object = { name: 'Bloom Bakery' }) {
    const response = await client.post('/api/workspaces', body);
    expect(response.status).toBe(201);
    return workspaceResponseSchema.parse(response.body).workspace;
  }

  return { app, auth, workspaces, signIn, createWorkspace };
}

describe('workspaces: authentication', () => {
  it.each([
    ['get', '/api/workspaces'],
    ['post', '/api/workspaces'],
    ['get', `/api/workspaces/${UNKNOWN_ID}`],
    ['patch', `/api/workspaces/${UNKNOWN_ID}`],
    ['post', `/api/workspaces/${UNKNOWN_ID}/archive`],
    ['get', `/api/workspaces/${UNKNOWN_ID}/members`],
  ] as const)('%s %s needs a session', async (method, path) => {
    const { app } = await setup();
    const response = await request(app)[method](path).send({ name: 'X' });
    expect(response.status).toBe(401);
    expect(errorOf(response).code).toBe('UNAUTHENTICATED');
  });

  it('refuses a workspace created from an origin that is not allowed (CSRF)', async () => {
    const { app, signIn, workspaces } = await setup();
    await signIn('Ada');
    const response = await request(app)
      .post('/api/workspaces')
      .set('Origin', 'https://evil.example')
      .send({ name: 'X' });
    expect(response.status).toBe(403);
    expect(workspaces.store.workspaces.size).toBe(0);
  });
});

describe('workspaces: create and list', () => {
  it('creates a workspace with the caller as owner and sensible defaults', async () => {
    const { signIn, workspaces } = await setup();
    const ada = await signIn('Ada');

    const response = await ada.post('/api/workspaces', { name: '  Bloom Bakery  ' });

    expect(response.status).toBe(201);
    expect(response.headers['cache-control']).toBe('no-store');
    const { workspace } = workspaceResponseSchema.parse(response.body);
    expect(workspace).toMatchObject({
      name: 'Bloom Bakery',
      description: '',
      category: 'other',
      timezone: 'UTC',
      defaultLanguage: 'en',
      status: 'active',
      role: 'owner',
    });
    expect(workspaces.store.memberships).toEqual([
      expect.objectContaining({ workspaceId: workspace.id, userId: ada.user.id, role: 'owner' }),
    ]);
  });

  it('stores the business profile', async () => {
    const { signIn, createWorkspace } = await setup();
    const workspace = await createWorkspace(await signIn('Ada'), {
      name: 'Bloom Bakery',
      description: 'Sourdough and pastries in Lahore.',
      category: 'restaurant',
      timezone: 'Asia/Karachi',
      defaultLanguage: 'ur',
    });
    expect(workspace).toMatchObject({
      description: 'Sourdough and pastries in Lahore.',
      category: 'restaurant',
      timezone: 'Asia/Karachi',
      defaultLanguage: 'ur',
    });
  });

  it('never takes the owner from the request body', async () => {
    const { signIn, workspaces } = await setup();
    const ada = await signIn('Ada');
    const grace = await signIn('Grace');

    await ada.post('/api/workspaces', {
      name: 'Mine',
      ownerId: grace.user.id,
      userId: grace.user.id,
      createdBy: grace.user.id,
      role: 'staff',
    });

    expect(workspaces.store.memberships).toEqual([
      expect.objectContaining({ userId: ada.user.id, role: 'owner' }),
    ]);
    expect([...workspaces.store.workspaces.values()][0]?.createdBy).toBe(ada.user.id);
  });

  it.each([
    ['missing name', {}, 'body.name'],
    ['blank name', { name: '   ' }, 'body.name'],
    ['name too long', { name: 'x'.repeat(81) }, 'body.name'],
    ['unknown category', { name: 'A', category: 'casino' }, 'body.category'],
    ['unknown time zone', { name: 'A', timezone: 'Mars/Olympus' }, 'body.timezone'],
    ['unknown language', { name: 'A', defaultLanguage: 'xx' }, 'body.defaultLanguage'],
    ['description too long', { name: 'A', description: 'x'.repeat(1001) }, 'body.description'],
  ])('rejects invalid input (%s)', async (_label, body, path) => {
    const { signIn, workspaces } = await setup();
    const response = await (await signIn('Ada')).post('/api/workspaces', body);
    expect(response.status).toBe(400);
    expect(errorOf(response).details?.map((issue) => issue.path)).toContain(path);
    expect(workspaces.store.workspaces.size).toBe(0);
  });

  it('lists only the workspaces the caller belongs to, with their role in each', async () => {
    const { signIn, createWorkspace, workspaces } = await setup();
    const ada = await signIn('Ada');
    const grace = await signIn('Grace');
    const adaFirst = await createWorkspace(ada, { name: 'Ada One' });
    const adaSecond = await createWorkspace(ada, { name: 'Ada Two' });
    const graceOnly = await createWorkspace(grace, { name: 'Grace Only' });
    await workspaces.addMember(adaSecond.id, grace.user.id, 'staff');

    const adaList = workspaceListResponseSchema.parse((await ada.get('/api/workspaces')).body);
    expect(adaList.workspaces.map((w) => [w.id, w.role])).toEqual([
      [adaFirst.id, 'owner'],
      [adaSecond.id, 'owner'],
    ]);

    const graceList = workspaceListResponseSchema.parse((await grace.get('/api/workspaces')).body);
    expect(graceList.workspaces.map((w) => [w.id, w.role])).toEqual([
      [adaSecond.id, 'staff'],
      [graceOnly.id, 'owner'],
    ]);
  });

  it(`stops at ${MAX_OWNED_WORKSPACES} owned workspaces and frees a slot when one is archived`, async () => {
    const { signIn, createWorkspace } = await setup();
    const ada = await signIn('Ada');
    const created = [];
    for (let i = 0; i < MAX_OWNED_WORKSPACES; i += 1) {
      created.push(await createWorkspace(ada, { name: `Workspace ${i}` }));
    }

    const refused = await ada.post('/api/workspaces', { name: 'One too many' });
    expect(refused.status).toBe(409);
    expect(errorOf(refused).code).toBe('LIMIT_REACHED');

    const first = created[0];
    await ada.post(`/api/workspaces/${first?.id}/archive`, { confirmName: first?.name });
    expect((await ada.post('/api/workspaces', { name: 'Fits again' })).status).toBe(201);
  });
});

describe('workspaces: tenant isolation', () => {
  it('answers 404 to a user who is not a member, exactly as for a workspace that does not exist', async () => {
    const { signIn, createWorkspace, workspaces } = await setup();
    const ada = await signIn('Ada');
    const mallory = await signIn('Mallory');
    const workspace = await createWorkspace(ada, { name: 'Private Plans' });
    const before = { ...workspaces.store.workspaces.get(workspace.id) };

    const attempts = (id: string) => [
      mallory.get(`/api/workspaces/${id}`),
      mallory.patch(`/api/workspaces/${id}`, { name: 'Hacked' }),
      mallory.post(`/api/workspaces/${id}/archive`, { confirmName: 'Private Plans' }),
      mallory.get(`/api/workspaces/${id}/members`),
    ];
    const real = await Promise.all(attempts(workspace.id));
    const missing = await Promise.all(attempts(UNKNOWN_ID));

    for (const [index, response] of real.entries()) {
      expect(response.status).toBe(404);
      expect(errorOf(response).code).toBe('NOT_FOUND');
      expect(errorOf(response).message).toBe(errorOf(missing[index] as Response).message);
      expect(response.text).not.toContain('Private Plans');
    }
    expect(workspaces.store.workspaces.get(workspace.id)).toEqual(before);
  });

  it('ignores a workspace ID smuggled into the body', async () => {
    const { signIn, createWorkspace, workspaces } = await setup();
    const ada = await signIn('Ada');
    const mallory = await signIn('Mallory');
    const target = await createWorkspace(ada, { name: 'Target' });
    const own = await createWorkspace(mallory, { name: 'Own' });

    const response = await mallory.patch(`/api/workspaces/${own.id}`, {
      name: 'Renamed',
      workspaceId: target.id,
      id: target.id,
    });

    expect(response.status).toBe(400); // unknown fields are rejected outright
    expect(workspaces.store.workspaces.get(target.id)?.name).toBe('Target');
    expect(workspaces.store.workspaces.get(own.id)?.name).toBe('Own');
  });

  it.each(['not-an-id', '123', '{"$ne":null}', 'a'.repeat(25)])(
    'rejects the malformed workspace ID %j before any lookup',
    async (id) => {
      const { signIn } = await setup();
      const response = await (await signIn('Ada')).get(`/api/workspaces/${encodeURIComponent(id)}`);
      expect(response.status).toBe(400);
      expect(errorOf(response).code).toBe('VALIDATION_ERROR');
    },
  );
});

describe('workspaces: roles', () => {
  async function ownerAndStaff() {
    const context = await setup();
    const owner = await context.signIn('Olivia');
    const staff = await context.signIn('Sam');
    const workspace = await context.createWorkspace(owner, { name: 'Bloom Bakery' });
    await context.workspaces.addMember(workspace.id, staff.user.id, 'staff');
    return { ...context, owner, staff, workspace };
  }

  it('lets the owner edit the business profile, changing only the fields sent', async () => {
    const { owner, workspace } = await ownerAndStaff();

    const response = await owner.patch(`/api/workspaces/${workspace.id}`, {
      name: 'Bloom Bakery & Café',
      timezone: 'Asia/Karachi',
    });

    expect(response.status).toBe(200);
    expect(workspaceResponseSchema.parse(response.body).workspace).toMatchObject({
      id: workspace.id,
      name: 'Bloom Bakery & Café',
      timezone: 'Asia/Karachi',
      category: 'other',
      role: 'owner',
    });
  });

  it('lets staff view the workspace and its members', async () => {
    const { owner, staff, workspace } = await ownerAndStaff();

    const detail = await staff.get(`/api/workspaces/${workspace.id}`);
    expect(workspaceResponseSchema.parse(detail.body).workspace.role).toBe('staff');

    const members = await staff.get(`/api/workspaces/${workspace.id}/members`);
    expect(workspaceMemberListResponseSchema.parse(members.body).members).toEqual([
      expect.objectContaining({ userId: owner.user.id, name: 'Olivia', role: 'owner' }),
      expect.objectContaining({ userId: staff.user.id, name: 'Sam', role: 'staff' }),
    ]);
    expect(members.text).not.toMatch(/passwordHash|scrypt/);
  });

  it('refuses owner-only actions to staff with 403 PERMISSION_DENIED and changes nothing', async () => {
    const { staff, workspace, workspaces } = await ownerAndStaff();

    const edit = await staff.patch(`/api/workspaces/${workspace.id}`, { name: 'Staff Was Here' });
    const archive = await staff.post(`/api/workspaces/${workspace.id}/archive`, {
      confirmName: 'Bloom Bakery',
    });

    for (const response of [edit, archive]) {
      expect(response.status).toBe(403);
      expect(errorOf(response).code).toBe('PERMISSION_DENIED');
    }
    expect(workspaces.store.workspaces.get(workspace.id)).toMatchObject({
      name: 'Bloom Bakery',
      status: 'active',
    });
  });

  it('does not let anyone change their own role or the workspace status through an update', async () => {
    const { owner, staff, workspace, workspaces } = await ownerAndStaff();
    for (const body of [{ role: 'owner' }, { status: 'archived' }, { createdBy: staff.user.id }]) {
      expect((await owner.patch(`/api/workspaces/${workspace.id}`, body)).status).toBe(400);
      expect((await staff.patch(`/api/workspaces/${workspace.id}`, body)).status).toBe(400);
    }
    expect(workspaces.store.memberships.find((m) => m.userId === staff.user.id)?.role).toBe(
      'staff',
    );
  });
});

describe('workspaces: archive', () => {
  it('needs the exact workspace name as confirmation', async () => {
    const { signIn, createWorkspace, workspaces } = await setup();
    const ada = await signIn('Ada');
    const workspace = await createWorkspace(ada, { name: 'Bloom Bakery' });

    const wrong = await ada.post(`/api/workspaces/${workspace.id}/archive`, {
      confirmName: 'bloom bakery',
    });
    expect(wrong.status).toBe(400);
    expect(errorOf(wrong).details).toEqual([
      { path: 'body.confirmName', message: 'This does not match the workspace name' },
    ]);
    expect(workspaces.store.workspaces.get(workspace.id)?.status).toBe('active');
  });

  it('hides the archived workspace from everyone but keeps its data', async () => {
    const { signIn, createWorkspace, workspaces } = await setup();
    const ada = await signIn('Ada');
    const workspace = await createWorkspace(ada, { name: 'Bloom Bakery' });

    const archived = await ada.post(`/api/workspaces/${workspace.id}/archive`, {
      confirmName: 'Bloom Bakery',
    });
    expect(archived.status).toBe(204);

    expect(workspaceListResponseSchema.parse((await ada.get('/api/workspaces')).body)).toEqual({
      workspaces: [],
    });
    expect((await ada.get(`/api/workspaces/${workspace.id}`)).status).toBe(404);
    expect((await ada.patch(`/api/workspaces/${workspace.id}`, { name: 'Back' })).status).toBe(404);
    expect(workspaces.store.workspaces.get(workspace.id)).toMatchObject({
      name: 'Bloom Bakery',
      status: 'archived',
    });
    expect(workspaces.store.memberships).toHaveLength(1);
  });
});
