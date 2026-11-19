import type { ReactNode } from 'react';
import { AuthContext, type AuthState } from './auth-context';

/** Accounts and sign-in arrive in the next milestone. Until then, every session is "unavailable". */
const SIGN_IN_NOT_BUILT: AuthState = { status: 'unavailable' };

/**
 * Supplies the session state to the app.
 *
 * The sign-in milestone replaces the constant below with a session check against the
 * backend (cookie-based; tokens never touch localStorage) that moves through
 * loading → anonymous | authenticated. Route guards already handle every state.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  return <AuthContext.Provider value={SIGN_IN_NOT_BUILT}>{children}</AuthContext.Provider>;
}
