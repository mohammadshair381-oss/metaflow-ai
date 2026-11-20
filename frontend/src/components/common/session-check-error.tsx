import { CloudOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from './empty-state';

/** Full-page state when the session could not be checked because the server was unreachable. */
export function SessionCheckError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="grid min-h-dvh place-items-center px-4">
      <EmptyState
        icon={CloudOff}
        title="Can't reach MetaFlow AI"
        headingLevel="h1"
        description={
          <>
            <p>{message}</p>
            <p className="mt-2">Check your connection, then try again.</p>
          </>
        }
        className="w-full max-w-lg"
      >
        <Button onClick={onRetry}>Try again</Button>
      </EmptyState>
    </div>
  );
}
