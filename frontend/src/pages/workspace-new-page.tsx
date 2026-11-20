import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@/components/common/page-header';
import { WorkspaceForm } from '@/components/workspaces/workspace-form';
import { emptyWorkspaceValues } from '@/components/workspaces/workspace-form-values';
import { Card, CardContent } from '@/components/ui/card';
import { useWorkspaces } from '@/contexts/workspace-context';
import { useDocumentTitle } from '@/hooks/use-document-title';

export function WorkspaceNewPage() {
  useDocumentTitle('New workspace');
  const { createWorkspace } = useWorkspaces();
  const navigate = useNavigate();

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <PageHeader
        title="New workspace"
        description="Add another business or brand. Its social accounts, content and team stay separate from your other workspaces."
      />
      <Card>
        <CardContent>
          <WorkspaceForm
            initialValues={emptyWorkspaceValues()}
            submitLabel="Create workspace"
            submittingLabel="Creating…"
            onSubmit={createWorkspace}
            onSaved={() => void navigate('/dashboard')}
          />
        </CardContent>
      </Card>
    </div>
  );
}
