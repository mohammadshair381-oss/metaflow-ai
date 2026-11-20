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

/** Real providers, router and API client; only the network (fetch) is mocked. */
function renderApp(path: string, routes: Parameters<typeof mockApi>[0] = {}) {
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
  return { router, fetchMock, callsTo };
}

const SECOND: Workspace = {
  ...TEST_WORKSPACE,
  id: '65f0c0ffee00000000002222',
  name: 'Loom Studio',
  description: '',
  category: 'fashion',
  role: 'staff',
};
const STORAGE_KEY = `metaflow.activeWorkspace.${TEST_USER.id}`;
const workspaces = (...list: Workspace[]) => ({
  'GET /api/workspaces': () => json({ workspaces: list }),
});
const type = (label: string | RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('first workspace', () => {
  it('asks a user without a workspace to create one, then opens the dashboard', async () => {
    const created: Workspace = { ...TEST_WORKSPACE, name: 'Bloom Bakery' };
    const { callsTo } = renderApp('/dashboard', {
      ...workspaces(),
      'POST /api/workspaces': () => json({ workspace: created }, 201),
    });

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Create your first workspace' }),
    ).toBeVisible();
    expect(screen.queryByLabelText('Workspace')).toBeNull();

    type('Workspace name', '  Bloom Bakery ');
    type('Business category', 'restaurant');
    type('About the business', 'Sourdough and pastries.');
    type('Content language', 'ur');
    fireEvent.click(screen.getByRole('button', { name: 'Create workspace' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
    expect(jsonBodyOf(callsTo('POST', '/api/workspaces')[0]?.[1])).toMatchObject({
      name: 'Bloom Bakery',
      category: 'restaurant',
      description: 'Sourdough and pastries.',
      defaultLanguage: 'ur',
    });
    expect(screen.getByLabelText('Workspace')).toHaveValue(created.id);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(created.id);
  });

  it('validates in the browser before sending anything', async () => {
    const { callsTo } = renderApp('/dashboard', workspaces());
    await screen.findByRole('heading', { level: 1, name: 'Create your first workspace' });

    fireEvent.click(screen.getByRole('button', { name: 'Create workspace' }));

    expect(await screen.findByText('Workspace name is required')).toBeVisible();
    expect(screen.getByLabelText('Workspace name')).toHaveAttribute('aria-invalid', 'true');
    expect(callsTo('POST', '/api/workspaces')).toHaveLength(0);
  });

  it('shows the server’s reason when the workspace cannot be created', async () => {
    renderApp('/workspaces/new', {
      'POST /api/workspaces': () =>
        apiError(
          409,
          'LIMIT_REACHED',
          'You can own up to 10 workspaces. Archive one to create another.',
        ),
    });
    await screen.findByRole('heading', { level: 1, name: 'New workspace' });

    type('Workspace name', 'One more');
    fireEvent.click(screen.getByRole('button', { name: 'Create workspace' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('You can own up to 10 workspaces');
    expect(screen.getByRole('button', { name: 'Create workspace' })).toBeEnabled();
  });

  it('offers a retry when the workspaces cannot be loaded', async () => {
    let attempts = 0;
    renderApp('/dashboard', {
      'GET /api/workspaces': () => {
        attempts += 1;
        if (attempts === 1) throw new TypeError('Failed to fetch');
        return json({ workspaces: [TEST_WORKSPACE] });
      },
    });

    expect(
      await screen.findByRole('heading', { level: 1, name: /can't load your workspaces/i }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
  });
});

describe('switching workspaces', () => {
  it('shows the active workspace and switches to another one', async () => {
    renderApp('/dashboard', workspaces(TEST_WORKSPACE, SECOND));

    const switcher = await screen.findByLabelText('Workspace');
    expect(switcher).toHaveValue(TEST_WORKSPACE.id);
    expect(screen.getByText('Restaurants and food')).toBeVisible();

    fireEvent.change(switcher, { target: { value: SECOND.id } });

    expect(await screen.findByText('Clothing and fashion')).toBeVisible();
    expect(screen.getByText('Staff')).toBeVisible();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(SECOND.id);
  });

  it('reopens the workspace used last time', async () => {
    window.localStorage.setItem(STORAGE_KEY, SECOND.id);
    renderApp('/dashboard', workspaces(TEST_WORKSPACE, SECOND));
    expect(await screen.findByLabelText('Workspace')).toHaveValue(SECOND.id);
  });

  it('falls back to the first workspace when the remembered one is no longer the user’s', async () => {
    window.localStorage.setItem(STORAGE_KEY, 'aaaaaaaaaaaaaaaaaaaaaaaa');
    renderApp('/dashboard', workspaces(TEST_WORKSPACE, SECOND));
    expect(await screen.findByLabelText('Workspace')).toHaveValue(TEST_WORKSPACE.id);
  });
});

describe('workspace settings', () => {
  const membersPath = `/api/workspaces/${TEST_WORKSPACE.id}/members`;
  const members = {
    [`GET ${membersPath}`]: () =>
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
            userId: '65f0c0ffee0000000000beef',
            name: 'Sam Staff',
            email: 'sam@example.com',
            role: 'staff',
            joinedAt: '2026-11-20T11:00:00.000Z',
          },
        ],
      }),
  };

  it('lets the owner edit the business profile and confirms the save', async () => {
    const updated: Workspace = { ...TEST_WORKSPACE, name: 'Bloom Bakery & Café' };
    const { callsTo } = renderApp('/settings', {
      ...members,
      [`PATCH /api/workspaces/${TEST_WORKSPACE.id}`]: () => json({ workspace: updated }),
    });
    await screen.findByRole('heading', { level: 1, name: 'Workspace settings' });
    expect(screen.getByLabelText('Workspace name')).toHaveValue('Bloom Bakery');
    expect(screen.getByLabelText('Time zone')).toHaveValue('Asia/Karachi');

    type('Workspace name', 'Bloom Bakery & Café');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('Changes saved.')).toBeVisible();
    expect(
      jsonBodyOf(callsTo('PATCH', `/api/workspaces/${TEST_WORKSPACE.id}`)[0]?.[1]),
    ).toMatchObject({ name: 'Bloom Bakery & Café', timezone: 'Asia/Karachi' });
    expect(within(screen.getByLabelText('Workspace')).getByRole('option')).toHaveTextContent(
      'Bloom Bakery & Café',
    );
  });

  it('lists the members with their roles', async () => {
    renderApp('/settings', members);
    expect(await screen.findByText('Sam Staff')).toBeVisible();
    expect(screen.getByText('sam@example.com')).toBeVisible();
    const list = screen.getByText('Sam Staff').closest('ul') as HTMLElement;
    expect(within(list).getByText('Ada Lovelace')).toBeVisible();
    expect(
      within(list)
        .getAllByText(/^(Owner|Staff)$/)
        .map((el) => el.textContent),
    ).toEqual(['Owner', 'Staff']);
  });

  it('says so when the members cannot be loaded', async () => {
    renderApp('/settings', {
      [`GET ${membersPath}`]: () => apiError(503, 'SERVICE_UNAVAILABLE', 'Try again shortly'),
    });
    expect(await screen.findByText(/could not load the members/i)).toBeVisible();
  });

  it('shows staff the details without any way to edit or archive', async () => {
    const asStaff: Workspace = { ...TEST_WORKSPACE, role: 'staff' };
    renderApp('/settings', {
      ...workspaces(asStaff),
      ...members,
    });
    await screen.findByRole('heading', { level: 1, name: 'Workspace settings' });

    expect(screen.getByText(/only the workspace owner can change/i)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Archive workspace' })).toBeNull();
    expect(screen.queryByLabelText('Workspace name')).toBeNull();
  });

  it('archives only after the workspace name is typed, then asks for a new workspace', async () => {
    const archivePath = `/api/workspaces/${TEST_WORKSPACE.id}/archive`;
    const { callsTo } = renderApp('/settings', {
      ...members,
      [`POST ${archivePath}`]: () => new Response(null, { status: 204 }),
    });
    const button = await screen.findByRole('button', { name: 'Archive workspace' });
    expect(button).toBeDisabled();

    type(/to confirm/, 'Bloom');
    expect(button).toBeDisabled();
    type(/to confirm/, 'Bloom Bakery');
    expect(button).toBeEnabled();
    fireEvent.click(button);

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Create your first workspace' }),
    ).toBeVisible();
    expect(jsonBodyOf(callsTo('POST', archivePath)[0]?.[1])).toEqual({
      confirmName: 'Bloom Bakery',
    });
    await waitFor(() => expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull());
  });

  it('keeps the workspace and explains when archiving is refused', async () => {
    renderApp('/settings', {
      ...members,
      [`POST /api/workspaces/${TEST_WORKSPACE.id}/archive`]: () =>
        apiError(403, 'PERMISSION_DENIED', 'Only the workspace owner can do this'),
    });
    const button = await screen.findByRole('button', { name: 'Archive workspace' });
    type(/to confirm/, 'Bloom Bakery');
    fireEvent.click(button);

    expect(await screen.findByText('Only the workspace owner can do this')).toBeVisible();
    expect(screen.getByRole('heading', { level: 1, name: 'Workspace settings' })).toBeVisible();
  });
});
