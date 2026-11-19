import { API_ROUTES, healthResponseSchema, readinessResponseSchema } from '@metaflow/shared';
import { apiRequest } from './api-client';

export function fetchHealth(signal?: AbortSignal) {
  return apiRequest(API_ROUTES.health, healthResponseSchema, { signal });
}

/** Readiness answers 503 with a valid body when a dependency is down. */
export function fetchReadiness(signal?: AbortSignal) {
  return apiRequest(API_ROUTES.healthReady, readinessResponseSchema, {
    signal,
    acceptStatuses: [503],
  });
}
