import { Compass } from 'lucide-react';
import { Link } from 'react-router-dom';
import { EmptyState } from '@/components/common/empty-state';
import { Button } from '@/components/ui/button';
import { useDocumentTitle } from '@/hooks/use-document-title';

export function NotFoundPage() {
  useDocumentTitle('Page not found');

  return (
    <div className="grid min-h-dvh place-items-center px-4">
      <EmptyState
        icon={Compass}
        title="Page not found"
        headingLevel="h1"
        description="This address doesn’t match any page in MetaFlow AI."
        className="w-full max-w-lg"
      >
        <Button asChild>
          <Link to="/dashboard">Go to dashboard</Link>
        </Button>
        <Button asChild variant="outline">
          <Link to="/">Home</Link>
        </Button>
      </EmptyState>
    </div>
  );
}
