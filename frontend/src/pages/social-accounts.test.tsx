// @vitest-environment jsdom
import type { SocialAccount, Workspace } from '@metaflow/shared';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '@/contexts/auth-provider';
import { browser } from '@/lib/browser';
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

const PAGE: SocialAccount = {
  id: '65f0c0ffee0000000000aaaa',
  platform: 'facebook',
  externalId: '1001',
  name: 'Bloom Bakery',
  username: null,
  accountType: 'facebook_page',
  profileImageUrl: 'https://cdn.example/1001.jpg',
  status: 'connected',
  issue: null,
  grantedPermissions: ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts'],
  missingPermissions: [],
  tokenExpiresAt: null,
  connectedAt: '2026-11-20T10:00:00.000Z',
  lastSyncedAt: '2026-11-20T10:00:00.000Z',
};
const INSTAGRAM: SocialAccount = {
  ...PAGE,
  id: '65f0c0ffee0000000000bbbb',
  platform: 'instagram',
  externalId: '17841400000000001',
  name: 'Bloom Bakery IG',
  username: 'bloombakery',
  accountType: 'instagram_professional',
  profileImageUrl: null,
  status: 'needs_reconnect',
  issue: 'missing_permissions',
  missingPermissions: ['instagram_content_publish'],
};
const SECOND_WORKSPACE: Workspace = {
  ...TEST_WORKSPACE,
  id: '65f0c0ffee00000000002222',
  name: 'Loom Studio',
};
const OTHER_PAGE: SocialAccount = {
  ...PAGE,
  id: '65f0c0ffee0000000000cccc',
  name: 'Loom Studio Page',
};

const accountsPath = (workspaceId = TEST_WORKSPACE.id) =>
  `/api/workspaces/${workspaceId}/social-accounts`;
const listOf = (accounts: SocialAccount[], configured = true, workspaceId?: string) => ({
  [`GET ${accountsPath(workspaceId)}`]: () => json({ accounts, integration: { configured } }),
});

function renderApp(routes: Parameters<typeof mockApi>[0], path = '/accounts') {
  const fetchMock = mockApi({ 'GET /api/auth/me': () => json({ user: TEST_USER }), ...routes });
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

const card = (name: string) =>
  screen.getByRole('heading', { level: 3, name }).closest('[data-slot="card"]') as HTMLElement;

let assign: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  assign = vi.spyOn(browser, 'assign').mockImplementation(() => {});
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('social accounts page', () => {
  it('shows a loading state, then an honest empty state', async () => {
    renderApp(listOf([]));
    expect(await screen.findByText('Loading connected accounts…')).toBeInTheDocument();
    expect(await screen.findByText('No accounts connected yet')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Connect Facebook Pages' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Connect Instagram accounts' })).toBeEnabled();
  });

  it('lists connected accounts with platform, type, status, ID and dates', async () => {
    renderApp(listOf([PAGE, INSTAGRAM]));

    const page = within(await waitFor(() => card('Bloom Bakery')));
    expect(page.getByText('Facebook')).toBeVisible();
    expect(page.getByText('Facebook Page')).toBeVisible();
    expect(page.getByText('Connected')).toBeVisible();
    expect(page.getByText('1001')).toBeVisible();
    // 10:00 UTC shown in the workspace's time zone (Asia/Karachi, UTC+5).
    expect(page.getAllByText(/3:00\s?pm|15:00/i)).toHaveLength(2);
    expect(page.queryByRole('button', { name: 'Reconnect' })).toBeNull();

    const instagram = within(card('Bloom Bakery IG'));
    expect(instagram.getByText(/@bloombakery · Instagram professional account/)).toBeVisible();
    expect(instagram.getByText('Needs attention')).toBeVisible();
  });

  it('explains missing permissions and offers to reconnect', async () => {
    const { callsTo } = renderApp({
      ...listOf([INSTAGRAM]),
      [`POST ${accountsPath()}/connect`]: () =>
        json({ authorizationUrl: 'https://www.facebook.com/v27.0/dialog/oauth?state=abc' }),
    });
    const instagram = within(await waitFor(() => card('Bloom Bakery IG')));

    expect(instagram.getByRole('alert')).toHaveTextContent(/permissions were not granted/);
    expect(instagram.getByRole('alert')).toHaveTextContent('Missing: instagram_content_publish');

    fireEvent.click(instagram.getByRole('button', { name: 'Reconnect' }));
    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    expect(jsonBodyOf(callsTo('POST', `${accountsPath()}/connect`)[0]?.[1])).toEqual({
      platform: 'instagram',
    });
  });

  it('never shows a token field', async () => {
    renderApp(listOf([PAGE]));
    await waitFor(() => card('Bloom Bakery'));
    expect(document.body.textContent).not.toMatch(/token/i);
  });
});

