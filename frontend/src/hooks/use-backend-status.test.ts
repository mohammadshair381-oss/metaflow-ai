import type { HealthResponse, ReadinessResponse } from '@metaflow/shared';
import { describe, expect, it } from 'vitest';
import { ApiRequestError } from '@/lib/api-client';
import { type CheckState, deriveOverallStatus } from './use-backend-status';

const health: CheckState<HealthResponse> = {
  phase: 'success',
  response: {
    status: 200,
    requestId: null,
    durationMs: 10,
    data: {
      status: 'ok',
      service: 'metaflow-backend',
      version: '0.1.0',
      commit: null,
      environment: 'production',
      uptimeSeconds: 1,
      timestamp: '2026-11-19T10:00:00.000Z',
    },
  },
};

function readiness(
  status: ReadinessResponse['status'],
  database: ReadinessResponse['checks']['database'],
): CheckState<ReadinessResponse> {
  return {
    phase: 'success',
    response: {
      status: status === 'ready' ? 200 : 503,
      requestId: null,
      durationMs: 10,
      data: { status, timestamp: '2026-11-19T10:00:00.000Z', checks: { database } },
    },
  };
}

const failed = { phase: 'error', error: new ApiRequestError('network', 'down') } as const;

describe('deriveOverallStatus', () => {
  it('is checking while either request is in flight', () => {
    expect(deriveOverallStatus({ phase: 'loading' }, readiness('ready', { status: 'up' }))).toBe(
      'checking',
    );
    expect(deriveOverallStatus(health, { phase: 'loading' })).toBe('checking');
  });

  it('is operational when the API is live and ready', () => {
    expect(deriveOverallStatus(health, readiness('ready', { status: 'up', latencyMs: 2 }))).toBe(
      'operational',
    );
    expect(deriveOverallStatus(health, readiness('ready', { status: 'not_configured' }))).toBe(
      'operational',
    );
  });

  it('is degraded when the API is live but the database is down', () => {
    expect(deriveOverallStatus(health, readiness('not_ready', { status: 'down' }))).toBe(
      'degraded',
    );
    expect(deriveOverallStatus(health, failed)).toBe('degraded');
  });

  it('is unreachable when liveness fails', () => {
    expect(deriveOverallStatus(failed, failed)).toBe('unreachable');
  });
});
