import type { Workspace } from '@metaflow/shared';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import * as workspaceService from '@/services/workspace.service';
import {
  WorkspaceContext,
  type WorkspaceContextValue,
  type WorkspaceState,
} from './workspace-context';

const LOAD_ERROR = 'We could not load your workspaces.';
const storageKey = (userId: string) => `metaflow.activeWorkspace.${userId}`;

// Remembering the last workspace is a convenience; the app works without storage.
function readStoredId(userId: string): string | null {
  try {
    return window.localStorage.getItem(storageKey(userId));
  } catch {
    return null;
  }
}

function storeId(userId: string, workspaceId: string | null): void {
  try {
    if (workspaceId) window.localStorage.setItem(storageKey(userId), workspaceId);
    else window.localStorage.removeItem(storageKey(userId));
  } catch {
    // Storage unavailable (private mode, blocked): nothing to remember.
  }
}

interface Loaded {
  workspaces: Workspace[];
  activeId: string | null;
}

/** Loads the user's workspaces once they are signed in and tracks the active one. */
export function WorkspaceProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    workspaceService.listWorkspaces(controller.signal).then(
      (workspaces) => {
        setError(null);
        setLoaded({ workspaces, activeId: readStoredId(userId) });
      },
      () => {
        if (!controller.signal.aborted) setError(LOAD_ERROR);
      },
    );
    return () => controller.abort();
  }, [userId, attempt]);

  const switchWorkspace = useCallback(
    (workspaceId: string) => {
      storeId(userId, workspaceId);
      setLoaded((current) => (current ? { ...current, activeId: workspaceId } : current));
    },
    [userId],
  );

  const createWorkspace = useCallback<WorkspaceContextValue['createWorkspace']>(
    async (input) => {
      const workspace = await workspaceService.createWorkspace(input);
      storeId(userId, workspace.id);
      setLoaded((current) => ({
        workspaces: [...(current?.workspaces ?? []), workspace],
        activeId: workspace.id,
      }));
      return workspace;
    },
    [userId],
  );

  const updateWorkspace = useCallback<WorkspaceContextValue['updateWorkspace']>(
    async (workspaceId, changes) => {
      const workspace = await workspaceService.updateWorkspace(workspaceId, changes);
      setLoaded((current) =>
        current
          ? {
              ...current,
              workspaces: current.workspaces.map((w) => (w.id === workspace.id ? workspace : w)),
            }
          : current,
      );
      return workspace;
    },
    [],
  );

  const archiveWorkspace = useCallback<WorkspaceContextValue['archiveWorkspace']>(
    async (workspaceId, confirmName) => {
      await workspaceService.archiveWorkspace(workspaceId, confirmName);
      storeId(userId, null);
      setLoaded((current) =>
        current
          ? {
              workspaces: current.workspaces.filter((w) => w.id !== workspaceId),
              activeId: current.activeId === workspaceId ? null : current.activeId,
            }
          : current,
      );
    },
    [userId],
  );

  const retry = useCallback(() => {
    setError(null);
    setLoaded(null);
    setAttempt((value) => value + 1);
  }, []);

  const state = useMemo<WorkspaceState>(() => {
    if (error) return { status: 'error', message: error };
    if (!loaded) return { status: 'loading' };
    // A remembered workspace the user no longer belongs to falls back to their first one.
    const active =
      loaded.workspaces.find((w) => w.id === loaded.activeId) ?? loaded.workspaces[0] ?? null;
    return { status: 'ready', workspaces: loaded.workspaces, active };
  }, [error, loaded]);

  const value = useMemo<WorkspaceContextValue>(
    () => ({ state, switchWorkspace, createWorkspace, updateWorkspace, archiveWorkspace, retry }),
    [state, switchWorkspace, createWorkspace, updateWorkspace, archiveWorkspace, retry],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}
