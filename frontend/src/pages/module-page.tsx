import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import { EmptyState } from '@/components/common/empty-state';
import { PageHeader } from '@/components/common/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useDocumentTitle } from '@/hooks/use-document-title';
import type { PlannedModule } from '@/routes/navigation';

/** Honest placeholder for a module that is routed but not built: no mock data, no fake controls. */
export function ModulePage({ module }: { module: PlannedModule }) {
  useDocumentTitle(module.label);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 lg:gap-8">
      <PageHeader title={module.label} />
      <EmptyState
        icon={module.icon}
        title={`${module.label} is not available yet`}
        eyebrow={<Badge variant="outline">Planned · Milestone {module.milestone.number}</Badge>}
        description={
          <>
            <p>{module.description}</p>
            <p className="mt-2">
              It arrives with{' '}
              <span className="text-foreground font-medium">{module.milestone.name}</span>.
            </p>
          </>
        }
      >
        <Button asChild variant="outline" size="sm">
          <Link to="/dashboard">
            <ArrowLeft aria-hidden />
            Back to dashboard
          </Link>
        </Button>
      </EmptyState>
    </div>
  );
}
