import { describe, expect, it, vi } from 'vitest';
import {
  MetaApiError,
  classifyMetaError,
  createMetaClient,
} from '../src/integrations/meta/meta-client';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** A client whose network is a queue of canned Meta responses. */
function setup(...responses: (Response | Error)[]) {
  const requests: { url: string; init: RequestInit | undefined }[] = [];
  const fetchImpl = vi.fn<typeof fetch>((url, init) => {
    requests.push({
      url: typeof url === 'string' ? url : url instanceof URL ? url.href : url.url,
      init,
    });
    const next = responses.shift();
    if (!next) throw new Error('Unexpected Meta request');
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  });
  const client = createMetaClient({
    appId: '1234567890',
    appSecret: 'app-secret-value',
    redirectUri: 'https://app.example.com/api/social/meta/callback',
    graphApiVersion: 'v27.0',
    fetchImpl,
  });
  const call = (index: number) => {
    const made = requests[index];
    return {
      url: new URL(made?.url ?? ''),
      headers: (made?.init?.headers ?? {}) as Record<string, string>,
    };
  };
  return { client, fetchImpl, call };
}

const failure = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error as MetaApiError;
  }
  throw new Error('Expected the call to fail');
};

describe('Meta client: authorization', () => {
  it('builds the Facebook Login dialog URL with state and scopes', () => {
    const url = new URL(
      setup().client.authorizationUrl({ state: 'state-value', scopes: ['pages_show_list', 'x'] }),
    );
    expect(`${url.origin}${url.pathname}`).toBe('https://www.facebook.com/v27.0/dialog/oauth');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: '1234567890',
      redirect_uri: 'https://app.example.com/api/social/meta/callback',
      state: 'state-value',
      response_type: 'code',
      scope: 'pages_show_list,x',
    });
    expect(url.href).not.toContain('app-secret-value');
  });

  it('exchanges the code, then the short-lived token for a long-lived one', async () => {
    const { client, call } = setup(
      json({ access_token: 'short-token', token_type: 'bearer', expires_in: 3600 }),
      json({ access_token: 'long-token', token_type: 'bearer', expires_in: 5184000 }),
    );

    expect(await client.exchangeCode('auth-code')).toEqual({
      accessToken: 'short-token',
      expiresIn: 3600,
    });
    expect(call(0).url.pathname).toBe('/v27.0/oauth/access_token');
    expect(Object.fromEntries(call(0).url.searchParams)).toEqual({
      client_id: '1234567890',
      redirect_uri: 'https://app.example.com/api/social/meta/callback',
      client_secret: 'app-secret-value',
      code: 'auth-code',
    });

    expect(await client.exchangeForLongLivedToken('short-token')).toEqual({
      accessToken: 'long-token',
      expiresIn: 5184000,
    });
    expect(Object.fromEntries(call(1).url.searchParams)).toMatchObject({
      grant_type: 'fb_exchange_token',
      fb_exchange_token: 'short-token',
    });
  });

  it('reports a rejected or reused authorization code without echoing Meta’s text', async () => {
    const { client } = setup(
      json(
        {
          error: {
            message: 'This authorization code has been used. secret-detail',
            type: 'OAuthException',
            code: 100,
            error_subcode: 36009,
          },
        },
        400,
      ),
    );
    const error = await failure(client.exchangeCode('used-code'));
    expect(error).toBeInstanceOf(MetaApiError);
    expect(error).toMatchObject({ kind: 'request', code: 100, subcode: 36009 });
    expect(error.message).not.toContain('secret-detail');
    expect(error.message).not.toContain('used-code');
  });

  it('lists only the permissions the person granted', async () => {
    const { client, call } = setup(
      json({
        data: [
          { permission: 'pages_show_list', status: 'granted' },
          { permission: 'pages_manage_posts', status: 'declined' },
          { permission: 'instagram_basic', status: 'granted' },
        ],
      }),
    );
    expect(await client.grantedPermissions('user-token')).toEqual([
      'pages_show_list',
      'instagram_basic',
    ]);
    expect(call(0).url.pathname).toBe('/v27.0/me/permissions');
  });
});

