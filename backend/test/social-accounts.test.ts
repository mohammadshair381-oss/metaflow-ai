import { randomBytes } from 'node:crypto';
import {
  META_PERMISSIONS,
  apiErrorResponseSchema,
  connectSocialAccountResponseSchema,
  socialAccountListResponseSchema,
  socialAccountResponseSchema,
  workspaceResponseSchema,
} from '@metaflow/shared';
import request, { type Response } from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import {
  MetaApiError,
  type MetaClient,
  type MetaInstagramAccount,
  type MetaPage,
} from '../src/integrations/meta/meta-client';
import { tokenContext } from '../src/services/social-account.service';
import { createSecretBox } from '../src/utils/secret-box';
import { hashSessionToken } from '../src/utils/session-token';
import { buildTestApp, testEnv } from './helpers';
import { createInMemoryAuthRepositories } from './support/in-memory-auth-repositories';
import { createInMemorySocialRepositories } from './support/in-memory-social-repositories';
import { createInMemoryWorkspaceRepository } from './support/in-memory-workspace-repository';
import { signInAs, type SessionClient } from './support/session-client';

const KEY = randomBytes(32);
const SOCIAL_ENV = {
  META_APP_ID: '1234567890',
  META_APP_SECRET: 'app-secret-value',
  META_REDIRECT_URI: 'http://localhost:3000/api/social/meta/callback',
  SOCIAL_TOKEN_ENCRYPTION_KEYS: KEY.toString('base64'),
};
const CALLBACK = '/api/social/meta/callback';
const UNKNOWN_ID = 'f'.repeat(24);
const errorOf = (response: Response) => apiErrorResponseSchema.parse(response.body).error;

const BAKERY: MetaPage = {
  id: '1001',
  name: 'Bloom Bakery',
  pictureUrl: 'https://cdn.example/1001.jpg',
  accessToken: 'PAGE-TOKEN-1001',
  tasks: ['CREATE_CONTENT', 'MANAGE'],
  instagram: {
    id: '17841400000000001',
    username: 'bloombakery',
    name: 'Bloom Bakery IG',
    pictureUrl: 'https://cdn.example/ig.jpg',
  },
};
const STUDIO: MetaPage = {
  id: '1002',
  name: 'Loom Studio',
  pictureUrl: null,
  accessToken: 'PAGE-TOKEN-1002',
  tasks: ['CREATE_CONTENT'],
  instagram: null,
};
const ALL_PERMISSIONS = [...new Set([...META_PERMISSIONS.facebook, ...META_PERMISSIONS.instagram])];

/** A Meta that answers from memory. Tests replace single methods to simulate failures. */
function fakeMeta(pages: MetaPage[] = [BAKERY, STUDIO]) {
  return {
    authorizationUrl: vi.fn(
      ({ state, scopes }: { state: string; scopes: readonly string[] }) =>
        `https://www.facebook.com/v27.0/dialog/oauth?client_id=1234567890&state=${state}&scope=${scopes.join(',')}`,
    ),
    exchangeCode: vi.fn(() =>
      Promise.resolve({ accessToken: 'SHORT-USER-TOKEN', expiresIn: 3600 }),
    ),
    exchangeForLongLivedToken: vi.fn(() =>
      Promise.resolve({ accessToken: 'LONG-USER-TOKEN', expiresIn: 5_184_000 }),
    ),
    grantedPermissions: vi.fn(() => Promise.resolve(ALL_PERMISSIONS)),
    listPages: vi.fn(() => Promise.resolve(pages)),
    getPage: vi.fn(() =>
      Promise.resolve({ name: 'Bloom Bakery', pictureUrl: null as string | null }),
    ),
    getInstagramAccount: vi.fn((): Promise<MetaInstagramAccount> =>
      Promise.resolve({
        id: BAKERY.instagram?.id ?? '',
        username: 'bloombakery',
        name: null,
        pictureUrl: null,
      }),
    ),
  } satisfies MetaClient;
}

