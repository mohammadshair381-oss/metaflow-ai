// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SystemStatusPanel } from './system-status-panel';

const HEALTH = {
  status: 'ok',
  service: 'metaflow-backend',
  version: '0.1.0',
  commit: 'abc1234',
  environment: 'production',
  uptimeSeconds: 3725,
  timestamp: '2026-11-19T10:00:00.000Z',
};

function readiness(status: 'ready' | 'not_ready', database: Record<string, unknown>) {
  return { status, timestamp: '2026-11-19T10:00:00.000Z', checks: { database } };
}

function json(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

/** Route the two health calls the panel makes to separate fake responses. */
function mockBackend(health: () => Promise<Response>, ready: () => Promise<Response>) {
  const fetchMock = vi.fn((url: string) =>
    url.endsWith('/api/health/ready') ? ready() : health(),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('SystemStatusPanel (status comes from real responses, never hardcoded)', () => {
  it('shows Connected when the API is live and MongoDB answers', async () => {
    mockBackend(
      () => json(HEALTH),
      () => json(readiness('ready', { status: 'up', latencyMs: 3.2 })),
    );
    render(<SystemStatusPanel />);

    expect(await screen.findByText('Connected')).toBeVisible();
    expect(screen.getByText('MongoDB connected')).toBeVisible();
    expect(screen.getByText(/Responding in \d+ ms/)).toBeVisible();
    expect(screen.getByText('production')).toBeVisible();
    expect(screen.getByText('abc1234')).toBeVisible();
    expect(screen.getByText('1h 2m')).toBeVisible();
  });

  it('shows Connected with "not configured" when the API runs without a database', async () => {
    mockBackend(
      () => json(HEALTH),
      () => json(readiness('ready', { status: 'not_configured' })),
    );
    render(<SystemStatusPanel />);

    expect(await screen.findByText('Connected')).toBeVisible();
    expect(screen.getByText('Database not configured')).toBeVisible();
  });

  it('shows Degraded when the API is live but readiness returns 503', async () => {
    mockBackend(
      () => json(HEALTH),
      () => json(readiness('not_ready', { status: 'down' }), 503),
    );
    render(<SystemStatusPanel />);

    expect(await screen.findByText('Degraded')).toBeVisible();
    expect(screen.getByText('MongoDB unavailable')).toBeVisible();
  });

  it('shows Unreachable with troubleshooting tips when requests fail', async () => {
    mockBackend(
      () => Promise.reject(new TypeError('Failed to fetch')),
      () => Promise.reject(new TypeError('Failed to fetch')),
    );
    render(<SystemStatusPanel />);

    expect(await screen.findByText('Unreachable')).toBeVisible();
    expect(screen.getByText('Things to check')).toBeVisible();
  });

  it('treats a response that breaks the contract as unreachable, not connected', async () => {
    mockBackend(
      () => json({ hello: 'world' }),
      () => json(readiness('ready', { status: 'up' })),
    );
    render(<SystemStatusPanel />);

    expect(await screen.findByText('Unreachable')).toBeVisible();
    expect(screen.getByText(/does not recognize/)).toBeVisible();
  });

  it('re-checks both endpoints on "Check again"', async () => {
    const fetchMock = mockBackend(
      () => json(HEALTH),
      () => json(readiness('ready', { status: 'up' })),
    );
    render(<SystemStatusPanel />);
    await screen.findByText('Connected');
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole('button', { name: /check again/i }));
    await screen.findByText('Connected');
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
