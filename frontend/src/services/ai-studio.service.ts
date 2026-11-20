import {
  aiGenerationListResponseSchema,
  aiStatusResponseSchema,
  aiUsageSummaryResponseSchema,
  brandVoiceResponseSchema,
  captionGenerationResponseSchema,
  createDraftRequestSchema,
  hashtagGenerationResponseSchema,
  ideasGenerationResponseSchema,
  postListResponseSchema,
  postResponseSchema,
  workspaceRoutes,
  type AiFeature,
  type AiGenerationListResponse,
  type AiStatusResponse,
  type AiUsageSummary,
  type BrandVoice,
  type CaptionGeneration,
  type CaptionRequest,
  type CreateDraftRequest,
  type HashtagGeneration,
  type HashtagRequest,
  type IdeasGeneration,
  type IdeasRequest,
  type Post,
  type PostListResponse,
  type UpdateBrandVoiceRequest,
} from '@metaflow/shared';
import { apiRequest } from './api-client';

/**
 * A model can take a while to answer, and the server may retry once: wait longer than the
 * server's own limit (60 s per attempt) before giving up.
 */
const GENERATION_TIMEOUT_MS = 100_000;

export async function fetchAiStatus(
  workspaceId: string,
  signal?: AbortSignal,
): Promise<AiStatusResponse> {
  const { data } = await apiRequest(workspaceRoutes(workspaceId).aiStatus, aiStatusResponseSchema, {
    signal,
  });
  return data;
}

export async function generateCaptions(
  workspaceId: string,
  input: CaptionRequest,
): Promise<CaptionGeneration> {
  const { data } = await apiRequest(
    workspaceRoutes(workspaceId).aiCaptions,
    captionGenerationResponseSchema,
    { method: 'POST', body: input, timeoutMs: GENERATION_TIMEOUT_MS },
  );
  return data.generation;
}

export async function generateHashtags(
  workspaceId: string,
  input: HashtagRequest,
): Promise<HashtagGeneration> {
  const { data } = await apiRequest(
    workspaceRoutes(workspaceId).aiHashtags,
    hashtagGenerationResponseSchema,
    { method: 'POST', body: input, timeoutMs: GENERATION_TIMEOUT_MS },
  );
  return data.generation;
}

export async function generateIdeas(
  workspaceId: string,
  input: IdeasRequest,
): Promise<IdeasGeneration> {
  const { data } = await apiRequest(
    workspaceRoutes(workspaceId).aiIdeas,
    ideasGenerationResponseSchema,
    {
      method: 'POST',
      body: input,
      timeoutMs: GENERATION_TIMEOUT_MS,
    },
  );
  return data.generation;
}

export async function fetchBrandVoice(
  workspaceId: string,
  signal?: AbortSignal,
): Promise<BrandVoice> {
  const { data } = await apiRequest(
    workspaceRoutes(workspaceId).aiBrandVoice,
    brandVoiceResponseSchema,
    { signal },
  );
  return data.brandVoice;
}

export async function saveBrandVoice(
  workspaceId: string,
  input: UpdateBrandVoiceRequest,
): Promise<BrandVoice> {
  const { data } = await apiRequest(
    workspaceRoutes(workspaceId).aiBrandVoice,
    brandVoiceResponseSchema,
    { method: 'PUT', body: input },
  );
  return data.brandVoice;
}

export async function listGenerations(
  workspaceId: string,
  query: { feature?: AiFeature; before?: string } = {},
  signal?: AbortSignal,
): Promise<AiGenerationListResponse> {
  const params = new URLSearchParams();
  if (query.feature) params.set('feature', query.feature);
  if (query.before) params.set('before', query.before);
  const suffix = params.size > 0 ? `?${params.toString()}` : '';
  const { data } = await apiRequest(
    `${workspaceRoutes(workspaceId).aiGenerations}${suffix}`,
    aiGenerationListResponseSchema,
    { signal },
  );
  return data;
}

export async function fetchAiUsage(
  workspaceId: string,
  signal?: AbortSignal,
): Promise<AiUsageSummary> {
  const { data } = await apiRequest(
    workspaceRoutes(workspaceId).aiUsage,
    aiUsageSummaryResponseSchema,
    {
      signal,
    },
  );
  return data.usage;
}

/** Saves a caption as a draft post. Validated with the same rules the API applies. */
export async function createDraft(workspaceId: string, input: CreateDraftRequest): Promise<Post> {
  const body = createDraftRequestSchema.parse(input);
  const { data } = await apiRequest(workspaceRoutes(workspaceId).posts, postResponseSchema, {
    method: 'POST',
    body,
  });
  return data.post;
}

export async function listPosts(
  workspaceId: string,
  query: { before?: string } = {},
  signal?: AbortSignal,
): Promise<PostListResponse> {
  const suffix = query.before ? `?before=${encodeURIComponent(query.before)}` : '';
  const { data } = await apiRequest(
    `${workspaceRoutes(workspaceId).posts}${suffix}`,
    postListResponseSchema,
    {
      signal,
    },
  );
  return data;
}
