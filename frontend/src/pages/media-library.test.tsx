// @vitest-environment jsdom
import type { Workspace } from '@metaflow/shared';
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
import { MEDIA_LIMITS, makeMedia } from '@/test/content-fixtures';

const BASE = `/api/workspaces/${TEST_WORKSPACE.id}`;
const MEDIA = `${BASE}/media`;
const OTHER_USER = '65f0c0ffee0000000000beef';
const photo = makeMedia();
const video = makeMedia({
  id: 'b'.repeat(24),
  kind: 'video',
  mimeType: 'video/mp4',
  originalName: 'tour.mp4',
  width: null,
  height: null,
  altText: '',
  uploadedBy: OTHER_USER,
});

function renderApp(
  path: string,
  routes: Parameters<typeof mockApi>[0] = {},
  workspace: Workspace = TEST_WORKSPACE,
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
  const callsTo = (method: string, pathname: string) =>
    fetchMock.mock.calls.filter(
      ([url, init]) =>
        new URL(urlOf(url), 'http://localhost').pathname === pathname &&
        (init?.method ?? 'GET') === method,
    );
  return { callsTo, fetchMock };
}

const library = (items = [photo, video], limits = MEDIA_LIMITS) => ({
  [`GET ${MEDIA}`]: () => json({ media: items, nextCursor: null, limits }),
});

