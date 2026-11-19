import { createContext, useContext } from 'react';

export interface SessionUser {
  id: string;
  name: string;
  email: string;
}

/**
 * Session state as the UI sees it.
 *
 * - `unavailable`: sign-in is not built yet. Protected pages render in preview mode.
 * - `loading`: the session check is in flight.
 * - `anonymous`: no valid session; protected pages redirect to /login.
 * - `authenticated`: a valid session exists.
 *
 * This only decides what the UI shows. The backend must authorize every request itself.
 */
export type AuthState =
  | { status: 'unavailable' }
  | { status: 'loading' }
  | { status: 'anonymous' }
  | { status: 'authenticated'; user: SessionUser };

export const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const state = useContext(AuthContext);
  if (!state) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return state;
}
