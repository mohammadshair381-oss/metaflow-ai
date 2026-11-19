// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, type InitialEntry } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthState } from '@/contexts/auth-context';
import { PLANNED_MODULES } from './navigation';
import { appRoutes } from './router';

const UNAVAILABLE: AuthState = { status: 'unavailable' };
const SIGNED_IN: AuthState = {
  status: 'authenticated',
  user: { id: 'u1', name: 'Test User', email: 'test@example.com' },
};

function renderAt(entry: InitialEntry, auth: AuthState = UNAVAILABLE) {
  const router = createMemoryRouter(appRoutes, { initialEntries: [entry] });
  render(
    <AuthContext.Provider value={auth}>
      <RouterProvider router={router} />
    </AuthContext.Provider>,
  );
  return router;
}

beforeEach(() => {
  // The dashboard checks the backend on mount; keep those requests pending in route tests.
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise<Response>(() => {})),
  );
  // jsdom does not implement scrolling; ScrollRestoration calls it on navigation.
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('routes', () => {
  it('renders the public landing page at /', async () => {
    renderAt('/');
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(/run by AI/);
    expect(screen.getAllByRole('link', { name: /dashboard/i })[0]).toHaveAttribute(
      'href',
      '/dashboard',
    );
  });

  it('renders the dashboard with the live backend status panel', async () => {
    renderAt('/dashboard');
    expect(await screen.findByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
    expect(screen.getByText('Backend connection')).toBeVisible();
    expect(screen.getByText('Checking…')).toBeVisible();
  });

  it.each(PLANNED_MODULES.map((module) => [module.path, module] as const))(
    '%s renders an honest empty state',
    async (path, module) => {
      renderAt(path);
      expect(await screen.findByRole('heading', { level: 1, name: module.label })).toBeVisible();
      expect(screen.getByText(`${module.label} is not available yet`)).toBeVisible();
      expect(screen.getByText(`Planned · Milestone ${module.milestone.number}`)).toBeVisible();
      // No fake functionality: planned modules expose no inputs.
      expect(screen.queryByRole('textbox')).toBeNull();
      expect(screen.queryByRole('combobox')).toBeNull();
    },
  );

  it('marks the current page in the sidebar', async () => {
    renderAt('/ai-studio');
    const link = await screen.findByRole('link', { name: /AI Studio/ });
    expect(link).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: /^Dashboard$/ })).not.toHaveAttribute('aria-current');
  });

  it.each(['/login', '/register'])('%s explains that accounts are not available', async (path) => {
    renderAt(path);
    expect(await screen.findByText('Accounts are not available yet.')).toBeVisible();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('shows a not-found page for unknown nested paths', async () => {
    renderAt('/does/not/exist');
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeVisible();
  });

  it.each([
    '/',
    '/dashboard',
    '/login',
    '/register',
    '/does/not/exist',
    ...PLANNED_MODULES.map((module) => module.path),
  ])('%s has exactly one top-level heading', async (path) => {
    renderAt(path);
    await screen.findByRole('heading', { level: 1 });
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('sets the document title per page', async () => {
    renderAt('/calendar');
    await screen.findByRole('heading', { level: 1, name: 'Content Calendar' });
    expect(document.title).toBe('Content Calendar · MetaFlow AI');
  });
});

describe('protected routes', () => {
  it('render in preview mode with a notice while sign-in is unavailable', async () => {
    renderAt('/posts');
    expect(await screen.findByRole('heading', { level: 1, name: 'Posts' })).toBeVisible();
    expect(screen.getByRole('note')).toHaveTextContent('Preview mode');
  });

  it('show a loading state while the session is being checked', async () => {
    renderAt('/posts', { status: 'loading' });
    // "Loading…" shows first while the lazy route chunk loads; then the session check.
    expect(await screen.findByText('Checking your session…')).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Posts' })).toBeNull();
  });

  it('redirect anonymous users to /login and remember where they were going', async () => {
    const router = renderAt('/analytics?range=30d', { status: 'anonymous' });
    expect(await screen.findByText('Accounts are not available yet.')).toBeVisible();
    expect(router.state.location.pathname).toBe('/login');
    expect(router.state.location.state).toEqual({ from: '/analytics?range=30d' });
  });

  it('render for authenticated users without the preview notice', async () => {
    renderAt('/team', SIGNED_IN);
    expect(await screen.findByRole('heading', { level: 1, name: 'Team' })).toBeVisible();
    expect(screen.queryByRole('note')).toBeNull();
  });
});

describe('guest routes', () => {
  it('send authenticated users from /login to the dashboard', async () => {
    const router = renderAt('/login', SIGNED_IN);
    await screen.findByRole('heading', { level: 1, name: 'Dashboard' });
    expect(router.state.location.pathname).toBe('/dashboard');
  });

  it('send authenticated users back to the page they originally requested', async () => {
    const router = renderAt({ pathname: '/login', state: { from: '/calendar' } }, SIGNED_IN);
    await screen.findByRole('heading', { level: 1, name: 'Content Calendar' });
    expect(router.state.location.pathname).toBe('/calendar');
  });

  it('never follow a redirect target outside the app', async () => {
    const router = renderAt({ pathname: '/login', state: { from: '//evil.example' } }, SIGNED_IN);
    await screen.findByRole('heading', { level: 1, name: 'Dashboard' });
    expect(router.state.location.pathname).toBe('/dashboard');
  });
});