function setup(options: { configured?: boolean; meta?: ReturnType<typeof fakeMeta> } = {}) {
  const auth = createInMemoryAuthRepositories();
  const workspaces = createInMemoryWorkspaceRepository(auth.users);
  const social = createInMemorySocialRepositories();
  const meta = options.meta ?? fakeMeta();
  let clock: Date | undefined;
  const app = buildTestApp({
    env: testEnv(options.configured === false ? {} : SOCIAL_ENV),
    authRepositories: auth,
    workspaceRepository: workspaces,
    socialRepositories: social,
    metaClient: meta,
    now: () => clock ?? new Date(),
  });

  const signIn = (name: string) => signInAs(app, auth, name);
  async function workspaceFor(client: SessionClient, name = 'Bloom Bakery') {
    const response = await client.post('/api/workspaces', { name });
    return workspaceResponseSchema.parse(response.body).workspace;
  }
  const base = (workspaceId: string) => `/api/workspaces/${workspaceId}/social-accounts`;

  /** Starts a connection and returns the state value Meta would send back. */
  async function start(client: SessionClient, workspaceId: string, platform = 'facebook') {
    const response = await client.post(`${base(workspaceId)}/connect`, { platform });
    expect(response.status).toBe(200);
    const { authorizationUrl } = connectSocialAccountResponseSchema.parse(response.body);
    return { authorizationUrl, state: new URL(authorizationUrl).searchParams.get('state') ?? '' };
  }

  /** Follows Meta's redirect back to the API and returns where the browser is sent. */
  async function callback(client: SessionClient | null, query: Record<string, string>) {
    const pending = request(app).get(CALLBACK).query(query);
    const response = await (client ? pending.set('Cookie', client.cookie) : pending);
    expect(response.status).toBe(303);
    const location = new URL(String(response.headers.location));
    return {
      response,
      location,
      result: location.searchParams.get('meta'),
      count: location.searchParams.get('count'),
    };
  }

  /** The full happy path: start, authorize, callback. */
  async function connect(client: SessionClient, workspaceId: string, platform = 'facebook') {
    const { state } = await start(client, workspaceId, platform);
    return callback(client, { code: 'AUTH-CODE', state });
  }

  const list = async (client: SessionClient, workspaceId: string) =>
    socialAccountListResponseSchema.parse((await client.get(base(workspaceId))).body);

  return {
    app,
    auth,
    workspaces,
    social,
    meta,
    signIn,
    workspaceFor,
    base,
    start,
    callback,
    connect,
    list,
    setClock: (date: Date) => (clock = date),
  };
}

/** An owner with a workspace: the starting point of most tests. */
async function ownerSetup(options: Parameters<typeof setup>[0] = {}) {
  const context = setup(options);
  const owner = await context.signIn('Olivia');
  const workspace = await context.workspaceFor(owner);
  return { ...context, owner, workspace };
}

describe('social accounts: integration not configured', () => {
  it('starts safely, lists nothing and says connecting is not set up', async () => {
    const { owner, workspace, list, base, callback, social } = await ownerSetup({
      configured: false,
    });

    expect(await list(owner, workspace.id)).toEqual({
      accounts: [],
      integration: { configured: false },
    });

    const connect = await owner.post(`${base(workspace.id)}/connect`, { platform: 'facebook' });
    expect(connect.status).toBe(503);
    expect(errorOf(connect).code).toBe('INTEGRATION_NOT_CONFIGURED');
    expect(social.store.states.size).toBe(0);

    expect((await callback(owner, { code: 'x', state: 'y' })).result).toBe('not_configured');
  });
});

