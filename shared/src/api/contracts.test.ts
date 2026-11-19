import { describe, expect, it } from 'vitest';
import { apiErrorResponseSchema } from './errors';
import { healthResponseSchema, readinessResponseSchema } from './health';

const validHealth = {
  status: 'ok',
  service: 'metaflow-backend',
  version: '0.1.0',
  commit: null,
  environment: 'production',
  uptimeSeconds: 12.5,
  timestamp: '2026-11-19T10:00:00.000Z',
};

describe('healthResponseSchema', () => {
  it('accepts a valid health payload', () => {
    expect(healthResponseSchema.parse(validHealth)).toEqual(validHealth);
  });

  it('rejects an unknown environment', () => {
    expect(healthResponseSchema.safeParse({ ...validHealth, environment: 'staging' }).success).toBe(
      false,
    );
  });

  it('rejects a non-ISO timestamp', () => {
    expect(healthResponseSchema.safeParse({ ...validHealth, timestamp: 'yesterday' }).success).toBe(
      false,
    );
  });

  it('rejects a payload that is not the backend health shape', () => {
    expect(healthResponseSchema.safeParse({ ok: true }).success).toBe(false);
  });
});

describe('readinessResponseSchema', () => {
  it.each([
    { status: 'ready', checks: { database: { status: 'up', latencyMs: 3 } } },
    { status: 'ready', checks: { database: { status: 'not_configured' } } },
    { status: 'not_ready', checks: { database: { status: 'down' } } },
  ])('accepts $status with database $checks.database.status', (payload) => {
    expect(
      readinessResponseSchema.safeParse({ ...payload, timestamp: '2026-11-19T10:00:00.000Z' })
        .success,
    ).toBe(true);
  });

  it('rejects an unknown database status', () => {
    const result = readinessResponseSchema.safeParse({
      status: 'ready',
      timestamp: '2026-11-19T10:00:00.000Z',
      checks: { database: { status: 'maybe' } },
    });
    expect(result.success).toBe(false);
  });
});

describe('apiErrorResponseSchema', () => {
  it('accepts an error with validation details', () => {
    const payload = {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        requestId: 'abc-123',
        details: [{ path: 'body.name', message: 'Required' }],
      },
    };
    expect(apiErrorResponseSchema.parse(payload)).toEqual(payload);
  });

  it('rejects an unknown error code', () => {
    expect(
      apiErrorResponseSchema.safeParse({ error: { code: 'TEAPOT', message: 'no' } }).success,
    ).toBe(false);
  });
});
