import {
  mediaListResponseSchema,
  mediaResponseSchema,
  updateMediaRequestSchema,
  workspaceResponseSchema,
  workspaceRoutes,
  type Media,
  type MediaKind,
  type MediaListResponse,
  type UpdateMediaRequest,
  type Workspace,
} from '@metaflow/shared';
import { z } from 'zod';
import { API_BASE_URL } from '@/lib/config';
import { apiRequest } from './api-client';

const noContentSchema = z.undefined();

/** Large videos on slow connections take a while; the server limits the size. */
const UPLOAD_TIMEOUT_MS = 10 * 60 * 1000;

export async function listMedia(
  workspaceId: string,
  filters: { kind?: MediaKind; q?: string; before?: string; limit?: number } = {},
  signal?: AbortSignal,
): Promise<MediaListResponse> {
  const params = new URLSearchParams();
  if (filters.kind) params.set('kind', filters.kind);
  if (filters.q?.trim()) params.set('q', filters.q.trim());
  if (filters.before) params.set('before', filters.before);
  if (filters.limit) params.set('limit', String(filters.limit));
  const suffix = params.size > 0 ? `?${params.toString()}` : '';
  const { data } = await apiRequest(
    `${workspaceRoutes(workspaceId).media}${suffix}`,
    mediaListResponseSchema,
    { signal },
  );
  return data;
}

/** The server identifies the file by its content and decides whether it is accepted. */
export async function uploadMedia(
  workspaceId: string,
  file: File,
  fields: { altText?: string; description?: string } = {},
): Promise<Media> {
  const form = new FormData();
  if (fields.altText?.trim()) form.set('altText', fields.altText.trim());
  if (fields.description?.trim()) form.set('description', fields.description.trim());
  form.set('file', file, file.name);
  const { data } = await apiRequest(workspaceRoutes(workspaceId).media, mediaResponseSchema, {
    method: 'POST',
    body: form,
    timeoutMs: UPLOAD_TIMEOUT_MS,
  });
  return data.media;
}

export async function updateMedia(
  workspaceId: string,
  mediaId: string,
  changes: UpdateMediaRequest,
): Promise<Media> {
  const body = updateMediaRequestSchema.parse(changes);
  const { data } = await apiRequest(
    workspaceRoutes(workspaceId).mediaItem(mediaId),
    mediaResponseSchema,
    { method: 'PATCH', body },
  );
  return data.media;
}

export async function deleteMedia(workspaceId: string, mediaId: string): Promise<void> {
  await apiRequest(workspaceRoutes(workspaceId).mediaItem(mediaId), noContentSchema, {
    method: 'DELETE',
  });
}

/** Owner only. `null` removes the logo (the image stays in the library). */
export async function setWorkspaceLogo(
  workspaceId: string,
  mediaId: string | null,
): Promise<Workspace> {
  const { data } = await apiRequest(workspaceRoutes(workspaceId).logo, workspaceResponseSchema, {
    method: 'PUT',
    body: { mediaId },
  });
  return data.workspace;
}

/**
 * Address of the file for <img>/<video>. The browser sends the session cookie, so this works
 * when the web app and API share a site (see docs/architecture.md, "Media storage").
 */
export function mediaFileUrl(workspaceId: string, mediaId: string, download = false): string {
  return `${API_BASE_URL}${workspaceRoutes(workspaceId).mediaFile(mediaId)}${download ? '?download=1' : ''}`;
}