describe('social accounts: starting a connection', () => {
  it('needs a session', async () => {
    const { app, base, workspace } = await ownerSetup();
    for (const response of [
      await request(app).get(base(workspace.id)),
      await request(app)
        .post(`${base(workspace.id)}/connect`)
        .send({ platform: 'facebook' }),
      await request(app).delete(`${base(workspace.id)}/${UNKNOWN_ID}`),
    ]) {
      expect(response.status).toBe(401);
    }
  });

  it('gives the owner a Facebook authorization URL with an unguessable, hashed-at-rest state', async () => {
    const { owner, workspace, start, social, meta } = await ownerSetup();

    const { authorizationUrl, state } = await start(owner, workspace.id);

    expect(new URL(authorizationUrl).origin).toBe('https://www.facebook.com');
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(meta.authorizationUrl).toHaveBeenCalledWith({
      state,
      scopes: META_PERMISSIONS.facebook,
    });

    const stored = [...social.store.states.values()][0];
    expect(stored).toMatchObject({
      stateHash: hashSessionToken(state),
      userId: owner.user.id,
      workspaceId: workspace.id,
      platform: 'facebook',
      consumedAt: null,
    });
    expect(JSON.stringify(stored)).not.toContain(state);
  });

  it('never issues the same state twice and asks for Instagram permissions when asked', async () => {
    const { owner, workspace, start, meta } = await ownerSetup();
    const first = await start(owner, workspace.id);
    const second = await start(owner, workspace.id, 'instagram');
    expect(first.state).not.toBe(second.state);
    expect(meta.authorizationUrl).toHaveBeenLastCalledWith({
      state: second.state,
      scopes: META_PERMISSIONS.instagram,
    });
  });

  it('rejects an unknown platform', async () => {
    const { owner, workspace, base } = await ownerSetup();
    const response = await owner.post(`${base(workspace.id)}/connect`, { platform: 'tiktok' });
    expect(response.status).toBe(400);
    expect(errorOf(response).details?.[0]?.path).toBe('body.platform');
  });
});

