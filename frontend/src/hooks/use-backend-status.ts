'use client';

import type { HealthResponse, ReadinessResponse } from '@metaflow/shared';
import { useCallback, useEffect, useState } from 'react';
import { ApiRequestError, type ApiResponse } from '@/lib/api-client';
import { fetchHealth, fetchReadiness } from '@/lib/health';

export type CheckState<T> =
  | { phase: 'loading' }
  | { phase: 'success'; response: ApiResponse<T> }
  | { phase: 'error'; error: ApiRequestError };

export type OverallStatus = 'checking' | 'operational' | 'degraded' | 'unreachable';

/** After this long, tell the user a sleeping Render instance may be waking up. */
const SLOW_RESPONSE_MS = 3_000;

function toApiError(error: unknown): ApiRequestError {
  return error instanceof ApiRequestError
    ? error
    : new ApiRequestError('network', 'Unexpected error while contacting the API.', {
        cause: error,
      });
}

export function deriveOverallStatus(
  health: CheckState<HealthResponse>,
  readiness: CheckState<ReadinessResponse>,
): OverallStatus {
  if (health.phase === 'loading' || readiness.phase === 'loading') return 'checking';
  if (health.phase === 'error') return 'unreachable';
  if (readiness.phase === 'success' && readiness.response.data.status === 'ready') {
    return 'operational';
  }
  return 'degraded';
}

/** Checks backend liveness and readiness from the browser, the same way real API calls will. */
export function useBackendStatus() {
  const [health, setHealth] = useState<CheckState<HealthResponse>>({ phase: 'loading' });
  const [readiness, setReadiness] = useState<CheckState<ReadinessResponse>>({ phase: 'loading' });
  const [isSlow, setIsSlow] = useState(false);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [run, setRun] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const slowTimer = setTimeout(() => setIsSlow(true), SLOW_RESPONSE_MS);

    const healthCheck = fetchHealth(signal).then(
      (response) => setHealth({ phase: 'success', response }),
      (error: unknown) => {
        if (!signal.aborted) setHealth({ phase: 'error', error: toApiError(error) });
      },
    );
    const readinessCheck = fetchReadiness(signal).then(
      (response) => setReadiness({ phase: 'success', response }),
      (error: unknown) => {
        if (!signal.aborted) setReadiness({ phase: 'error', error: toApiError(error) });
      },
    );

    void Promise.all([healthCheck, readinessCheck]).then(() => {
      if (signal.aborted) return;
      clearTimeout(slowTimer);
      setIsSlow(false);
      setCheckedAt(new Date());
    });

    return () => {
      controller.abort();
      clearTimeout(slowTimer);
    };
  }, [run]);

  const refresh = useCallback(() => {
    setHealth({ phase: 'loading' });
    setReadiness({ phase: 'loading' });
    setIsSlow(false);
    setRun((value) => value + 1);
  }, []);

  return {
    health,
    readiness,
    overall: deriveOverallStatus(health, readiness),
    isSlow,
    checkedAt,
    refresh,
  };
}
