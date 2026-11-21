// @vitest-environment jsdom
import type { Post, Workspace } from '@metaflow/shared';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '@/contexts/auth-provider';
import { appRoutes } from '@/routes/router';
import {
  TEST_USER,
  TEST_WORKSPACE,
  apiError,
  json,
  jsonBodyOf,
  mockApi,
  urlOf,
} from '@/test/auth-test-utils';
import { MEDIA_LIMITS, makeAccount, makeMedia, makePost } from '@/test/content-fixtures';

const BASE = `/api/workspaces/${TEST_WORKSPACE.id}`;
const POST_ID = 'c'.repeat(24);
const STAFF_ID = '65f0c0ffee0000000000beef';
const instagram = makeAccount();
const facebook = makeAccount({
  id: '9'.repeat(24),
  platform: 'facebook',
  name: 'Bloom Page',
  username: null,
  accountType: 'facebook_page',
});
const photo = makeMedia();

function renderEditor(
  path: string,
  routes: Parameters<typeof mockApi>[0] = {},
  workspace: Workspace = TEST_WORKSPACE,
) {
  const fetchMock = mockApi({
    'GET /api/auth/me': () => json({ user: TEST_USER }),
    'GET /api/workspaces': () => json({ workspaces: [workspace] }),
    [`GET ${BASE}/social-accounts`]: () =>
      json({ accounts: [instagram, facebook], integration: { configured: true } }),
    [`GET ${BASE}/members`]: () =>
      json({
        members: [
          {
            userId: TEST_USER.id,
            name: 'Ada Lovelace',
            email: 'ada@example.com',
            role: 'owner',
            joinedAt: '2026-11-20T10:00:00.000Z',
          },
          {
            userId: STAFF_ID,
            name: 'Sam Staff',
            email: 'sam@example.com',
            role: 'staff',
            joinedAt: '2026-11-20T10:00:00.000Z',
          },
        ],
      }),
    [`GET ${BASE}/media`]: () => json({ media: [photo], nextCursor: null, limits: MEDIA_LIMITS }),
    ...routes,
  });
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  render(
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>,
  );
  const callsTo = (method: string, pathname: string) =>
    fetchMock.mock.calls.filter(
      ([url, init]) =>
        new URL(urlOf(url), 'http://localhost').pathname === pathname &&
        (init?.method ?? 'GET') === method,
    );
  return { router, callsTo };
}

