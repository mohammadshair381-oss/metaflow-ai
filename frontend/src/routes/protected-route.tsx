import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { FullPageSpinner } from '@/components/common/full-page-spinner';
import { SessionCheckError } from '@/components/common/session-check-error';
import { useAuth } from '@/contexts/auth-context';
import type { RedirectState } from './redirect';

/**
 * Guards the signed-in area. A UI convenience only: the API enforces authorization
 * on every request regardless of what the browser shows.
 */
export function ProtectedRoute() {
  const { state, retry } = useAuth();
  const location = useLocation();

  switch (state.status) {
    case 'loading':
      return <FullPageSpinner label="Checking your session…" />;
    case 'error':
      // Unknown session state (server unreachable): offer a retry instead of a misleading sign-in page.
      return <SessionCheckError message={state.message} onRetry={retry} />;
    case 'anonymous': {
      const redirect: RedirectState = { from: `${location.pathname}${location.search}` };
      return <Navigate to="/login" replace state={redirect} />;
    }
    case 'authenticated':
      return <Outlet />;
  }
}
