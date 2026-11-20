import {
  businessCategoryLabel,
  workspaceLanguageLabel,
  type Workspace,
  type WorkspaceMember,
} from '@metaflow/shared';
import { CircleCheck, LoaderCircle } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { FormAlert } from '@/components/auth/form-alert';
import { FormField } from '@/components/auth/form-field';
import { PageHeader } from '@/components/common/page-header';
import { WorkspaceForm } from '@/components/workspaces/workspace-form';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useActiveWorkspace, useWorkspaces } from '@/contexts/workspace-context';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { describeSubmitError } from '@/lib/form-errors';
import { listWorkspaceMembers } from '@/services/workspace.service';

function BusinessProfile({ workspace }: { workspace: Workspace }) {
  const { updateWorkspace } = useWorkspaces();
  const [saved, setSaved] = useState(false);

  if (workspace.role !== 'owner') {
    const facts = [
      ['Workspace name', workspace.name],
      ['Business category', businessCategoryLabel(workspace.category)],
      ['About the business', workspace.description || 'Not provided'],
      ['Time zone', workspace.timezone.replaceAll('_', ' ')],
      ['Content language', workspaceLanguageLabel(workspace.defaultLanguage)],
    ] as const;
    return (
      <div className="flex flex-col gap-4">
        <p className="text-muted-foreground text-sm">
          Only the workspace owner can change these details.
        </p>
        <dl className="flex flex-col gap-3 text-sm">
          {facts.map(([label, value]) => (
            <div key={label} className="flex flex-col gap-0.5">
              <dt className="text-muted-foreground text-xs">{label}</dt>
              <dd className="font-medium whitespace-pre-wrap">{value}</dd>
            </div>
          ))}
        </dl>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <WorkspaceForm
        initialValues={{
          name: workspace.name,
          description: workspace.description,
          category: workspace.category,
          timezone: workspace.timezone,
          defaultLanguage: workspace.defaultLanguage,
        }}
        submitLabel="Save changes"
        submittingLabel="Saving…"
        onSubmit={(values) => {
          setSaved(false);
          return updateWorkspace(workspace.id, values);
        }}
        onSaved={() => setSaved(true)}
      />
      {saved ? (
        <p role="status" className="text-success flex items-center gap-2 text-sm font-medium">
          <CircleCheck className="size-4" aria-hidden />
          Changes saved.
        </p>
      ) : null}
    </div>
  );
}

type MembersState =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; members: WorkspaceMember[] };

function Members({ workspaceId }: { workspaceId: string }) {
  const [state, setState] = useState<MembersState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    listWorkspaceMembers(workspaceId, controller.signal).then(
      (members) => setState({ status: 'ready', members }),
      () => {
        if (!controller.signal.aborted) setState({ status: 'error' });
      },
    );
    return () => controller.abort();
  }, [workspaceId, attempt]);

  if (state.status === 'loading') {
    return (
      <div role="status" className="flex flex-col gap-2">
        <span className="sr-only">Loading members…</span>
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div className="flex flex-col items-start gap-3">
        <FormAlert message="We could not load the members of this workspace." />
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setState({ status: 'loading' });
            setAttempt((value) => value + 1);
          }}
        >
          Try again
        </Button>
      </div>
    );
  }
  return (
    <ul className="divide-y text-sm">
      {state.members.map((member) => (
        <li key={member.userId} className="flex items-center justify-between gap-3 py-3">
          <div className="min-w-0">
            <p className="truncate font-medium">{member.name}</p>
            <p className="text-muted-foreground truncate text-xs">{member.email}</p>
          </div>
          <Badge variant="outline">{member.role === 'owner' ? 'Owner' : 'Staff'}</Badge>
        </li>
      ))}
    </ul>
  );
}

function ArchiveWorkspace({ workspace }: { workspace: Workspace }) {
  const { archiveWorkspace } = useWorkspaces();
  const navigate = useNavigate();
  const [confirmName, setConfirmName] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);
  const matches = confirmName.trim() === workspace.name;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!matches) return;
    setSubmitting(true);
    setError(undefined);
    try {
      await archiveWorkspace(workspace.id, confirmName);
      void navigate('/dashboard');
    } catch (failure) {
      const described = describeSubmitError(failure, ['confirmName'] as const);
      setError(described.fieldErrors.confirmName ?? described.formError ?? undefined);
      setSubmitting(false);
    }
  }

  return (
    <form noValidate onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
      <FormField
        label={`Type “${workspace.name}” to confirm`}
        error={error}
        hint="The workspace disappears for every member. Its data is kept, not deleted."
      >
        {(field) => (
          <Input
            {...field}
            name="confirmName"
            autoComplete="off"
            value={confirmName}
            onChange={(event) => setConfirmName(event.target.value)}
            disabled={submitting}
          />
        )}
      </FormField>
      <div>
        <Button type="submit" variant="destructive" disabled={!matches || submitting}>
          {submitting ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
          {submitting ? 'Archiving…' : 'Archive workspace'}
        </Button>
      </div>
    </form>
  );
}

export function WorkspaceSettingsPage() {
  useDocumentTitle('Workspace settings');
  const workspace = useActiveWorkspace();

  return (
    // Keyed by workspace so switching workspaces resets every form on the page.
    <div key={workspace.id} className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <PageHeader
        title="Workspace settings"
        description={`Details and members of ${workspace.name}.`}
      />

      <Card>
        <CardHeader>
          <CardTitle>Business profile</CardTitle>
          <CardDescription>
            Who this workspace is for and how its content is written and scheduled.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <BusinessProfile workspace={workspace} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
          <CardDescription>
            People who can work in this workspace. Inviting teammates arrives with the Team module.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Members workspaceId={workspace.id} />
        </CardContent>
      </Card>

      {workspace.role === 'owner' ? (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle>Archive this workspace</CardTitle>
            <CardDescription>
              Use this when the business no longer needs MetaFlow AI. Archiving cannot be undone
              from the app yet.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ArchiveWorkspace workspace={workspace} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
