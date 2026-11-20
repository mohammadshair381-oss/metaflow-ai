import type {
  AiFeature,
  AiProviderId,
  CaptionOutput,
  CaptionSettings,
  HashtagOutput,
  HashtagSettings,
  IdeasOutput,
  IdeasSettings,
} from '@metaflow/shared';

/**
 * Data-access contracts for AI Studio: generation history and usage records. Every method
 * takes the workspace ID; the service resolves it through workspaceService.requireAccess().
 */

export type GenerationContent =
  | { feature: 'caption'; settings: CaptionSettings; output: CaptionOutput }
  | { feature: 'hashtags'; settings: HashtagSettings; output: HashtagOutput }
  | { feature: 'ideas'; settings: IdeasSettings; output: IdeasOutput };

export interface GenerationUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  estimatedCostUsd: number | null;
}

export type AiGenerationRecord = GenerationContent & {
  id: string;
  workspaceId: string;
  userId: string;
  provider: AiProviderId;
  model: string;
  usage: GenerationUsage;
  createdAt: Date;
};

export type NewAiGeneration = Omit<AiGenerationRecord, 'id' | 'createdAt'>;

export interface AiGenerationRepository {
  create(generation: NewAiGeneration): Promise<AiGenerationRecord>;
  /** Newest first. `before` is the ID of the last generation already shown. */
  list(
    workspaceId: string,
    options: { feature?: AiFeature; before?: string; limit: number },
  ): Promise<AiGenerationRecord[]>;
  findInWorkspace(workspaceId: string, generationId: string): Promise<AiGenerationRecord | null>;
}

export interface AiUsageEntry {
  workspaceId: string;
  userId: string;
  feature: AiFeature;
  provider: AiProviderId;
  model: string;
  servedModel: string | null;
  status: 'succeeded' | 'failed';
  errorKind: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  estimatedCostUsd: number | null;
  latencyMs: number;
  createdAt: Date;
}

export interface AiUsageTotals {
  requests: number;
  succeeded: number;
  failed: number;
  /** Sums over the entries that reported token counts. */
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  requestsWithoutTokenData: number;
  /** Null when no entry in the period has a cost estimate. */
  estimatedCostUsd: number | null;
  requestsWithoutCost: number;
}

export interface AiUsageRepository {
  record(entry: AiUsageEntry): Promise<void>;
  /** Totals for entries with `from <= createdAt < to`. */
  summarize(workspaceId: string, from: Date, to: Date): Promise<AiUsageTotals>;
}

export interface AiRepositories {
  generations: AiGenerationRepository;
  usage: AiUsageRepository;
}
