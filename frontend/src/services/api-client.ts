import { REQUEST_ID_HEADER, apiErrorResponseSchema, type ValidationIssue } from '@metaflow/shared';
import type { z } from 'zod';
import { API_BASE_URL } from '@/lib/config';

export type ApiErrorKind = 'network' | 'timeout' | 'http' | 'invalid_response';

/** A failed API call, classified so the UI can explain what went wrong. */
export class ApiRequestError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number | undefined;
  readonly code: string | undefined;
  /** Field-level problems reported by the API (VALIDATION_ERROR), e.g. path "body.email". */
  readonly details: ValidationIssue[];
  readonly requestId: string | null;

  constructor(
    kind: ApiErrorKind,
    message: string,
    details: {
      status?: number;
      code?: string;
      details?: ValidationIssue[];
      requestId?: string | null;
      cause?: unknown;
    } = {},
  ) {
    super(message, { cause: details.cause });
    this.name = 'ApiRequestError';
    this.kind = kind;
    this.status = details.status;
    this.code = details.code;
    this.details = details.details ?? [];
    this.requestId = details.requestId ?? null;
  }
}

export interface ApiRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Sent as JSON, or as multipart form data when it is a FormData (file uploads). */
  body?: unknown;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Non-2xx statuses whose body is a valid payload rather than an error (e.g. 503 readiness). */
  acceptStatuses?: readonly number[];
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export interface ApiResponse<T> {
  data: T;
  status: number;
  requestId: string | null;
  durationMs: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * The single entry point for calling the backend.
 *
 * - Always sends cookies (`credentials: 'include'`), as session auth will require.
 * - Validates every response against a shared Zod contract, so a mismatched or
 *   misconfigured backend fails loudly instead of rendering garbage.
 * - Rethrows caller aborts unchanged so React effects can cancel quietly.
 */
export async function apiRequest<T>(
  path: string,
  schema: z.ZodType<T>,
  options: ApiRequestOptions = {},
): Promise<ApiResponse<T>> {
  const {
    method = 'GET',
    body,
    signal,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    acceptStatuses = [],
    baseUrl = API_BASE_URL,
    fetchImpl = fetch,
  } = options;

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const forwardAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) forwardAbort();
  signal?.addEventListener('abort', forwardAbort, { once: true });

  const startedAt = performance.now();
  // The browser sets the multipart Content-Type (with its boundary) for FormData itself.
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl}${path}`, {
      method,
      credentials: 'include',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        ...(body === undefined || isForm ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    if (timedOut) {
      throw new ApiRequestError(
        'timeout',
        `The API did not respond within ${Math.round(timeoutMs / 1000)} seconds.`,
        { cause: error },
      );
    }
    throw new ApiRequestError(
      'network',
      'Could not reach the API. The server may be down, or this site may not be an allowed CORS origin.',
      { cause: error },
    );
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', forwardAbort);
  }

  const durationMs = Math.round(performance.now() - startedAt);
  const requestId = response.headers.get(REQUEST_ID_HEADER);
  const payload: unknown = await response.json().catch(() => undefined);

  if (!response.ok && !acceptStatuses.includes(response.status)) {
    const apiError = apiErrorResponseSchema.safeParse(payload);
    throw new ApiRequestError(
      'http',
      apiError.success
        ? apiError.data.error.message
        : `The API responded with HTTP ${response.status}.`,
      {
        status: response.status,
        code: apiError.success ? apiError.data.error.code : undefined,
        details: apiError.success ? (apiError.data.error.details ?? []) : [],
        requestId,
      },
    );
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new ApiRequestError(
      'invalid_response',
      'The API returned a response this app does not recognize. Check that VITE_API_BASE_URL points at the MetaFlow backend.',
      { status: response.status, requestId },
    );
  }

  return { data: parsed.data, status: response.status, requestId, durationMs };
}
