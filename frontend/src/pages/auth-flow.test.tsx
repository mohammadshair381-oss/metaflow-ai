// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, type InitialEntry } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '@/contexts/auth-provider';
import { appRoutes } from '@/routes/router';
import { TEST_USER, apiError, json, jsonBodyOf, mockApi, urlOf } from '@/test/auth-test-utils';

/** Real provider, router and API client; only the network (fetch) is mocked. */
function renderApp(entry: InitialEntry) {
  const router = createMemoryRouter(appRoutes, { initialEntries: [entry] });
  render(
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>,
  );
  return router;
}

const signedOut = () => apiError(401, 'UNAUTHENTICATED', 'Sign in to continue');
const bodyOf = jsonBodyOf;
const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('session restoration', () => {
  it('keeps a signed-in user signed in after a reload (cookie session)', async () => {
    const fetchMock = mockApi({ 'GET /api/auth/me': () => json({ user: TEST_USER }) });
    renderApp('/dashboard');

    expect(await screen.findByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    const [, init] =
      fetchMock.mock.calls.find(([url]) => urlOf(url).endsWith('/api/auth/me')) ?? [];
    expect(init?.credentials).toBe('include');
  });

  it('sends visitors without a session to /login', async () => {
    mockApi({ 'GET /api/auth/me': signedOut });
    const router = renderApp('/dashboard');

    expect(await screen.findByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
    expect(router.state.location.pathname).toBe('/login');
  });

  it('shows a retry screen when the server is unreachable, then recovers', async () => {
    let attempts = 0;
    mockApi({
      'GET /api/auth/me': () => {
        attempts += 1;
        if (attempts === 1) throw new TypeError('Failed to fetch');
        return json({ user: TEST_USER });
      },
    });
    renderApp('/dashboard');

    expect(await screen.findByRole('heading', { level: 1, name: /can't reach/i })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
  });
});

describe('sign in', () => {
  it('validates in the browser before sending anything', async () => {
    const fetchMock = mockApi({ 'GET /api/auth/me': signedOut });
    renderApp('/login');
    await screen.findByRole('heading', { level: 1, name: 'Sign in' });

    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Enter a valid email address')).toBeVisible();
    expect(screen.getByText('Password is required')).toBeVisible();
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    expect(fetchMock.mock.calls.some(([url]) => urlOf(url).endsWith('/api/auth/login'))).toBe(
      false,
    );
  });

  it('signs in and continues to the page the user wanted', async () => {
    const fetchMock = mockApi({
      'GET /api/auth/me': signedOut,
      'POST /api/auth/login': () => json({ user: TEST_USER }),
    });
    const router = renderApp('/calendar');
    await screen.findByRole('heading', { level: 1, name: 'Sign in' });

    type('Email', '  ADA@Example.com ');
    type('Password', 'correct horse battery staple');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Content Calendar' }),
    ).toBeVisible();
    expect(router.state.location.pathname).toBe('/calendar');
    const [, init] =
      fetchMock.mock.calls.find(([url]) => urlOf(url).endsWith('/api/auth/login')) ?? [];
    expect(init?.credentials).toBe('include');
    expect(bodyOf(init)).toEqual({
      email: 'ada@example.com',
      password: 'correct horse battery staple',
    });
  });

  it('shows the generic error for wrong credentials and lets the user retry', async () => {
    mockApi({
      'GET /api/auth/me': signedOut,
      'POST /api/auth/login': () =>
        apiError(401, 'INVALID_CREDENTIALS', 'Incorrect email or password'),
    });
    const router = renderApp('/login');
    await screen.findByRole('heading', { level: 1, name: 'Sign in' });

    type('Email', 'ada@example.com');
    type('Password', 'wrong password');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect email or password');
    expect(router.state.location.pathname).toBe('/login');
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  });

  it('explains when too many attempts were made', async () => {
    mockApi({
      'GET /api/auth/me': signedOut,
      'POST /api/auth/login': () =>
        apiError(429, 'RATE_LIMITED', 'Too many attempts. Wait a few minutes and try again.'),
    });
    renderApp('/login');
    await screen.findByRole('heading', { level: 1, name: 'Sign in' });

    type('Email', 'ada@example.com');
    type('Password', 'anything at all');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/too many attempts/i);
  });
});

describe('registration', () => {
  it('rejects a weak password in the browser', async () => {
    const fetchMock = mockApi({ 'GET /api/auth/me': signedOut });
    renderApp('/register');
    await screen.findByRole('heading', { level: 1, name: 'Create your account' });

    type('Name', 'Ada Lovelace');
    type('Email', 'ada@example.com');
    type('Password', '1234567890');
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText(/too common/i)).toBeVisible();
    expect(fetchMock.mock.calls.some(([url]) => urlOf(url).endsWith('/api/auth/register'))).toBe(
      false,
    );
  });

  it('shows "email already registered" next to the email field', async () => {
    mockApi({
      'GET /api/auth/me': signedOut,
      'POST /api/auth/register': () =>
        apiError(409, 'EMAIL_TAKEN', 'An account with this email already exists'),
    });
    renderApp('/register');
    await screen.findByRole('heading', { level: 1, name: 'Create your account' });

    type('Name', 'Ada Lovelace');
    type('Email', 'ada@example.com');
    type('Password', 'correct horse battery staple');
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('An account with this email already exists')).toBeVisible();
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
  });

  it('maps server-side validation details onto the form fields', async () => {
    mockApi({
      'GET /api/auth/me': signedOut,
      'POST /api/auth/register': () =>
        apiError(400, 'VALIDATION_ERROR', 'Request validation failed', [
          { path: 'body.password', message: 'Use at least 10 characters' },
        ]),
    });
    renderApp('/register');
    await screen.findByRole('heading', { level: 1, name: 'Create your account' });

    type('Name', 'Ada Lovelace');
    type('Email', 'ada@example.com');
    type('Password', 'correct horse battery staple');
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('Use at least 10 characters')).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent('Check the highlighted fields.');
  });

  it('creates the account, signs in and opens the dashboard', async () => {
    const fetchMock = mockApi({
      'GET /api/auth/me': signedOut,
      'POST /api/auth/register': () => json({ user: TEST_USER }, 201),
    });
    const router = renderApp('/register');
    await screen.findByRole('heading', { level: 1, name: 'Create your account' });

    type('Name', '  Ada Lovelace ');
    type('Email', 'ada@example.com');
    type('Password', 'correct horse battery staple');
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
    expect(router.state.location.pathname).toBe('/dashboard');
    const [, init] =
      fetchMock.mock.calls.find(([url]) => urlOf(url).endsWith('/api/auth/register')) ?? [];
    expect(bodyOf(init)).toMatchObject({ name: 'Ada Lovelace', email: 'ada@example.com' });
  });
});