describe('social accounts: OAuth callback', () => {
  it('connects the Facebook Pages the person authorized, to the workspace the flow started in', async () => {
    const { owner, workspace, connect, list, meta } = await ownerSetup();

    const { location, result, count, response } = await connect(owner, workspace.id);

    expect(`${location.origin}${location.pathname}`).toBe('http://localhost:3000/accounts');
    expect([result, count]).toEqual(['connected', '2']);
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(meta.exchangeCode).toHaveBeenCalledWith('AUTH-CODE');
    expect(meta.exchangeForLongLivedToken).toHaveBeenCalledWith('SHORT-USER-TOKEN');
    expect(meta.listPages).toHaveBeenCalledWith('LONG-USER-TOKEN');

    const { accounts, integration } = await list(owner, workspace.id);
    expect(integration.configured).toBe(true);
    expect(accounts).toEqual([
      expect.objectContaining({
        platform: 'facebook',
        externalId: '1001',
        name: 'Bloom Bakery',
        username: null,
        accountType: 'facebook_page',
        profileImageUrl: 'https://cdn.example/1001.jpg',
        status: 'connected',
        issue: null,
        missingPermissions: [],
        tokenExpiresAt: null,
      }),
      expect.objectContaining({ externalId: '1002', name: 'Loom Studio', profileImageUrl: null }),
    ]);
    expect(accounts[0]?.lastSyncedAt).toBe(accounts[0]?.connectedAt);
  });

  it('connects Instagram professional accounts linked to the Pages, and only those', async () => {
    const { owner, workspace, connect, list, social } = await ownerSetup();

    expect((await connect(owner, workspace.id, 'instagram')).count).toBe('1');

    expect((await list(owner, workspace.id)).accounts).toEqual([
      expect.objectContaining({
        platform: 'instagram',
        externalId: '17841400000000001',
        name: 'Bloom Bakery IG',
        username: 'bloombakery',
        accountType: 'instagram_professional',
        profileImageUrl: 'https://cdn.example/ig.jpg',
        status: 'connected',
      }),
    ]);
    expect([...social.store.accounts.values()][0]?.linkedPageId).toBe('1001');
  });

  it('stores tokens encrypted, bound to their record, and keeps no user token', async () => {
    const { owner, workspace, connect, social } = await ownerSetup();
    await connect(owner, workspace.id);

    const stored = [...social.store.accounts.values()];
    const everything = JSON.stringify(stored);
    for (const secret of [
      'PAGE-TOKEN-1001',
      'PAGE-TOKEN-1002',
      'SHORT-USER-TOKEN',
      'LONG-USER-TOKEN',
    ]) {
      expect(everything).not.toContain(secret);
    }
    const box = createSecretBox([KEY]);
    for (const account of stored) {
      expect(account.encryptedToken).toMatch(/^v1\./);
      expect(box.decrypt(account.encryptedToken, tokenContext(account))).toBe(
        `PAGE-TOKEN-${account.externalId}`,
      );
    }
    // A token copied onto the other record does not decrypt there.
    const [first, second] = stored;
    expect(() => box.decrypt(first?.encryptedToken ?? '', tokenContext(second!))).toThrow();
  });

  it('never returns a token, encrypted or not, from any account endpoint', async () => {
    const { owner, workspace, connect, list, base } = await ownerSetup();
    await connect(owner, workspace.id);
    const [account] = (await list(owner, workspace.id)).accounts;

    for (const response of [
      await owner.get(base(workspace.id)),
      await owner.get(`${base(workspace.id)}/${account?.id}`),
      await owner.post(`${base(workspace.id)}/${account?.id}/refresh`),
    ]) {
      expect(response.status).toBe(200);
      expect(response.text).not.toMatch(
        /token"|PAGE-TOKEN|USER-TOKEN|encryptedToken|v1\.[a-f0-9]{8}\./i,
      );
    }
    expect(
      socialAccountResponseSchema.parse(
        (await owner.get(`${base(workspace.id)}/${account?.id}`)).body,
      ).account.id,
    ).toBe(account?.id);
  });

  it('accepts a state only once (replay and authorization-code reuse)', async () => {
    const { owner, workspace, start, callback, meta, social } = await ownerSetup();
    const { state } = await start(owner, workspace.id);

    expect((await callback(owner, { code: 'AUTH-CODE', state })).result).toBe('connected');
    expect((await callback(owner, { code: 'AUTH-CODE', state })).result).toBe('invalid_state');
    expect((await callback(owner, { code: 'OTHER-CODE', state })).result).toBe('invalid_state');

    expect(meta.exchangeCode).toHaveBeenCalledTimes(1);
    expect(social.store.accounts.size).toBe(2);
  });

  it.each([
    ['missing', {}],
    ['malformed', { state: 'not-a-state' }],
    ['unknown', { state: 'A'.repeat(43) }],
    ['an injection attempt', { 'state[$ne]': '' }],
  ])('rejects a %s state without calling Meta', async (_label, query) => {
    const { owner, callback, meta, social } = await ownerSetup();
    expect((await callback(owner, { code: 'AUTH-CODE', ...query })).result).toBe('invalid_state');
    expect(meta.exchangeCode).not.toHaveBeenCalled();
    expect(social.store.accounts.size).toBe(0);
  });

  it('rejects a state that has expired', async () => {
    const { owner, workspace, start, callback, setClock, meta } = await ownerSetup();
    const { state } = await start(owner, workspace.id);
    setClock(new Date(Date.now() + 10 * 60 * 1000 + 1000));
    expect((await callback(owner, { code: 'AUTH-CODE', state })).result).toBe('invalid_state');
    expect(meta.exchangeCode).not.toHaveBeenCalled();
  });

  it('rejects a state started by another user (login CSRF)', async () => {
    const { owner, workspace, start, callback, signIn, workspaceFor, list, meta } =
      await ownerSetup();
    const attacker = await signIn('Mallory');
    const attackerWorkspace = await workspaceFor(attacker, 'Mallory Co');
    // The attacker starts a flow and tricks the owner's browser into finishing it.
    const { state } = await start(attacker, attackerWorkspace.id);

    expect((await callback(owner, { code: 'ATTACKER-CODE', state })).result).toBe('invalid_state');

    expect(meta.exchangeCode).not.toHaveBeenCalled();
    expect((await list(owner, workspace.id)).accounts).toEqual([]);
    expect((await list(attacker, attackerWorkspace.id)).accounts).toEqual([]);
  });

  it('asks the person to sign in again when the session is gone, and spends the state', async () => {
    const { owner, workspace, start, callback } = await ownerSetup();
    const { state } = await start(owner, workspace.id);
    expect((await callback(null, { code: 'AUTH-CODE', state })).result).toBe('session_expired');
    expect((await callback(owner, { code: 'AUTH-CODE', state })).result).toBe('invalid_state');
  });

  it('ignores workspace IDs and redirect targets in the callback URL', async () => {
    const { owner, workspace, start, callback, signIn, workspaceFor, list } = await ownerSetup();
    const other = await signIn('Grace');
    const otherWorkspace = await workspaceFor(other, 'Grace Co');
    const { state } = await start(owner, workspace.id);

    const { location, result } = await callback(owner, {
      code: 'AUTH-CODE',
      state,
      workspaceId: otherWorkspace.id,
      workspace_id: otherWorkspace.id,
      redirect_uri: 'https://evil.example/steal',
      redirect: '//evil.example',
      next: 'https://evil.example',
    });

    expect(result).toBe('connected');
    expect(location.origin).toBe('http://localhost:3000');
    expect(location.pathname).toBe('/accounts');
    expect([...location.searchParams.keys()].sort()).toEqual(['count', 'meta']);
    expect((await list(owner, workspace.id)).accounts).toHaveLength(2);
    expect((await list(other, otherWorkspace.id)).accounts).toEqual([]);
  });

  it('reports a cancelled authorization without calling Meta', async () => {
    const { owner, workspace, start, callback, meta } = await ownerSetup();
    const { state } = await start(owner, workspace.id);
    const { result, location } = await callback(owner, {
      state,
      error: 'access_denied',
      error_reason: 'user_denied',
      error_description: '<script>alert(1)</script>',
    });
    expect(result).toBe('denied');
    expect(location.href).not.toContain('script');
    expect(meta.exchangeCode).not.toHaveBeenCalled();
  });

  it('refuses when the person stopped being the owner before finishing', async () => {
    const { owner, workspace, start, callback, workspaces, meta } = await ownerSetup();
    const { state } = await start(owner, workspace.id);
    const membership = workspaces.store.memberships.find((m) => m.userId === owner.user.id);
    if (membership) membership.role = 'staff';

    expect((await callback(owner, { code: 'AUTH-CODE', state })).result).toBe('not_allowed');
    expect(meta.exchangeCode).not.toHaveBeenCalled();
  });

  it.each([
    ['the code exchange', 'exchangeCode'],
    ['the long-lived token exchange', 'exchangeForLongLivedToken'],
    ['the permission check', 'grantedPermissions'],
    ['Page discovery', 'listPages'],
  ] as const)('stores nothing when %s fails', async (_label, method) => {
    const meta = fakeMeta();
    meta[method].mockRejectedValueOnce(new MetaApiError('request', 100));
    const { owner, workspace, connect, social } = await ownerSetup({ meta });

    expect((await connect(owner, workspace.id)).result).toBe('exchange_failed');
    expect(social.store.accounts.size).toBe(0);
  });

  it('says so when no Page, or no linked Instagram account, was found', async () => {
    const { owner, workspace, connect } = await ownerSetup({ meta: fakeMeta([STUDIO]) });
    expect((await connect(owner, workspace.id, 'instagram')).result).toBe('no_accounts');

    const empty = await ownerSetup({ meta: fakeMeta([]) });
    expect((await empty.connect(empty.owner, empty.workspace.id)).result).toBe('no_accounts');
  });

  it('flags accounts whose permissions were not all granted', async () => {
    const meta = fakeMeta();
    meta.grantedPermissions.mockResolvedValue(['pages_show_list', 'pages_read_engagement']);
    const { owner, workspace, connect, list } = await ownerSetup({ meta });
    await connect(owner, workspace.id);

    expect((await list(owner, workspace.id)).accounts[0]).toMatchObject({
      status: 'needs_reconnect',
      issue: 'missing_permissions',
      missingPermissions: ['pages_manage_posts'],
      grantedPermissions: ['pages_show_list', 'pages_read_engagement'],
    });
  });

  it('flags a Page the person cannot create content on', async () => {
    const { owner, workspace, connect, list } = await ownerSetup({
      meta: fakeMeta([{ ...STUDIO, tasks: ['ANALYZE'] }]),
    });
    await connect(owner, workspace.id);
    expect((await list(owner, workspace.id)).accounts[0]).toMatchObject({
      status: 'needs_reconnect',
      issue: 'insufficient_page_role',
    });
  });
});

