import { Plus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import { useWorkspaces } from '@/contexts/workspace-context';

/** Shows the active workspace and switches between the user's workspaces. */
export function WorkspaceSwitcher() {
  const { state, switchWorkspace } = useWorkspaces();
  if (state.status !== 'ready' || !state.active) return null;

  return (
    <div className="flex min-w-0 items-center gap-2">
      <label htmlFor="workspace-switcher" className="sr-only">
        Workspace
      </label>
      <NativeSelect
        id="workspace-switcher"
        className="max-w-44 font-medium sm:max-w-60"
        value={state.active.id}
        onChange={(event) => switchWorkspace(event.target.value)}
      >
        {state.workspaces.map((workspace) => (
          <option key={workspace.id} value={workspace.id}>
            {workspace.name}
          </option>
        ))}
      </NativeSelect>
      <Button asChild variant="outline" size="icon" title="New workspace">
        <Link to="/workspaces/new" aria-label="New workspace">
          <Plus aria-hidden />
        </Link>
      </Button>
    </div>
  );
}
