import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import * as authService from '@/services/auth.service';
import { AuthContext, type AuthContextValue, type AuthState } from './auth-context';

const UNREACHABLE_MESSAGE = 'We could not reach the server to check your session.';

/**
 * Restores the session on load (GET /api/auth/me with the HTTP-only cookie) and exposes
 * login, register and logout. Tokens never touch JavaScript or localStorage.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    authService.fetchCurrentUser(controller.signal).then(
      (user) => setState(user ? { status: 'authenticated', user } : { status: 'anonymous' }),
      () => {
        if (!controller.signal.aborted) setState({ status: 'error', message: UNREACHABLE_MESSAGE });
      },
    );
    return () => controller.abort();
  }, [attempt]);

  const login = useCallback<AuthContextValue['login']>(async (input) => {
    const user = await authService.login(input);
    setState({ status: 'authenticated', user });
  }, []);

  const register = useCallback<AuthContextValue['register']>(async (input) => {
    const user = await authService.register(input);
    setState({ status: 'authenticated', user });
  }, []);

  const logout = useCallback<AuthContextValue['logout']>(async () => {
    await authService.logout();
    setState({ status: 'anonymous' });
  }, []);

  const retry = useCallback(() => {
    setState({ status: 'loading' });
    setAttempt((value) => value + 1);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ state, login, register, logout, retry }),
    [state, login, register, logout, retry],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