describe('Meta client: account discovery', () => {
  const pageOne = {
    id: '1001',
    name: 'Bloom Bakery',
    tasks: ['CREATE_CONTENT', 'MANAGE'],
    access_token: 'page-token-1001',
    picture: { data: { url: 'https://cdn.example/1001.jpg' } },
    instagram_business_account: {
      id: '17841400000000001',
      username: 'bloombakery',
      name: 'Bloom Bakery',
      profile_picture_url: 'https://cdn.example/ig.jpg',
    },
  };
  const pageTwo = {
    id: '1002',
    name: 'Loom Studio',
    tasks: ['ANALYZE'],
    access_token: 'page-token-1002',
  };

  it('reads Pages with their tokens, tasks and linked Instagram account', async () => {
    const { client, call } = setup(json({ data: [pageOne, pageTwo] }));

    expect(await client.listPages('user-token')).toEqual([
      {
        id: '1001',
        name: 'Bloom Bakery',
        pictureUrl: 'https://cdn.example/1001.jpg',
        accessToken: 'page-token-1001',
        tasks: ['CREATE_CONTENT', 'MANAGE'],
        instagram: {
          id: '17841400000000001',
          username: 'bloombakery',
          name: 'Bloom Bakery',
          pictureUrl: 'https://cdn.example/ig.jpg',
        },
      },
      {
        id: '1002',
        name: 'Loom Studio',
        pictureUrl: null,
        accessToken: 'page-token-1002',
        tasks: ['ANALYZE'],
        instagram: null,
      },
    ]);
    expect(call(0).url.pathname).toBe('/v27.0/me/accounts');
    expect(call(0).url.searchParams.get('fields')).toContain('instagram_business_account');
  });

  it('sends tokens in the Authorization header, never in the URL', async () => {
    const { client, call } = setup(
      json({ data: [] }),
      json({ data: [] }),
      json({ name: 'Bloom Bakery' }),
      json({ id: '17841400000000001', username: 'bloombakery' }),
    );
    await client.listPages('user-token');
    await client.grantedPermissions('user-token');
    await client.getPage('1001', 'page-token-1001');
    await client.getInstagramAccount('17841400000000001', 'page-token-1001');

    for (const [index, token] of [
      'user-token',
      'user-token',
      'page-token-1001',
      'page-token-1001',
    ].entries()) {
      expect(call(index).headers.Authorization).toBe(`Bearer ${token}`);
      expect(call(index).url.href).not.toContain(token);
      expect(call(index).url.searchParams.has('access_token')).toBe(false);
    }
  });

  it('follows paging cursors', async () => {
    const { client, call } = setup(
      json({ data: [pageOne], paging: { cursors: { after: 'CURSOR' }, next: 'https://graph…' } }),
      json({ data: [pageTwo], paging: { cursors: { after: 'END' } } }),
    );
    expect((await client.listPages('user-token')).map((page) => page.id)).toEqual(['1001', '1002']);
    expect(call(1).url.searchParams.get('after')).toBe('CURSOR');
  });

  it('reads one Page and one Instagram account for a refresh', async () => {
    const { client, call } = setup(
      json({
        name: 'Bloom Bakery & Café',
        picture: { data: { url: 'https://cdn.example/new.jpg' } },
      }),
      json({ id: '17841400000000001', username: 'bloom', name: null }),
    );
    expect(await client.getPage('1001', 'page-token')).toEqual({
      name: 'Bloom Bakery & Café',
      pictureUrl: 'https://cdn.example/new.jpg',
    });
    expect(call(0).url.pathname).toBe('/v27.0/1001');
    expect(await client.getInstagramAccount('17841400000000001', 'page-token')).toEqual({
      id: '17841400000000001',
      username: 'bloom',
      name: null,
      pictureUrl: null,
    });
  });

  it.each([
    ['a page without a token', { data: [{ id: '1', name: 'A' }] }],
    ['a non-list payload', { data: 'nope' }],
    ['an empty body', null],
  ])('treats %s as an invalid response', async (_label, body) => {
    const { client } = setup(json(body));
    expect(await failure(client.listPages('user-token'))).toMatchObject({
      kind: 'invalid_response',
    });
  });
});

describe('Meta client: errors', () => {
  it.each([
    [190, 401, 'token'],
    [102, 400, 'token'],
    [10, 403, 'permission'],
    [200, 403, 'permission'],
    [299, 403, 'permission'],
    [4, 400, 'rate_limit'],
    [17, 400, 'rate_limit'],
    [2, 500, 'transient'],
    [100, 400, 'request'],
    [null, 503, 'transient'],
    [null, 404, 'request'],
  ] as const)('classifies code %s (HTTP %s) as %s', (code, status, kind) => {
    expect(classifyMetaError(code, status)).toBe(kind);
  });

  it('reports an expired or revoked token (code 190) as a token error', async () => {
    const { client } = setup(
      json(
        { error: { message: 'Error validating access token', code: 190, error_subcode: 463 } },
        401,
      ),
    );
    expect(await failure(client.getPage('1001', 'expired-token'))).toMatchObject({
      kind: 'token',
      code: 190,
      subcode: 463,
    });
  });

  it('reports network failures as transient and drops the cause (it may hold the URL)', async () => {
    const { client } = setup(new TypeError('fetch failed: https://graph.facebook.com/?secret'));
    const error = await failure(client.exchangeCode('auth-code'));
    expect(error.kind).toBe('transient');
    expect(error.cause).toBeUndefined();
    expect(error.message).not.toContain('secret');
  });
});
