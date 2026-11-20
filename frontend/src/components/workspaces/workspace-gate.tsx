import { CloudOff } from 'lucide-react';
import type { ReactNode } from 'react';
import { EmptyState } from '@/components/common/empty-state';
import { PageHeader } from '@/components/common/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useWorkspaces } from '@/contexts/workspace-context';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { WorkspaceForm } from './workspace-form';
import { emptyWorkspaceValues } from './workspace-form-values';

function FirstWorkspace() {
  useDocumentTitle('Create your workspace');
  const { createWorkspace } = useWorkspaces();
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <PageHeader
        title="Create your first workspace"
        description="A workspace holds everything for one business or brand: its social accounts, content and team. You can add more later."
      />
      <Card>
        <CardContent>
          <WorkspaceForm
            initialValues={emptyWorkspaceValues()}
            submitLabel="Create workspace"
            submittingLabel="Creating…"
            onSubmit={createWorkspace}
          />
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Pages inside the dashboard always have an active workspace: this renders them only once
 * the user's workspaces are loaded, and asks a user without any to create the first one.
 */
export function WorkspaceGate({ children }: { children: ReactNode }) {
  const { state, retry } = useWorkspaces();

  if (state.status === 'loading') {
    return (
      <div role="status" className="mx-auto flex w-full max-w-6xl flex-col gap-4">
        <span className="sr-only">Loading your workspaces…</span>
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <EmptyState
        icon={CloudOff}
        title="Can't load your workspaces"
        headingLevel="h1"
        description={
          <>
            <p>{state.message}</p>
            <p className="mt-2">Check your connection, then try again.</p>
          </>
        }
        className="mx-auto w-full max-w-lg"
      >
        <Button onClick={retry}>Try again</Button>
      </EmptyState>
    );
  }
  return state.active ? children : <FirstWorkspace />;
}
