import type { AuthUser, Workspace } from '@metaflow/shared';
import { vi } from 'vitest';
import type { AuthContextValue, AuthState } from '@/contexts/auth-context';

export const TEST_USER: AuthUser = {
  id: '65f0c0ffee0000000000abcd',
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  status: 'active',
  emailVerified: false,
  createdAt: '2026-11-20T10:00:00.000Z',
};

/** A context value for guard/route tests that do not exercise the real provider. */
export function authValue(
  state: AuthState,
  overrides: Partial<AuthContextValue> = {},
): AuthContextValue {
  return {
    state,
    login: vi.fn(() => Promise.resolve()),
    register: vi.fn(() => Promise.resolve()),
    logout: vi.fn(() => Promise.resolve()),
    retry: vi.fn(),
    ...overrides,
  };
}

export const TEST_WORKSPACE: Workspace = {
  id: '65f0c0ffee00000000001111',
  name: 'Bloom Bakery',
  description: 'Sourdough and pastries.',
  category: 'restaurant',
  timezone: 'Asia/Karachi',
  defaultLanguage: 'en',
  status: 'active',
  role: 'owner',
  createdAt: '2026-11-20T10:00:00.000Z',
  updatedAt: '2026-11-20T10:00:00.000Z',
};

export const SIGNED_IN: AuthState = { status: 'authenticated', user: TEST_USER };

type Handler = (init: RequestInit) => Response | Promise<Response>;

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const apiError = (status: number, code: string, message: string, details?: unknown[]) =>
  json(
    { error: { code, message, requestId: 'req-test', ...(details ? { details } : {}) } },
    status,
  );

/** The URL of a fetch call, whatever form the first argument took. */
export function urlOf(input: string | URL | Request): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

/** The parsed JSON body of a fetch call. */
export function jsonBodyOf(init: RequestInit | undefined): Record<string, unknown> {
  return typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {};
}

/**
 * Stubs fetch, routing by "METHOD /path". Unless a test says otherwise, the signed-in user has
 * one workspace (TEST_WORKSPACE). Other unlisted routes stay pending (e.g. health checks the
 * dashboard fires), so they never resolve during a test. Returns the mock for call assertions.
 */
const DEFAULT_ROUTES: Record<string, Handler> = {
  'GET /api/workspaces': () => json({ workspaces: [TEST_WORKSPACE] }),
};

export function mockApi(routes: Record<string, Handler>) {
  const fetchMock = vi.fn((input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(urlOf(input), 'http://localhost:3000');
    const key = `${(init.method ?? 'GET').toUpperCase()} ${url.pathname}`;
    const handler = routes[key] ?? DEFAULT_ROUTES[key];
    return handler ? Promise.resolve(handler(init)) : new Promise<Response>(() => {});
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
