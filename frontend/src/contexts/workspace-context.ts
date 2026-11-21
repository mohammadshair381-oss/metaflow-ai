import type { CreateWorkspaceRequest, UpdateWorkspaceRequest, Workspace } from '@metaflow/shared';
import { createContext, useContext } from 'react';

/**
 * The signed-in user's workspaces and the one they are working in.
 *
 * `active` is null only when the user has no workspace yet. Which workspace is active is a
 * display preference remembered in this browser; the API checks membership on every request,
 * so a stale or tampered value can only lead to a "not found" answer.
 */
export type WorkspaceState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; workspaces: Workspace[]; active: Workspace | null };

export interface WorkspaceContextValue {
  state: WorkspaceState;
  switchWorkspace: (workspaceId: string) => void;
  /** Creates a workspace and makes it the active one. Rejects with ApiRequestError. */
  createWorkspace: (input: CreateWorkspaceRequest) => Promise<Workspace>;
  updateWorkspace: (workspaceId: string, changes: UpdateWorkspaceRequest) => Promise<Workspace>;
  archiveWorkspace: (workspaceId: string, confirmName: string) => Promise<void>;
  /**
   * Applies fields another endpoint already saved on the server (e.g. the brand voice saves
   * the description and language), so every page shows them without reloading. No request.
   */
  syncWorkspace: (
    workspaceId: string,
    changes: Partial<Pick<Workspace, 'description' | 'defaultLanguage' | 'logoMediaId'>>,
  ) => void;
  retry: () => void;
}

export const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function useWorkspaces(): WorkspaceContextValue {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error('useWorkspaces must be used inside <WorkspaceProvider>');
  return value;
}

/** For pages inside the dashboard layout, which only renders them once a workspace is active. */
export function useActiveWorkspace(): Workspace {
  const { state } = useWorkspaces();
  if (state.status !== 'ready' || !state.active) {
    throw new Error('useActiveWorkspace needs an active workspace');
  }
  return state.active;
}