describe('social accounts: duplicates and reconnecting', () => {
  it('keeps one record per account when it is connected again, with the new token', async () => {
    const meta = fakeMeta([BAKERY]);
    meta.grantedPermissions.mockResolvedValueOnce(['pages_show_list']);
    const { owner, workspace, connect, list, social } = await ownerSetup({ meta });

    await connect(owner, workspace.id);
    const [before] = (await list(owner, workspace.id)).accounts;
    expect(before?.status).toBe('needs_reconnect');

    meta.listPages.mockResolvedValue([{ ...BAKERY, accessToken: 'PAGE-TOKEN-ROTATED' }]);
    await connect(owner, workspace.id);

    const { accounts } = await list(owner, workspace.id);
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({ id: before?.id, status: 'connected', issue: null });
    const stored = [...social.store.accounts.values()][0]!;
    expect(createSecretBox([KEY]).decrypt(stored.encryptedToken, tokenContext(stored))).toBe(
      'PAGE-TOKEN-ROTATED',
    );
  });

  it('treats the same Page on Facebook and its Instagram account as separate connections', async () => {
    const { owner, workspace, connect, list } = await ownerSetup({ meta: fakeMeta([BAKERY]) });
    await connect(owner, workspace.id, 'facebook');
    await connect(owner, workspace.id, 'instagram');
    expect((await list(owner, workspace.id)).accounts.map((a) => a.platform)).toEqual([
      'facebook',
      'instagram',
    ]);
  });
});

