import type { AuthUser, LoginRequest, RegisterRequest } from '@metaflow/shared';
import { createContext, useContext } from 'react';

/**
 * Session state as the UI sees it.
 *
 * - `loading`: the session is being restored from the cookie.
 * - `anonymous`: no valid session; protected pages redirect to /login.
 * - `authenticated`: the server confirmed a valid session for `user`.
 * - `error`: the server could not be reached, so the session state is unknown. Kept apart from
 *   `anonymous` so an outage never looks like being signed out.
 *
 * This only decides what the UI shows. The backend authorizes every request itself.
 */
export type AuthState =
  | { status: 'loading' }
  | { status: 'anonymous' }
  | { status: 'authenticated'; user: AuthUser }
  | { status: 'error'; message: string };

export interface AuthContextValue {
  state: AuthState;
  /** Resolves once signed in; rejects with ApiRequestError (e.g. INVALID_CREDENTIALS). */
  login: (input: LoginRequest) => Promise<void>;
  register: (input: RegisterRequest) => Promise<void>;
  /** Ends the session on the server; the UI only signs out after the server confirms. */
  logout: () => Promise<void>;
  /** Re-runs the session check after an `error` state. */
  retry: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return value;
}