const readyPost = (overrides: Partial<Post> = {}) =>
  makePost({
    id: POST_ID,
    title: 'Croissant launch',
    platforms: ['instagram'],
    mediaIds: [photo.id],
    media: [photo],
    socialAccountIds: [instagram.id],
    socialAccounts: [
      {
        id: instagram.id,
        platform: 'instagram',
        name: instagram.name,
        username: instagram.username,
        status: 'connected',
      },
    ],
    ...overrides,
  });

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('post editor: content', () => {
  it('creates a draft with media and accounts, then opens it', async () => {
    const created = readyPost({ id: 'e'.repeat(24) });
    const { router, callsTo } = renderEditor('/posts/new', {
      [`POST ${BASE}/posts`]: () => json({ post: created }, 201),
      [`GET ${BASE}/posts/${created.id}`]: () => json({ post: created }),
    });
    await screen.findByLabelText('Title');

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Croissant launch' } });
    fireEvent.change(screen.getByLabelText('Caption'), {
      target: { value: 'Fresh every morning' },
    });
    fireEvent.change(screen.getByLabelText('Hashtags'), {
      target: { value: '#bakery, croissant' },
    });
    fireEvent.click(screen.getByLabelText('Instagram'));
    fireEvent.click(await screen.findByLabelText(/Bloom Bakery/));

    fireEvent.click(screen.getByRole('button', { name: 'Add media' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Select croissant.jpg' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add selected' }));
    expect(
      await within(await screen.findByRole('list', { name: 'Attached media' })).findByRole('img'),
    ).toBeVisible();
    expect(screen.getByText('Ready. Save the post to submit it.')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/posts/${created.id}`));
    expect(jsonBodyOf(callsTo('POST', `${BASE}/posts`)[0]?.[1])).toEqual({
      title: 'Croissant launch',
      caption: 'Fresh every morning',
      hashtags: ['bakery', 'croissant'],
      platforms: ['instagram'],
      socialAccountIds: [instagram.id],
      mediaIds: [photo.id],
    });
  });

  it('checks platform rules as you edit', async () => {
    renderEditor('/posts/new');
    await screen.findByLabelText('Title');
    fireEvent.click(screen.getByLabelText('Instagram'));
    const issues = await screen.findByRole('list', { name: 'Issues to fix' });
    expect(within(issues).getByText(/Select an Instagram account/)).toBeVisible();
    expect(
      within(issues).getByText('Instagram posts need at least one photo or video.'),
    ).toBeVisible();
  });

  it('refuses to save an empty draft without calling the API', async () => {
    const { callsTo } = renderEditor('/posts/new');
    await screen.findByLabelText('Title');
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByText('Add a title, a caption or media before saving')).toBeVisible();
    expect(callsTo('POST', `${BASE}/posts`)).toHaveLength(0);
  });

  it('drops accounts when their platform is unselected', async () => {
    const { callsTo } = renderEditor(`/posts/${POST_ID}`, {
      [`GET ${BASE}/posts/${POST_ID}`]: () => json({ post: readyPost() }),
      [`PATCH ${BASE}/posts/${POST_ID}`]: (init) =>
        json({
          post: readyPost({ ...jsonBodyOf(init), media: [], socialAccounts: [] }),
        }),
    });
    expect(await screen.findByLabelText('Title')).toHaveValue('Croissant launch');
    fireEvent.click(screen.getByLabelText('Instagram'));
    fireEvent.click(screen.getByLabelText('Facebook'));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Saved.');
    expect(jsonBodyOf(callsTo('PATCH', `${BASE}/posts/${POST_ID}`)[0]?.[1])).toMatchObject({
      revision: 0,
      platforms: ['facebook'],
      socialAccountIds: [],
    });
  });

  it('refuses to overwrite a newer version, then saves on top of the latest one', async () => {
    let reads = 0;
    const patches: Record<string, unknown>[] = [];
    const { callsTo } = renderEditor(`/posts/${POST_ID}`, {
      [`GET ${BASE}/posts/${POST_ID}`]: () => {
        reads += 1;
        return json({
          post:
            reads === 1
              ? readyPost({ revision: 4 })
              : readyPost({ revision: 6, caption: 'Edited by a teammate' }),
        });
      },
      [`PATCH ${BASE}/posts/${POST_ID}`]: (init) => {
        const body = jsonBodyOf(init);
        patches.push(body);
        return body.revision === 6
          ? json({ post: readyPost({ revision: 7, caption: String(body.caption) }) })
          : apiError(
              409,
              'CONFLICT',
              'This post was changed by someone else. Reload it and try again.',
            );
      },
    });

    // Editing the version loaded at revision 4; someone else has saved since.
    fireEvent.change(await screen.findByLabelText('Caption'), { target: { value: 'My wording' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(
      await screen.findByText('This post was changed by someone else. Reload it and try again.'),
    ).toBeVisible();
    expect(screen.getByText(/Your unsaved changes will be replaced/)).toBeVisible();
    expect(patches[0]?.revision).toBe(4);
    // Nothing is retried automatically.
    expect(callsTo('PATCH', `${BASE}/posts/${POST_ID}`)).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Load the latest version' }));
    expect(await screen.findByDisplayValue('Edited by a teammate')).toBeVisible();
    expect(screen.queryByText(/changed by someone else/)).toBeNull();

    fireEvent.change(screen.getByLabelText('Caption'), { target: { value: 'Agreed wording' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Saved.')).toBeVisible();
    expect(patches[1]).toMatchObject({ revision: 6, caption: 'Agreed wording' });
    expect(reads).toBe(2);
  });

  it('shows server field errors next to the field', async () => {
    renderEditor(`/posts/${POST_ID}`, {
      [`GET ${BASE}/posts/${POST_ID}`]: () => json({ post: readyPost() }),
      [`PATCH ${BASE}/posts/${POST_ID}`]: () =>
        apiError(400, 'VALIDATION_ERROR', 'Request validation failed', [
          { path: 'body.mediaIds.0', message: 'Media not found' },
        ]),
    });
    fireEvent.change(await screen.findByLabelText('Caption'), { target: { value: 'Changed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Media not found')).toBeVisible();
    expect(screen.getByText('Check the highlighted fields.')).toBeVisible();
  });

  it('shows "not found" for a post of another workspace', async () => {
    renderEditor(`/posts/${POST_ID}`, {
      [`GET ${BASE}/posts/${POST_ID}`]: () => apiError(404, 'NOT_FOUND', 'Post not found'),
    });
    expect(await screen.findByText('Post not found')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Back to posts' })).toHaveAttribute('href', '/posts');
  });
});

describe('post editor: approval', () => {
  it('submits a saved, ready post', async () => {
    const { callsTo } = renderEditor(`/posts/${POST_ID}`, {
      [`GET ${BASE}/posts/${POST_ID}`]: () => json({ post: readyPost() }),
      [`POST ${BASE}/posts/${POST_ID}/workflow`]: () =>
        json({
          post: readyPost({
            status: 'awaiting_approval',
            reviewEvents: [
              { action: 'submit', by: TEST_USER.id, at: '2026-11-20T11:00:00.000Z', note: null },
            ],
          }),
        }),
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Submit for approval' }));
    expect(await screen.findByText('Submitted for approval by You')).toBeVisible();
    expect(jsonBodyOf(callsTo('POST', `${BASE}/posts/${POST_ID}/workflow`)[0]?.[1])).toEqual({
      action: 'submit',
      revision: 0,
    });
    // Awaiting approval: the form is locked.
    expect(screen.getByLabelText('Caption')).toBeDisabled();
    expect(screen.getByText(/Withdraw it to make changes/)).toBeVisible();
  });

  it('requires saving before submitting', async () => {
    renderEditor(`/posts/${POST_ID}`, {
      [`GET ${BASE}/posts/${POST_ID}`]: () => json({ post: readyPost() }),
    });
    fireEvent.change(await screen.findByLabelText('Caption'), { target: { value: 'Edited' } });
    expect(screen.getByRole('button', { name: 'Submit for approval' })).toBeDisabled();
    expect(screen.getByText('Save your changes before submitting.')).toBeVisible();
  });

  it('lists what to fix when the server says the post is not ready', async () => {
    renderEditor(`/posts/${POST_ID}`, {
      [`GET ${BASE}/posts/${POST_ID}`]: () => json({ post: readyPost() }),
      [`POST ${BASE}/posts/${POST_ID}/workflow`]: () =>
        apiError(422, 'POST_NOT_READY', 'Fix the issues listed before continuing.', [
          {
            path: 'instagram.socialAccounts',
            message: 'A selected Instagram account needs to be reconnected.',
          },
        ]),
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Submit for approval' }));
    expect(await screen.findByText('Fix the issues listed before continuing.')).toBeVisible();
    expect(screen.getByText('A selected Instagram account needs to be reconnected.')).toBeVisible();
  });

  it('lets the owner approve or request changes with a note', async () => {
    const awaiting = readyPost({
      status: 'awaiting_approval',
      revision: 3,
      reviewEvents: [
        { action: 'submit', by: STAFF_ID, at: '2026-11-20T11:00:00.000Z', note: null },
      ],
    });
    const { callsTo } = renderEditor(`/posts/${POST_ID}`, {
      [`GET ${BASE}/posts/${POST_ID}`]: () => json({ post: awaiting }),
      [`POST ${BASE}/posts/${POST_ID}/workflow`]: () =>
        json({
          post: readyPost({
            status: 'changes_requested',
            reviewEvents: [
              ...awaiting.reviewEvents,
              {
                action: 'request_changes',
                by: TEST_USER.id,
                at: '2026-11-20T12:00:00.000Z',
                note: 'Add the price',
              },
            ],
          }),
        }),
    });
    expect(await screen.findByText('Submitted for approval by Sam Staff')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled();
    fireEvent.change(screen.getByLabelText('Note for the author (optional)'), {
      target: { value: 'Add the price' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Request changes' }));
    expect(await screen.findByText('Changes requested by You')).toBeVisible();
    expect(screen.getByText('You asked for changes:')).toBeVisible();
    expect(jsonBodyOf(callsTo('POST', `${BASE}/posts/${POST_ID}/workflow`)[0]?.[1])).toEqual({
      action: 'request_changes',
      revision: 3,
      note: 'Add the price',
    });
    // Editable again.
    expect(screen.getByLabelText('Caption')).toBeEnabled();
  });

  it('never shows approval actions to staff', async () => {
    renderEditor(
      `/posts/${POST_ID}`,
      {
        [`GET ${BASE}/posts/${POST_ID}`]: () =>
          json({
            post: readyPost({
              status: 'awaiting_approval',
              reviewEvents: [
                { action: 'submit', by: STAFF_ID, at: '2026-11-20T11:00:00.000Z', note: null },
              ],
            }),
          }),
      },
      { ...TEST_WORKSPACE, role: 'staff' },
    );
    expect(await screen.findByText('Waiting for the workspace owner to review it.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Request changes' })).toBeNull();
    // Not the submitter either: no withdraw.
    expect(screen.queryByRole('button', { name: 'Withdraw to edit' })).toBeNull();
  });

  it('explains a conflict and loads the latest version on request', async () => {
    let reads = 0;
    renderEditor(`/posts/${POST_ID}`, {
      [`GET ${BASE}/posts/${POST_ID}`]: () => {
        reads += 1;
        return json({
          post:
            reads === 1
              ? readyPost({ revision: 4 })
              : readyPost({ revision: 6, caption: 'Edited by a teammate' }),
        });
      },
      [`POST ${BASE}/posts/${POST_ID}/workflow`]: () =>
        apiError(
          409,
          'CONFLICT',
          'This post was changed by someone else. Reload it and try again.',
        ),
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Submit for approval' }));
    expect(
      await screen.findByText('This post was changed by someone else. Reload it and try again.'),
    ).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Load the latest version' }));
    expect(await screen.findByDisplayValue('Edited by a teammate')).toBeVisible();
    expect(reads).toBe(2);
  });

  it('lets an approved post be reopened, and never offers to publish', async () => {
    renderEditor(`/posts/${POST_ID}`, {
      [`GET ${BASE}/posts/${POST_ID}`]: () => json({ post: readyPost({ status: 'approved' }) }),
    });
    expect(await screen.findByRole('button', { name: 'Reopen for editing' })).toBeVisible();
    expect(screen.getByText(/approved and locked/)).toBeVisible();
    expect(screen.queryByRole('button', { name: /publish|schedule/i })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
  });
});