const chooseFile = (file: File) =>
  fireEvent.change(screen.getByLabelText('Choose files to upload'), {
    target: { files: [file] },
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

describe('media library', () => {
  it('lists the workspace media with previews served by the API', async () => {
    renderApp('/media', library());
    expect(await screen.findByRole('heading', { level: 1, name: 'Media Library' })).toBeVisible();
    const grid = await screen.findByRole('list', { name: 'Media' });
    expect(within(grid).getByText('croissant.jpg')).toBeVisible();
    expect(within(grid).getByText('tour.mp4')).toBeVisible();
    expect(within(grid).getByRole('img', { name: 'A croissant' })).toHaveAttribute(
      'src',
      `${MEDIA}/${photo.id}/file`,
    );
    expect(screen.getByRole('link', { name: 'Media Library' })).toHaveAttribute('href', '/media');
  });

  it('uploads a file as multipart form data and shows it first', async () => {
    const uploaded = makeMedia({
      id: 'd'.repeat(24),
      originalName: 'new.png',
      mimeType: 'image/png',
    });
    const { callsTo } = renderApp('/media', {
      ...library([photo]),
      [`POST ${MEDIA}`]: () => json({ media: uploaded }, 201),
    });
    await screen.findByText('croissant.jpg');
    chooseFile(new File([new Uint8Array([0x89, 0x50])], 'new.png', { type: 'image/png' }));

    expect(await screen.findByText('new.png')).toBeVisible();
    const [call] = callsTo('POST', MEDIA);
    const body = call?.[1]?.body;
    expect(body).toBeInstanceOf(FormData);
    expect((body as FormData).get('file')).toBeInstanceOf(File);
    // The browser sets the multipart boundary; the client must not set Content-Type itself.
    expect(new Headers(call?.[1]?.headers).get('Content-Type')).toBeNull();
    const names = within(screen.getByRole('list', { name: 'Media' }))
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label'));
    expect(names[0]).toBe('Open new.png');
  });

  it('shows why the server refused an upload', async () => {
    renderApp('/media', {
      ...library([]),
      [`POST ${MEDIA}`]: () =>
        apiError(415, 'UNSUPPORTED_MEDIA', "This file type isn't supported. Upload a JPEG…"),
    });
    await screen.findByText('No media yet');
    chooseFile(new File(['<svg/>'], 'icon.svg', { type: 'image/svg+xml' }));
    expect(await screen.findByText(/icon\.svg: This file type isn't supported/)).toBeVisible();
  });

  it('refuses oversized files before uploading them', async () => {
    const { callsTo } = renderApp(
      '/media',
      library([], { ...MEDIA_LIMITS, videoBytes: 10, imageBytes: 10 }),
    );
    await screen.findByText('No media yet');
    chooseFile(new File(['x'.repeat(50)], 'big.jpg', { type: 'image/jpeg' }));
    expect(await screen.findByText(/big\.jpg: files can be at most 10 B/)).toBeVisible();
    expect(callsTo('POST', MEDIA)).toHaveLength(0);
  });

  it('explains when storage is not configured', async () => {
    renderApp('/media', library([], { ...MEDIA_LIMITS, uploadsEnabled: false }));
    expect(await screen.findByText(/media storage is not configured/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Upload' })).toBeDisabled();
  });

  it('filters by type and searches', async () => {
    const { callsTo } = renderApp('/media', library());
    await screen.findByText('croissant.jpg');
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'video' } });
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'tour' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() =>
      expect(callsTo('GET', MEDIA).map(([url]) => new URL(urlOf(url), 'http://x').search)).toEqual([
        '',
        '?kind=video',
        '?kind=video&q=tour',
      ]),
    );
  });

  it('edits alt text and description', async () => {
    const { callsTo } = renderApp('/media', {
      ...library([photo]),
      [`PATCH ${MEDIA}/${photo.id}`]: (init) => json({ media: { ...photo, ...jsonBodyOf(init) } }),
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Open croissant.jpg' }));
    fireEvent.change(await screen.findByLabelText('Alt text'), {
      target: { value: 'Golden croissant on a plate' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save details' }));
    expect(await screen.findByText('Saved.')).toBeVisible();
    expect(jsonBodyOf(callsTo('PATCH', `${MEDIA}/${photo.id}`)[0]?.[1])).toEqual({
      altText: 'Golden croissant on a plate',
      description: '',
    });
  });

  it('confirms deletion and explains when media is still in use', async () => {
    renderApp('/media', {
      ...library([photo]),
      [`DELETE ${MEDIA}/${photo.id}`]: () =>
        apiError(
          409,
          'MEDIA_IN_USE',
          'This media is attached to 2 posts. Remove it from them before deleting it.',
        ),
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Open croissant.jpg' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }));
    expect(await screen.findByText(/attached to 2 posts/)).toBeVisible();
  });

  it('deletes unused media', async () => {
    renderApp('/media', {
      ...library([photo]),
      [`DELETE ${MEDIA}/${photo.id}`]: () => new Response(null, { status: 204 }),
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Open croissant.jpg' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }));
    expect(await screen.findByText('No media yet')).toBeVisible();
  });

  it("does not offer staff to delete other people's uploads", async () => {
    renderApp('/media', library(), { ...TEST_WORKSPACE, role: 'staff' });
    fireEvent.click(await screen.findByRole('button', { name: 'Open tour.mp4' }));
    await screen.findByLabelText('Alt text');
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
  });

  it('offers a retry when the library cannot be loaded', async () => {
    let attempts = 0;
    renderApp('/media', {
      [`GET ${MEDIA}`]: () => {
        attempts += 1;
        return attempts === 1
          ? apiError(503, 'SERVICE_UNAVAILABLE', 'Try again shortly')
          : json({ media: [photo], nextCursor: null, limits: MEDIA_LIMITS });
      },
    });
    expect(await screen.findByText(/could not load this workspace's media library/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('croissant.jpg')).toBeVisible();
  });
});

describe('workspace logo', () => {
  const settingsRoutes = {
    [`GET ${BASE}/members`]: () => json({ members: [] }),
  };

  it('lets the owner choose a library image as the logo', async () => {
    const { callsTo } = renderApp('/settings', {
      ...settingsRoutes,
      ...library([photo]),
      [`PUT ${BASE}/logo`]: () => json({ workspace: { ...TEST_WORKSPACE, logoMediaId: photo.id } }),
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Choose logo' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Select croissant.jpg' }));
    fireEvent.click(screen.getByRole('button', { name: 'Use as logo' }));

    expect(await screen.findByRole('button', { name: 'Remove logo' })).toBeVisible();
    expect(jsonBodyOf(callsTo('PUT', `${BASE}/logo`)[0]?.[1])).toEqual({ mediaId: photo.id });
    // Only images are offered.
    expect(
      callsTo('GET', MEDIA).map(([url]) =>
        new URL(urlOf(url), 'http://x').searchParams.get('kind'),
      ),
    ).toEqual(['image']);
    expect(screen.getByRole('img', { name: 'Bloom Bakery logo' })).toHaveAttribute(
      'src',
      `${MEDIA}/${photo.id}/file`,
    );
  });

  it('removes the logo without deleting the image', async () => {
    const { callsTo } = renderApp(
      '/settings',
      {
        ...settingsRoutes,
        [`PUT ${BASE}/logo`]: () => json({ workspace: { ...TEST_WORKSPACE, logoMediaId: null } }),
      },
      { ...TEST_WORKSPACE, logoMediaId: photo.id },
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Remove logo' }));
    expect(await screen.findByText(/No logo yet/)).toBeVisible();
    expect(jsonBodyOf(callsTo('PUT', `${BASE}/logo`)[0]?.[1])).toEqual({ mediaId: null });
    expect(callsTo('DELETE', `${MEDIA}/${photo.id}`)).toHaveLength(0);
  });

  it('shows staff the logo read-only', async () => {
    renderApp('/settings', settingsRoutes, {
      ...TEST_WORKSPACE,
      role: 'staff',
      logoMediaId: photo.id,
    });
    expect(await screen.findByText(/Only the owner can change the logo/)).toBeVisible();
    expect(screen.queryByRole('button', { name: /Change logo|Remove logo/ })).toBeNull();
  });
});
