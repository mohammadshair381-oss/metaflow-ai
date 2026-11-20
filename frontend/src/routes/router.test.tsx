// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, type InitialEntry } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextValue, type AuthState } from '@/contexts/auth-context';
import { SIGNED_IN, authValue, mockApi } from '@/test/auth-test-utils';
import { PLANNED_MODULES } from './navigation';
import { appRoutes } from './router';

const ANONYMOUS: AuthState = { status: 'anonymous' };

function renderAt(entry: InitialEntry, auth: AuthState | AuthContextValue = SIGNED_IN) {
  const value = 'state' in auth ? auth : authValue(auth);
  const router = createMemoryRouter(appRoutes, { initialEntries: [entry] });
  render(
    <AuthContext.Provider value={value}>
      <RouterProvider router={router} />
    </AuthContext.Provider>,
  );
  return router;
}

beforeEach(() => {
  // The user has one workspace; the dashboard's backend checks stay pending in route tests.
  mockApi({});
  // jsdom does not implement scrolling; ScrollRestoration calls it on navigation.
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('routes', () => {
  it('shows the landing page with sign-in and registration links to visitors', async () => {
    renderAt('/', ANONYMOUS);
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(/run by AI/);
    expect(screen.getAllByRole('link', { name: /create account/i })[0]).toHaveAttribute(
      'href',
      '/register',
    );
    expect(screen.getAllByRole('link', { name: /sign in/i })[0]).toHaveAttribute('href', '/login');
    expect(screen.queryByRole('link', { name: /go to dashboard/i })).toBeNull();
  });

  it('offers the dashboard on the landing page to signed-in users', async () => {
    renderAt('/', SIGNED_IN);
    await screen.findByRole('heading', { level: 1 });
    expect(screen.getAllByRole('link', { name: /go to dashboard/i })[0]).toHaveAttribute(
      'href',
      '/dashboard',
    );
  });

  it('renders the dashboard with the live backend status panel and the signed-in user', async () => {
    renderAt('/dashboard');
    expect(await screen.findByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
    expect(screen.getByText('Backend connection')).toBeVisible();
    expect(screen.getByText('Checking…')).toBeVisible();
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign out/i })).toBeVisible();
    expect(screen.queryByText(/preview mode/i)).toBeNull();
  });

  it.each(PLANNED_MODULES.map((module) => [module.path, module] as const))(
    '%s renders an honest empty state',
    async (path, module) => {
      renderAt(path);
      expect(await screen.findByRole('heading', { level: 1, name: module.label })).toBeVisible();
      expect(screen.getByText(`${module.label} is not available yet`)).toBeVisible();
      expect(screen.getByText(`Planned · Milestone ${module.milestone.number}`)).toBeVisible();
      expect(screen.queryByRole('textbox')).toBeNull();
    },
  );

  it('marks the current page in the sidebar', async () => {
    renderAt('/ai-studio');
    const link = await screen.findByRole('link', { name: /AI Studio/ });
    expect(link).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: /^Dashboard$/ })).not.toHaveAttribute('aria-current');
  });

  it('shows the real sign-in form at /login', async () => {
    renderAt('/login', ANONYMOUS);
    expect(await screen.findByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
    expect(screen.getByLabelText('Email')).toBeVisible();
    expect(screen.getByLabelText('Password')).toBeVisible();
  });

  it('shows the real registration form at /register', async () => {
    renderAt('/register', ANONYMOUS);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Create your account' }),
    ).toBeVisible();
    expect(screen.getByLabelText('Name')).toBeVisible();
  });

  it('shows a not-found page for unknown nested paths', async () => {
    renderAt('/does/not/exist', ANONYMOUS);
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeVisible();
  });

  it.each([
    ['/', ANONYMOUS],
    ['/login', ANONYMOUS],
    ['/register', ANONYMOUS],
    ['/does/not/exist', ANONYMOUS],
    ['/dashboard', SIGNED_IN],
    ...PLANNED_MODULES.map((module) => [module.path, SIGNED_IN] as const),
  ] as const)('%s has exactly one top-level heading', async (path, auth) => {
    renderAt(path, auth);
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
  it('show a loading state while the session is restored', async () => {
    renderAt('/posts', { status: 'loading' });
    // "Loading…" shows first while the lazy route chunk loads; then the session check.
    expect(await screen.findByText('Checking your session…')).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Posts' })).toBeNull();
  });

  it('redirect visitors to /login and remember where they were going', async () => {
    const router = renderAt('/analytics?range=30d', ANONYMOUS);
    expect(await screen.findByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
    expect(router.state.location.pathname).toBe('/login');
    expect(router.state.location.state).toEqual({ from: '/analytics?range=30d' });
  });

  it('show a retryable error, not the sign-in page, when the session cannot be checked', async () => {
    const value = authValue({ status: 'error', message: 'We could not reach the server.' });
    const router = renderAt('/team', value);

    expect(await screen.findByRole('heading', { level: 1, name: /can't reach/i })).toBeVisible();
    expect(router.state.location.pathname).toBe('/team');
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(value.retry).toHaveBeenCalledOnce();
  });

  it('render for signed-in users', async () => {
    renderAt('/team', SIGNED_IN);
    expect(await screen.findByRole('heading', { level: 1, name: 'Team' })).toBeVisible();
  });
});

describe('guest routes', () => {
  it('wait for the session check instead of flashing the form', async () => {
    renderAt('/login', { status: 'loading' });
    expect(await screen.findByText('Loading…')).toBeVisible();
    expect(screen.queryByLabelText('Email')).toBeNull();
  });

  it('send signed-in users from /login to the dashboard', async () => {
    const router = renderAt('/login', SIGNED_IN);
    await screen.findByRole('heading', { level: 1, name: 'Dashboard' });
    expect(router.state.location.pathname).toBe('/dashboard');
  });

  it('send signed-in users back to the page they originally requested', async () => {
    const router = renderAt({ pathname: '/login', state: { from: '/calendar' } }, SIGNED_IN);
    await screen.findByRole('heading', { level: 1, name: 'Content Calendar' });
    expect(router.state.location.pathname).toBe('/calendar');
  });

  it.each(['//evil.example', '/\\evil.example', 'https://evil.example'])(
    'never follow a redirect target outside the app (%j)',
    async (from) => {
      const router = renderAt({ pathname: '/login', state: { from } }, SIGNED_IN);
      await screen.findByRole('heading', { level: 1, name: 'Dashboard' });
      expect(router.state.location.pathname).toBe('/dashboard');
    },
  );

  it('show the form with a server warning when the session check failed', async () => {
    renderAt('/login', {
      status: 'error',
      message: 'We could not reach the server to check your session.',
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not reach the server/i);
    expect(screen.getByLabelText('Email')).toBeVisible();
  });
});
