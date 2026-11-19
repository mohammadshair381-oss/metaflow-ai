import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/auth-context';
import type { RedirectState } from './protected-route';

/** Wraps /login and /register: signed-in users are sent on to where they were going. */
export function GuestRoute() {
  const auth = useAuth();
  const location = useLocation();

  if (auth.status === 'authenticated') {
    const from = (location.state as RedirectState | null)?.from;
    // Only follow in-app paths, never an absolute URL.
    const target = from?.startsWith('/') && !from.startsWith('//') ? from : '/dashboard';
    return <Navigate to={target} replace />;
  }
  return <Outlet />;
}
