import {
  API_ROUTES,
  workspaceListResponseSchema,
  workspaceMemberListResponseSchema,
  workspaceResponseSchema,
  workspaceRoutes,
  type CreateWorkspaceRequest,
  type UpdateWorkspaceRequest,
  type Workspace,
  type WorkspaceMember,
} from '@metaflow/shared';
import { z } from 'zod';
import { apiRequest } from './api-client';

/** 204 No Content: no body to validate. */
const noContentSchema = z.undefined();

/** The signed-in user's active workspaces. The server decides which ones those are. */
export async function listWorkspaces(signal?: AbortSignal): Promise<Workspace[]> {
  const { data } = await apiRequest(API_ROUTES.workspaces, workspaceListResponseSchema, { signal });
  return data.workspaces;
}

export async function createWorkspace(input: CreateWorkspaceRequest): Promise<Workspace> {
  const { data } = await apiRequest(API_ROUTES.workspaces, workspaceResponseSchema, {
    method: 'POST',
    body: input,
  });
  return data.workspace;
}

export async function updateWorkspace(
  workspaceId: string,
  changes: UpdateWorkspaceRequest,
): Promise<Workspace> {
  const { data } = await apiRequest(workspaceRoutes(workspaceId).detail, workspaceResponseSchema, {
    method: 'PATCH',
    body: changes,
  });
  return data.workspace;
}

export async function archiveWorkspace(workspaceId: string, confirmName: string): Promise<void> {
  await apiRequest(workspaceRoutes(workspaceId).archive, noContentSchema, {
    method: 'POST',
    body: { confirmName },
  });
}

export async function listWorkspaceMembers(
  workspaceId: string,
  signal?: AbortSignal,
): Promise<WorkspaceMember[]> {
  const { data } = await apiRequest(
    workspaceRoutes(workspaceId).members,
    workspaceMemberListResponseSchema,
    { signal },
  );
  return data.members;
}