describe('social accounts: workspace isolation', () => {
  it('shows each workspace only its own accounts', async () => {
    const { owner, workspace, connect, list, workspaceFor } = await ownerSetup();
    const second = await workspaceFor(owner, 'Second Brand');
    await connect(owner, workspace.id);

    expect((await list(owner, workspace.id)).accounts).toHaveLength(2);
    expect((await list(owner, second.id)).accounts).toEqual([]);
  });

  it('answers 404 to non-members and never reaches an account through another workspace', async () => {
    const { owner, workspace, connect, list, base, signIn, workspaceFor, social, meta } =
      await ownerSetup();
    await connect(owner, workspace.id);
    const [account] = (await list(owner, workspace.id)).accounts;
    const mallory = await signIn('Mallory');
    const malloryWorkspace = await workspaceFor(mallory, 'Mallory Co');
    meta.getPage.mockClear();

    const attempts = [
      // Through the victim's workspace: not a member.
      await mallory.get(base(workspace.id)),
      await mallory.get(`${base(workspace.id)}/${account?.id}`),
      await mallory.post(`${base(workspace.id)}/${account?.id}/refresh`),
      await mallory.delete(`${base(workspace.id)}/${account?.id}`),
      await mallory.post(`${base(workspace.id)}/connect`, { platform: 'facebook' }),
      // Through the attacker's own workspace, with the victim's account ID.
      await mallory.get(`${base(malloryWorkspace.id)}/${account?.id}`),
      await mallory.post(`${base(malloryWorkspace.id)}/${account?.id}/refresh`),
      await mallory.delete(`${base(malloryWorkspace.id)}/${account?.id}`),
    ];

    for (const response of attempts) {
      expect(response.status).toBe(404);
      expect(response.text).not.toContain('Bloom Bakery');
    }
    expect(meta.getPage).not.toHaveBeenCalled();
    expect(social.store.accounts.size).toBe(2);
  });

  it('lets the same Page be connected to two workspaces, each with its own record and token', async () => {
    const { owner, workspace, connect, signIn, workspaceFor, social, base, list } =
      await ownerSetup({
        meta: fakeMeta([BAKERY]),
      });
    const grace = await signIn('Grace');
    const graceWorkspace = await workspaceFor(grace, 'Agency');
    await connect(owner, workspace.id);
    await connect(grace, graceWorkspace.id);

    const stored = [...social.store.accounts.values()];
    expect(stored.map((a) => a.workspaceId).sort()).toEqual(
      [workspace.id, graceWorkspace.id].sort(),
    );
    expect(stored[0]?.encryptedToken).not.toBe(stored[1]?.encryptedToken);

    const [mine] = (await list(owner, workspace.id)).accounts;
    expect((await owner.delete(`${base(workspace.id)}/${mine?.id}`)).status).toBe(204);
    expect((await list(grace, graceWorkspace.id)).accounts).toHaveLength(1);
  });

  it.each(['not-an-id', '{"$ne":null}'])('rejects the malformed account ID %j', async (id) => {
    const { owner, workspace, base } = await ownerSetup();
    const response = await owner.get(`${base(workspace.id)}/${encodeURIComponent(id)}`);
    expect(response.status).toBe(400);
  });
});

