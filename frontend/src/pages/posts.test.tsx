// @vitest-environment jsdom
import type { Post } from '@metaflow/shared';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '@/contexts/auth-provider';
import { appRoutes } from '@/routes/router';
import { TEST_USER, TEST_WORKSPACE, apiError, json, mockApi } from '@/test/auth-test-utils';

const POSTS = `/api/workspaces/${TEST_WORKSPACE.id}/posts`;
const post = (overrides: Partial<Post> = {}): Post => ({
  id: 'c'.repeat(24),
  status: 'draft',
  caption: 'Golden, flaky and warm.',
  hashtags: ['Croissant'],
  platforms: ['instagram'],
  source: 'ai_studio',
  generationId: 'd'.repeat(24),
  createdBy: TEST_USER.id,
  createdAt: '2026-11-20T10:00:00.000Z',
  updatedAt: '2026-11-20T10:00:00.000Z',
  ...overrides,
});

function renderApp(routes: Parameters<typeof mockApi>[0]) {
  mockApi({ 'GET /api/auth/me': () => json({ user: TEST_USER }), ...routes });
  const router = createMemoryRouter(appRoutes, { initialEntries: ['/posts'] });
  render(
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>,
  );
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

describe('posts page (drafts)', () => {
  it('lists saved drafts with their platforms, source and hashtags', async () => {
    renderApp({ [`GET ${POSTS}`]: () => json({ posts: [post()], nextCursor: null }) });
    expect(await screen.findByText('Golden, flaky and warm.')).toBeVisible();
    expect(screen.getByText('Draft')).toBeVisible();
    expect(screen.getByText('Instagram')).toBeVisible();
    expect(screen.getByText('From AI Studio')).toBeVisible();
    expect(screen.getByText('#Croissant')).toBeVisible();
    // Nothing on the page pretends to schedule or publish.
    expect(screen.queryByRole('button', { name: /publish|schedule/i })).toBeNull();
  });

  it('points to AI Studio when there are no drafts', async () => {
    renderApp({ [`GET ${POSTS}`]: () => json({ posts: [], nextCursor: null }) });
    expect(await screen.findByText('No drafts yet')).toBeVisible();
    expect(screen.getByRole('link', { name: /Open AI Studio/ })).toHaveAttribute(
      'href',
      '/ai-studio',
    );
  });

  it('offers a retry when drafts cannot be loaded', async () => {
    let attempts = 0;
    renderApp({
      [`GET ${POSTS}`]: () => {
        attempts += 1;
        return attempts === 1
          ? apiError(503, 'SERVICE_UNAVAILABLE', 'Try again shortly')
          : json({ posts: [post({ caption: 'Back again' })], nextCursor: null });
      },
    });
    expect(await screen.findByText(/could not load this workspace's drafts/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Back again')).toBeVisible();
  });
});
