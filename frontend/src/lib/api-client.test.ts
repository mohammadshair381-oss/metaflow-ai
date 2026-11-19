import { healthResponseSchema, readinessResponseSchema } from '@metaflow/shared';
import { describe, expect, it, vi } from 'vitest';
import { ApiRequestError, apiRequest } from './api-client';

const BASE_URL = 'https://api.test';

const healthBody = {
  status: 'ok',
  service: 'metaflow-backend',
  version: '0.1.0',
  commit: 'abc1234',
  environment: 'production',
  uptimeSeconds: 42,
  timestamp: '2026-11-19T10:00:00.000Z',
};

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function mockFetch(implementation: (url: string, init?: RequestInit) => Promise<Response>) {
  return vi.fn(implementation) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

async function captureError(promise: Promise<unknown>): Promise<ApiRequestError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ApiRequestError);
    return error as ApiRequestError;
  }
  throw new Error('Expected the request to fail');
}

describe('apiRequest', () => {
  it('calls the configured base URL with credentials and parses the contract', async () => {
    const fetchImpl = mockFetch(() =>
      Promise.resolve(jsonResponse(healthBody, 200, { 'X-Request-Id': 'req-123' })),
    );

    const result = await apiRequest('/api/health', healthResponseSchema, {
      baseUrl: BASE_URL,
      fetchImpl,
    });

    expect(result.data).toEqual(healthBody);
    expect(result.status).toBe(200);
    expect(result.requestId).toBe('req-123');
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.test/api/health');
    expect(init.credentials).toBe('include');
    expect(init.cache).toBe('no-store');
  });

  it('turns a backend error envelope into an http error with code and request ID', async () => {
    const fetchImpl = mockFetch(() =>
      Promise.resolve(
        jsonResponse(
          { error: { code: 'NOT_FOUND', message: 'Route not found', requestId: 'req-9' } },
          404,
          { 'X-Request-Id': 'req-9' },
        ),
      ),
    );

    const error = await captureError(
      apiRequest('/api/missing', healthResponseSchema, { baseUrl: BASE_URL, fetchImpl }),
    );
    expect(error).toMatchObject({
      kind: 'http',
      status: 404,
      code: 'NOT_FOUND',
      message: 'Route not found',
      requestId: 'req-9',
    });
  });

  it('accepts listed non-2xx statuses as valid payloads (readiness 503)', async () => {
    const notReady = {
      status: 'not_ready',
      timestamp: '2026-11-19T10:00:00.000Z',
      checks: { database: { status: 'down' } },
    };
    const fetchImpl = mockFetch(() => Promise.resolve(jsonResponse(notReady, 503)));

    const result = await apiRequest('/api/health/ready', readinessResponseSchema, {
      baseUrl: BASE_URL,
      fetchImpl,
      acceptStatuses: [503],
    });
    expect(result.status).toBe(503);
    expect(result.data.status).toBe('not_ready');
  });

  it('classifies a fetch failure (server down or CORS refusal) as a network error', async () => {
    const fetchImpl = mockFetch(() => Promise.reject(new TypeError('Failed to fetch')));

    const error = await captureError(
      apiRequest('/api/health', healthResponseSchema, { baseUrl: BASE_URL, fetchImpl }),
    );
    expect(error.kind).toBe('network');
  });

  it('times out slow responses', async () => {
    const fetchImpl = mockFetch(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    );

    const error = await captureError(
      apiRequest('/api/health', healthResponseSchema, {
        baseUrl: BASE_URL,
        fetchImpl,
        timeoutMs: 20,
      }),
    );
    expect(error.kind).toBe('timeout');
  });

  it('rejects a response that does not match the contract', async () => {
    const fetchImpl = mockFetch(() => Promise.resolve(jsonResponse({ hello: 'world' })));

    const error = await captureError(
      apiRequest('/api/health', healthResponseSchema, { baseUrl: BASE_URL, fetchImpl }),
    );
    expect(error.kind).toBe('invalid_response');
  });

  it('rejects a non-JSON response (e.g. an HTML page at the wrong URL)', async () => {
    const fetchImpl = mockFetch(() =>
      Promise.resolve(new Response('<html>Not the API</html>', { status: 200 })),
    );

    const error = await captureError(
      apiRequest('/api/health', healthResponseSchema, { baseUrl: BASE_URL, fetchImpl }),
    );
    expect(error.kind).toBe('invalid_response');
  });

  it('rethrows caller cancellation unchanged instead of reporting an error', async () => {
    const controller = new AbortController();
    const fetchImpl = mockFetch(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    );

    const pending = apiRequest('/api/health', healthResponseSchema, {
      baseUrl: BASE_URL,
      fetchImpl,
      signal: controller.signal,
    });
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await expect(pending).rejects.not.toBeInstanceOf(ApiRequestError);
  });
});