describe('social accounts: roles', () => {
  async function withStaff() {
    const context = await ownerSetup();
    const staff = await context.signIn('Sam');
    await context.workspaces.addMember(context.workspace.id, staff.user.id, 'staff');
    await context.connect(context.owner, context.workspace.id);
    const [account] = (await context.list(staff, context.workspace.id)).accounts;
    return { ...context, staff, account: account! };
  }

  it('lets staff see accounts and refresh their details', async () => {
    const { staff, workspace, base, account, list } = await withStaff();
    expect((await list(staff, workspace.id)).accounts).toHaveLength(2);
    expect((await staff.get(`${base(workspace.id)}/${account.id}`)).status).toBe(200);
    expect((await staff.post(`${base(workspace.id)}/${account.id}/refresh`)).status).toBe(200);
  });

  it('refuses connecting and disconnecting to staff', async () => {
    const { staff, workspace, base, account, social } = await withStaff();
    const states = social.store.states.size;

    const connect = await staff.post(`${base(workspace.id)}/connect`, { platform: 'facebook' });
    const disconnect = await staff.delete(`${base(workspace.id)}/${account.id}`);

    for (const response of [connect, disconnect]) {
      expect(response.status).toBe(403);
      expect(errorOf(response).code).toBe('PERMISSION_DENIED');
    }
    expect(social.store.states.size).toBe(states);
    expect(social.store.accounts.size).toBe(2);
  });
});

describe('social accounts: disconnect', () => {
  it('removes the connection and its token, and only that one', async () => {
    const { owner, workspace, connect, list, base, social } = await ownerSetup();
    await connect(owner, workspace.id);
    const [bakery, studio] = (await list(owner, workspace.id)).accounts;

    expect((await owner.delete(`${base(workspace.id)}/${bakery?.id}`)).status).toBe(204);

    expect((await list(owner, workspace.id)).accounts.map((a) => a.id)).toEqual([studio?.id]);
    expect([...social.store.accounts.values()].map((a) => a.externalId)).toEqual(['1002']);
    expect((await owner.delete(`${base(workspace.id)}/${bakery?.id}`)).status).toBe(404);
    expect((await owner.get(`${base(workspace.id)}/${bakery?.id}`)).status).toBe(404);
  });
});

