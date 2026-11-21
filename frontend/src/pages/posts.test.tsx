// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '@/contexts/auth-provider';
import { appRoutes } from '@/routes/router';
import { TEST_USER, TEST_WORKSPACE, apiError, json, mockApi, urlOf } from '@/test/auth-test-utils';
import { makeMedia, makePost } from '@/test/content-fixtures';

const POSTS = `/api/workspaces/${TEST_WORKSPACE.id}/posts`;
const OTHER_USER = '65f0c0ffee0000000000beef';

function renderApp(
  routes: Parameters<typeof mockApi>[0],
  { workspace = TEST_WORKSPACE, path = '/posts' } = {},
) {
  const fetchMock = mockApi({
    'GET /api/auth/me': () => json({ user: TEST_USER }),
    'GET /api/workspaces': () => json({ workspaces: [workspace] }),
    ...routes,
  });
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  render(
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>,
  );
  const queries = () =>
    fetchMock.mock.calls
      .filter(([url, init]) => {
        const parsed = new URL(urlOf(url), 'http://localhost');
        return parsed.pathname === POSTS && (init?.method ?? 'GET') === 'GET';
      })
      .map(([url]) => new URL(urlOf(url), 'http://localhost').searchParams.toString());
  return { router, fetchMock, queries };
}

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('posts page', () => {
  it('lists posts with status, platforms, source, hashtags and media', async () => {
    renderApp({
      [`GET ${POSTS}`]: () =>
        json({
          posts: [
            makePost({
              title: 'Croissant launch',
              status: 'awaiting_approval',
              media: [makeMedia()],
              mediaIds: [makeMedia().id],
            }),
          ],
          nextCursor: null,
        }),
    });
    expect(await screen.findByRole('link', { name: 'Croissant launch' })).toHaveAttribute(
      'href',
      `/posts/${'c'.repeat(24)}`,
    );
    const card = screen
      .getByRole('link', { name: 'Croissant launch' })
      .closest<HTMLElement>('[data-slot="card"]') as HTMLElement;
    expect(within(card).getByText('Awaiting approval')).toBeVisible();
    expect(screen.getByText('Golden, flaky and warm.')).toBeVisible();
    expect(screen.getByText('From AI Studio')).toBeVisible();
    expect(screen.getByText('#Croissant')).toBeVisible();
    expect(
      within(screen.getByRole('list', { name: 'Attached media' })).getByRole('img'),
    ).toHaveAttribute('src', expect.stringContaining(`/media/${'a'.repeat(24)}/file`));
    // Nothing on the page pretends to schedule or publish.
    expect(screen.queryByRole('button', { name: /publish|schedule/i })).toBeNull();
  });

  it('filters by status and platform and searches title and caption', async () => {
    const { queries } = renderApp({
      [`GET ${POSTS}`]: () => json({ posts: [], nextCursor: null }),
    });
    expect(await screen.findByText('No posts yet')).toBeVisible();

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'approved' } });
    await screen.findByText('No posts match');
    fireEvent.change(screen.getByLabelText('Platform'), { target: { value: 'facebook' } });
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: ' croissant ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() =>
      expect(queries().at(-1)).toBe('status=approved&platform=facebook&q=croissant'),
    );
    expect(queries()[0]).toBe('');
  });

  it('loads older posts with the cursor', async () => {
    let call = 0;
    const { queries } = renderApp({
      [`GET ${POSTS}`]: () => {
        call += 1;
        return call === 1
          ? json({ posts: [makePost({ title: 'Newest' })], nextCursor: 'c'.repeat(24) })
          : json({ posts: [makePost({ id: 'e'.repeat(24), title: 'Oldest' })], nextCursor: null });
      },
    });
    await screen.findByText('Newest');
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('Oldest')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
    expect(queries()).toEqual(['', `before=${'c'.repeat(24)}`]);
  });

  it('points to the editor and AI Studio when there are no posts', async () => {
    renderApp({ [`GET ${POSTS}`]: () => json({ posts: [], nextCursor: null }) });
    expect(await screen.findByText('No posts yet')).toBeVisible();
    expect(screen.getByRole('link', { name: /Open AI Studio/ })).toHaveAttribute(
      'href',
      '/ai-studio',
    );
    expect(screen.getAllByRole('link', { name: /New post/ })[0]).toHaveAttribute(
      'href',
      '/posts/new',
    );
  });

  it('offers a retry when posts cannot be loaded', async () => {
    let attempts = 0;
    renderApp({
      [`GET ${POSTS}`]: () => {
        attempts += 1;
        return attempts === 1
          ? apiError(503, 'SERVICE_UNAVAILABLE', 'Try again shortly')
          : json({ posts: [makePost({ caption: 'Back again' })], nextCursor: null });
      },
    });
    expect(await screen.findByText(/could not load this workspace's posts/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Back again')).toBeVisible();
  });

  it('deletes a post only after confirmation, and says media stays', async () => {
    const { fetchMock } = renderApp({
      [`GET ${POSTS}`]: () => json({ posts: [makePost({ title: 'Old idea' })], nextCursor: null }),
      [`DELETE ${POSTS}/${'c'.repeat(24)}`]: () => new Response(null, { status: 204 }),
    });
    await screen.findByText('Old idea');
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByText(/Its media stays in the library/)).toBeVisible();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Delete post' }));
    await waitFor(() => expect(screen.queryByText('Old idea')).toBeNull());
  });

  it('shows the server message when deleting is refused', async () => {
    renderApp({
      [`GET ${POSTS}`]: () => json({ posts: [makePost({ title: 'Mine' })], nextCursor: null }),
      [`DELETE ${POSTS}/${'c'.repeat(24)}`]: () =>
        apiError(403, 'PERMISSION_DENIED', 'Staff can delete only their own posts.'),
    });
    await screen.findByText('Mine');
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete post' }));
    expect(await screen.findByText('Staff can delete only their own posts.')).toBeVisible();
    expect(screen.getByText('Mine')).toBeVisible();
  });

  it('hides Delete from staff for posts they may not delete', async () => {
    renderApp(
      {
        [`GET ${POSTS}`]: () =>
          json({
            posts: [
              makePost({ id: '1'.repeat(24), title: 'Owner post', createdBy: OTHER_USER }),
              makePost({ id: '2'.repeat(24), title: 'My submitted', status: 'awaiting_approval' }),
              makePost({ id: '3'.repeat(24), title: 'My draft' }),
            ],
            nextCursor: null,
          }),
      },
      { workspace: { ...TEST_WORKSPACE, role: 'staff' } },
    );
    await screen.findByText('My draft');
    const cardOf = (title: string) =>
      screen.getByRole('link', { name: title }).closest<HTMLElement>('[data-slot="card"]');
    const hasDelete = (title: string) =>
      within(cardOf(title) as HTMLElement).queryByRole('button', { name: 'Delete' }) !== null;
    expect(hasDelete('My draft')).toBe(true);
    expect(hasDelete('Owner post')).toBe(false);
    expect(hasDelete('My submitted')).toBe(false);
  });

  it('duplicates a post and opens the copy', async () => {
    const { router } = renderApp({
      [`GET ${POSTS}`]: () => json({ posts: [makePost({ title: 'Original' })], nextCursor: null }),
      [`POST ${POSTS}/${'c'.repeat(24)}/duplicate`]: () =>
        json({ post: makePost({ id: 'e'.repeat(24), title: 'Original (copy)' }) }, 201),
      [`GET ${POSTS}/${'e'.repeat(24)}`]: () =>
        json({ post: makePost({ id: 'e'.repeat(24), title: 'Original (copy)' }) }),
      [`GET /api/workspaces/${TEST_WORKSPACE.id}/social-accounts`]: () =>
        json({ accounts: [], integration: { configured: false } }),
      [`GET /api/workspaces/${TEST_WORKSPACE.id}/members`]: () => json({ members: [] }),
    });
    await screen.findByText('Original');
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/posts/${'e'.repeat(24)}`));
    expect(await screen.findByLabelText('Title')).toHaveValue('Original (copy)');
  });
});
