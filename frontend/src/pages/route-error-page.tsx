import { TriangleExclamationPoint } from 'lucide-react';
import { isRouteErrorResponse, useRouteError } from 'react-router-dom';
import { EmptyState } from '@/components/common/empty-state';
import { Button } from '@/components/ui/button';
import { useDocumentTitle } from '@/hooks/use-document-title';

/** Catches rendering errors anywhere in the route tree instead of showing a blank page. */
export function RouteErrorPage() {
  const error = useRouteError();
  useDocumentTitle('Something went wrong');

  const detail = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : null;

  return (
    <div className="grid min-h-dvh place-items-center px-4">
      <EmptyState
        icon={TriangleExclamationPoint}
        title="Something went wrong"
        headingLevel="h1"
        description={
          <>
            <p>The page failed to load. Reloading usually fixes it.</p>
            {import.meta.env.DEV && detail ? (
              <p className="mt-2 font-mono text-xs break-all">{detail}</p>
            ) : null}
          </>
        }
        className="w-full max-w-lg"
      >
        <Button onClick={() => window.location.reload()}>Reload</Button>
        <Button asChild variant="outline">
          <a href="/">Home</a>
        </Button>
      </EmptyState>
    </div>
  );
}