describe('social accounts: refresh, expired and revoked authorization', () => {
  async function connected(meta = fakeMeta([BAKERY])) {
    const context = await ownerSetup({ meta });
    await context.connect(context.owner, context.workspace.id);
    const [account] = (await context.list(context.owner, context.workspace.id)).accounts;
    const refresh = () =>
      context.owner.post(`${context.base(context.workspace.id)}/${account?.id}/refresh`);
    return { ...context, account: account!, refresh };
  }

  it('updates the name and picture using the decrypted Page token', async () => {
    const { refresh, meta, setClock } = await connected();
    meta.getPage.mockResolvedValueOnce({
      name: 'Bloom Bakery & Café',
      pictureUrl: 'https://cdn.example/new.jpg',
    });
    const later = new Date(Date.now() + 60 * 60 * 1000);
    setClock(later);

    const { account } = socialAccountResponseSchema.parse((await refresh()).body);

    expect(meta.getPage).toHaveBeenCalledWith('1001', 'PAGE-TOKEN-1001');
    expect(account).toMatchObject({
      name: 'Bloom Bakery & Café',
      profileImageUrl: 'https://cdn.example/new.jpg',
      status: 'connected',
      lastSyncedAt: later.toISOString(),
    });
  });

  it('marks the account for reconnection when Meta says the token is expired or revoked', async () => {
    const { refresh, meta, list, owner, workspace, connect } = await connected();
    meta.getPage.mockRejectedValueOnce(new MetaApiError('token', 190, 463));

    const response = await refresh();
    expect(response.status).toBe(200);
    expect(socialAccountResponseSchema.parse(response.body).account).toMatchObject({
      status: 'needs_reconnect',
      issue: 'token_invalid',
    });
    expect((await list(owner, workspace.id)).accounts[0]?.status).toBe('needs_reconnect');

    // Reconnecting through Facebook restores it.
    await connect(owner, workspace.id);
    expect((await list(owner, workspace.id)).accounts[0]).toMatchObject({
      status: 'connected',
      issue: null,
    });
  });

  it('clears the flag when a later refresh works again', async () => {
    const { refresh, meta } = await connected();
    meta.getPage.mockRejectedValueOnce(new MetaApiError('token', 190));
    await refresh();
    expect(socialAccountResponseSchema.parse((await refresh()).body).account).toMatchObject({
      status: 'connected',
      issue: null,
    });
  });

  it('records a removed permission', async () => {
    const { refresh, meta } = await connected();
    meta.getPage.mockRejectedValueOnce(new MetaApiError('permission', 200));
    expect(socialAccountResponseSchema.parse((await refresh()).body).account).toMatchObject({
      status: 'needs_reconnect',
      issue: 'missing_permissions',
    });
  });

  it('treats an unreadable stored token as invalid instead of failing or calling Meta', async () => {
    const { refresh, meta, social } = await connected();
    const stored = [...social.store.accounts.values()][0]!;
    stored.encryptedToken = `${stored.encryptedToken.slice(0, -4)}AAAA`;

    expect(socialAccountResponseSchema.parse((await refresh()).body).account.issue).toBe(
      'token_invalid',
    );
    expect(meta.getPage).not.toHaveBeenCalled();
  });

  it.each([
    ['rate_limit', /limiting requests/],
    ['transient', /did not answer/],
  ] as const)(
    'answers 502 and keeps the account as it was on a %s error',
    async (kind, message) => {
      const { refresh, meta, list, owner, workspace } = await connected();
      meta.getPage.mockRejectedValueOnce(new MetaApiError(kind, 4));

      const response = await refresh();
      expect(response.status).toBe(502);
      expect(errorOf(response)).toMatchObject({ code: 'INTEGRATION_ERROR' });
      expect(errorOf(response).message).toMatch(message);
      expect((await list(owner, workspace.id)).accounts[0]?.status).toBe('connected');
    },
  );

  it('refreshes an Instagram account through its own endpoint', async () => {
    const context = await ownerSetup({ meta: fakeMeta([BAKERY]) });
    await context.connect(context.owner, context.workspace.id, 'instagram');
    const [account] = (await context.list(context.owner, context.workspace.id)).accounts;
    context.meta.getInstagramAccount.mockResolvedValueOnce({
      id: '17841400000000001',
      username: 'bloom.official',
      name: 'Bloom Official',
      pictureUrl: null,
    });

    const response = await context.owner.post(
      `${context.base(context.workspace.id)}/${account?.id}/refresh`,
    );

    expect(context.meta.getInstagramAccount).toHaveBeenCalledWith(
      '17841400000000001',
      'PAGE-TOKEN-1001',
    );
    expect(socialAccountResponseSchema.parse(response.body).account).toMatchObject({
      name: 'Bloom Official',
      username: 'bloom.official',
    });
  });
});