describe('connecting', () => {
  it('sends the browser to Facebook’s login page and nowhere else', async () => {
    const { callsTo } = renderApp({
      ...listOf([]),
      [`POST ${accountsPath()}/connect`]: () =>
        json({
          authorizationUrl: 'https://www.facebook.com/v27.0/dialog/oauth?client_id=1&state=abc',
        }),
    });

    await screen.findByText('No accounts connected yet');
    fireEvent.click(screen.getByRole('button', { name: 'Connect Facebook Pages' }));

    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith(
        'https://www.facebook.com/v27.0/dialog/oauth?client_id=1&state=abc',
      ),
    );
    expect(jsonBodyOf(callsTo('POST', `${accountsPath()}/connect`)[0]?.[1])).toEqual({
      platform: 'facebook',
    });
    // Nothing is shown as connected until Facebook sends the person back.
    expect(screen.getByText('No accounts connected yet')).toBeVisible();
  });

  it('refuses to follow an authorization address that is not Facebook', async () => {
    renderApp({
      ...listOf([]),
      [`POST ${accountsPath()}/connect`]: () =>
        json({ authorizationUrl: 'https://evil.example/dialog/oauth' }),
    });
    await screen.findByText('No accounts connected yet');
    fireEvent.click(screen.getByRole('button', { name: 'Connect Instagram accounts' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/something went wrong/i);
    expect(assign).not.toHaveBeenCalled();
  });

  it('explains that setup is pending and disables connecting when the server is not configured', async () => {
    renderApp(listOf([], false));
    expect(await screen.findByText(/has not been\s+linked to a Meta app/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Connect Facebook Pages' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Connect Instagram accounts' })).toBeDisabled();
  });

  it('shows the server’s reason when a connection cannot be started', async () => {
    renderApp({
      ...listOf([]),
      [`POST ${accountsPath()}/connect`]: () =>
        apiError(429, 'RATE_LIMITED', 'Too many attempts. Wait a few minutes and try again.'),
    });
    await screen.findByText('No accounts connected yet');
    fireEvent.click(screen.getByRole('button', { name: 'Connect Facebook Pages' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many attempts');
    expect(screen.getByRole('button', { name: 'Connect Facebook Pages' })).toBeEnabled();
  });

  it.each([
    ['connected&count=2', 'status', '2 accounts are connected.'],
    ['connected&count=1', 'status', '1 account is connected.'],
    ['denied', 'alert', /cancelled on Facebook/],
    ['invalid_state', 'alert', /expired or was already used/],
    ['no_accounts', 'alert', /Business or Creator account linked to a Facebook Page/],
    ['exchange_failed', 'alert', /did not complete the connection/],
  ])('reports the result "%s" after returning from Facebook', async (query, role, text) => {
    const { router } = renderApp(listOf([PAGE]), `/accounts?meta=${query}`);
    const message = await screen.findByText(text);
    expect(message.closest('[role]')).toHaveAttribute('role', role);
    await waitFor(() => expect(router.state.location.search).toBe(''));
  });

  it('ignores an unknown result code instead of displaying it', async () => {
    renderApp(listOf([PAGE]), '/accounts?meta=%3Cscript%3Ealert(1)%3C/script%3E');
    await waitFor(() => card('Bloom Bakery'));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(document.body.textContent).not.toContain('script');
  });
});

describe('managing accounts', () => {
  it('disconnects only after confirmation', async () => {
    const { callsTo } = renderApp({
      ...listOf([PAGE, INSTAGRAM]),
      [`DELETE ${accountsPath()}/${PAGE.id}`]: () => new Response(null, { status: 204 }),
    });
    const page = within(await waitFor(() => card('Bloom Bakery')));

    fireEvent.click(page.getByRole('button', { name: 'Disconnect' }));
    expect(page.getByText('Disconnect Bloom Bakery?')).toBeVisible();
    expect(callsTo('DELETE', `${accountsPath()}/${PAGE.id}`)).toHaveLength(0);

    fireEvent.click(page.getByRole('button', { name: 'Cancel' }));
    expect(page.queryByText('Disconnect Bloom Bakery?')).toBeNull();

    fireEvent.click(page.getByRole('button', { name: 'Disconnect' }));
    fireEvent.click(page.getByRole('button', { name: 'Yes, disconnect' }));

    expect(await screen.findByText('Bloom Bakery was disconnected.')).toBeVisible();
    expect(screen.queryByRole('heading', { level: 3, name: 'Bloom Bakery' })).toBeNull();
    expect(screen.getByRole('heading', { level: 3, name: 'Bloom Bakery IG' })).toBeVisible();
  });

  it('keeps the account and explains when disconnecting fails', async () => {
    renderApp({
      ...listOf([PAGE]),
      [`DELETE ${accountsPath()}/${PAGE.id}`]: () =>
        apiError(403, 'PERMISSION_DENIED', 'Only the workspace owner can do this'),
    });
    const page = within(await waitFor(() => card('Bloom Bakery')));
    fireEvent.click(page.getByRole('button', { name: 'Disconnect' }));
    fireEvent.click(page.getByRole('button', { name: 'Yes, disconnect' }));

    expect(await screen.findByText('Only the workspace owner can do this')).toBeVisible();
    expect(screen.getByRole('heading', { level: 3, name: 'Bloom Bakery' })).toBeVisible();
  });

  it('checks a connection and shows when it now needs reconnecting', async () => {
    renderApp({
      ...listOf([PAGE]),
      [`POST ${accountsPath()}/${PAGE.id}/refresh`]: () =>
        json({ account: { ...PAGE, status: 'needs_reconnect', issue: 'token_invalid' } }),
    });
    fireEvent.click(
      within(await waitFor(() => card('Bloom Bakery'))).getByRole('button', {
        name: 'Check connection',
      }),
    );

    expect(await screen.findByText(/Bloom Bakery needs attention/)).toBeVisible();
    const page = within(card('Bloom Bakery'));
    expect(page.getByText('Needs attention')).toBeVisible();
    expect(page.getByText(/no longer accepts this connection/)).toBeVisible();
    expect(page.getByRole('button', { name: 'Reconnect' })).toBeVisible();
  });

  it('shows staff the accounts without connect, reconnect or disconnect', async () => {
    renderApp({
      'GET /api/workspaces': () => json({ workspaces: [{ ...TEST_WORKSPACE, role: 'staff' }] }),
      ...listOf([INSTAGRAM]),
    });
    const instagram = within(await waitFor(() => card('Bloom Bakery IG')));

    expect(screen.getByText(/only the workspace owner can connect or disconnect/i)).toBeVisible();
    expect(screen.queryByRole('button', { name: /^Connect / })).toBeNull();
    expect(instagram.queryByRole('button', { name: 'Reconnect' })).toBeNull();
    expect(instagram.queryByRole('button', { name: 'Disconnect' })).toBeNull();
    expect(instagram.getByRole('button', { name: 'Check connection' })).toBeEnabled();
  });

  it('offers a retry when the accounts cannot be loaded', async () => {
    let attempts = 0;
    renderApp({
      [`GET ${accountsPath()}`]: () => {
        attempts += 1;
        return attempts === 1
          ? apiError(503, 'SERVICE_UNAVAILABLE', 'Try again shortly')
          : json({ accounts: [PAGE], integration: { configured: true } });
      },
    });
    expect(
      await screen.findByText(/could not load this workspace's connected accounts/),
    ).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { level: 3, name: 'Bloom Bakery' })).toBeVisible();
  });
});

describe('switching workspaces', () => {
  it('shows only the selected workspace’s accounts, never the previous one’s', async () => {
    renderApp({
      'GET /api/workspaces': () => json({ workspaces: [TEST_WORKSPACE, SECOND_WORKSPACE] }),
      ...listOf([PAGE]),
      ...listOf([OTHER_PAGE], true, SECOND_WORKSPACE.id),
    });
    expect(await screen.findByRole('heading', { level: 3, name: 'Bloom Bakery' })).toBeVisible();

    fireEvent.change(screen.getByLabelText('Workspace'), {
      target: { value: SECOND_WORKSPACE.id },
    });

    // The old workspace's account is gone immediately, before the new list arrives.
    expect(screen.queryByRole('heading', { level: 3, name: 'Bloom Bakery' })).toBeNull();
    expect(
      await screen.findByRole('heading', { level: 3, name: 'Loom Studio Page' }),
    ).toBeVisible();
    expect(screen.queryByRole('heading', { level: 3, name: 'Bloom Bakery' })).toBeNull();
  });
});
