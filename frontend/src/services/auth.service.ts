import {
  API_ROUTES,
  authUserResponseSchema,
  type AuthUser,
  type LoginRequest,
  type RegisterRequest,
} from '@metaflow/shared';
import { z } from 'zod';
import { ApiRequestError, apiRequest } from './api-client';

/** 204 No Content: no body to validate. */
const noContentSchema = z.undefined();

/**
 * Restores the session from the HTTP-only cookie (the browser sends it automatically; the
 * frontend never sees or stores the token). Null when signed out; throws when the API cannot
 * be reached, so callers can tell "signed out" from "server unavailable".
 */
export async function fetchCurrentUser(signal?: AbortSignal): Promise<AuthUser | null> {
  try {
    const { data } = await apiRequest(API_ROUTES.authMe, authUserResponseSchema, { signal });
    return data.user;
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 401) return null;
    throw error;
  }
}

export async function login(input: LoginRequest): Promise<AuthUser> {
  const { data } = await apiRequest(API_ROUTES.authLogin, authUserResponseSchema, {
    method: 'POST',
    body: input,
  });
  return data.user;
}

export async function register(input: RegisterRequest): Promise<AuthUser> {
  const { data } = await apiRequest(API_ROUTES.authRegister, authUserResponseSchema, {
    method: 'POST',
    body: input,
  });
  return data.user;
}

export async function logout(): Promise<void> {
  await apiRequest(API_ROUTES.authLogout, noContentSchema, { method: 'POST' });
}
