import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { FullPageSpinner } from '@/components/common/full-page-spinner';
import { useAuth } from '@/contexts/auth-context';
import { safeRedirectTarget, type RedirectState } from './redirect';

/**
 * Wraps /login and /register. Signed-in users are sent on to where they were going, which is
 * also what happens right after a successful sign-in or registration.
 */
export function GuestRoute() {
  const { state } = useAuth();
  const location = useLocation();

  if (state.status === 'loading') return <FullPageSpinner label="Loading…" />;
  if (state.status === 'authenticated') {
    const from = (location.state as RedirectState | null)?.from;
    return <Navigate to={safeRedirectTarget(from)} replace />;
  }
  return <Outlet />;
}