describe('sign out', () => {
  it('ends the session on the server and returns to the sign-in page', async () => {
    const fetchMock = mockApi({
      'GET /api/auth/me': () => json({ user: TEST_USER }),
      'POST /api/auth/logout': () => new Response(null, { status: 204 }),
    });
    const router = renderApp('/dashboard');
    await screen.findByRole('heading', { level: 1, name: 'Dashboard' });

    fireEvent.click(screen.getByRole('button', { name: /sign out/i }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
    expect(router.state.location.pathname).toBe('/login');
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) => urlOf(url).endsWith('/api/auth/logout') && init?.method === 'POST',
      ),
    ).toBe(true);
  });

  it('stays signed in and says so if the server could not end the session', async () => {
    mockApi({
      'GET /api/auth/me': () => json({ user: TEST_USER }),
      'POST /api/auth/logout': () =>
        apiError(500, 'INTERNAL_ERROR', 'An unexpected error occurred'),
    });
    const router = renderApp('/dashboard');
    await screen.findByRole('heading', { level: 1, name: 'Dashboard' });

    fireEvent.click(screen.getByRole('button', { name: /sign out/i }));

    expect(await screen.findByText('Sign-out failed. Try again.')).toBeVisible();
    await waitFor(() => expect(router.state.location.pathname).toBe('/dashboard'));
  });
});
