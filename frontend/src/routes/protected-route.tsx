import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { FullPageSpinner } from '@/components/common/full-page-spinner';
import { useAuth } from '@/contexts/auth-context';

export interface RedirectState {
  /** Where the user was going before being sent to /login. */
  from?: string;
}

/**
 * Guards the signed-in area. A UI convenience only: the API enforces authorization
 * on every request regardless of what the browser shows.
 */
export function ProtectedRoute() {
  const auth = useAuth();
  const location = useLocation();

  switch (auth.status) {
    case 'unavailable':
      // Sign-in is not built yet: pages render in preview mode and hold no data.
      return <Outlet />;
    case 'loading':
      return <FullPageSpinner label="Checking your session…" />;
    case 'anonymous': {
      const state: RedirectState = { from: `${location.pathname}${location.search}` };
      return <Navigate to="/login" replace state={state} />;
    }
    case 'authenticated':
      return <Outlet />;
  }
}
