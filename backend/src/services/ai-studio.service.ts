import {
  DEFAULT_BRAND_TONE,
  DEFAULT_EMOJI_PREFERENCE,
  type AiFeature,
  type AiGeneration,
  type AiStatusResponse,
  type AiUsageSummary,
  type BrandVoice,
  type CaptionSettings,
  type HashtagSettings,
  type IdeasSettings,
  type captionRequestSchema,
  type hashtagRequestSchema,
  type ideasRequestSchema,
  type updateBrandVoiceRequestSchema,
} from '@metaflow/shared';
import type { z } from 'zod';
import type { AiModelResolver } from '../integrations/ai/ai-model-resolver';
import {
  AiProviderError,
  type AiErrorKind,
  type AiGenerationRequest,
  type AiTokenUsage,
} from '../integrations/ai/ai-provider';
import { generateWithSafeRetry } from '../integrations/ai/ai-retry';
import type { AiPricing } from '../config/env';
import type {
  AiGenerationRecord,
  AiRepositories,
  GenerationContent,
} from '../repositories/ai-repositories';
import type { WorkspaceRecord, WorkspaceRepository } from '../repositories/workspace-repositories';
import { AppError } from '../utils/app-error';
import type { Logger } from '../utils/logger';
import { cleanCaptions, cleanHashtags, cleanIdeas } from './ai-output';
import {
  CAPTION_OUTPUT_JSON_SCHEMA,
  HASHTAG_OUTPUT_JSON_SCHEMA,
  IDEAS_OUTPUT_JSON_SCHEMA,
  MAX_OUTPUT_TOKENS,
  buildCaptionPrompt,
  buildHashtagPrompt,
  buildIdeasPrompt,
  buildSystemPrompt,
} from './ai-prompts';
import type { WorkspaceService } from './workspace.service';

type CaptionInput = z.output<typeof captionRequestSchema>;
type HashtagInput = z.output<typeof hashtagRequestSchema>;
type IdeasInput = z.output<typeof ideasRequestSchema>;
type BrandVoiceInput = z.output<typeof updateBrandVoiceRequestSchema>;

type Generated<F extends AiFeature> = Extract<AiGenerationRecord, { feature: F }>;

export interface AiStudioService {
  status(userId: string, workspaceId: string): Promise<AiStatusResponse>;
  generateCaptions(
    userId: string,
    workspaceId: string,
    input: CaptionInput,
  ): Promise<Generated<'caption'>>;
  generateHashtags(
    userId: string,
    workspaceId: string,
    input: HashtagInput,
  ): Promise<Generated<'hashtags'>>;
  generateIdeas(
    userId: string,
    workspaceId: string,
    input: IdeasInput,
  ): Promise<Generated<'ideas'>>;
  getBrandVoice(userId: string, workspaceId: string): Promise<BrandVoice>;
  /** Owner only. */
  updateBrandVoice(
    userId: string,
    workspaceId: string,
    input: BrandVoiceInput,
  ): Promise<BrandVoice>;
  listGenerations(
    userId: string,
    workspaceId: string,
    query: { feature?: AiFeature; before?: string; limit: number },
  ): Promise<{ generations: AiGenerationRecord[]; nextCursor: string | null }>;
  /** The current calendar month (UTC). */
  usageSummary(userId: string, workspaceId: string): Promise<AiUsageSummary>;
}

export function toAiGeneration(record: AiGenerationRecord): AiGeneration {
  const base = {
    id: record.id,
    userId: record.userId,
    createdAt: record.createdAt.toISOString(),
    usage: { provider: record.provider, model: record.model, ...record.usage },
  };
  switch (record.feature) {
    case 'caption':
      return { ...base, feature: 'caption', settings: record.settings, output: record.output };
    case 'hashtags':
      return { ...base, feature: 'hashtags', settings: record.settings, output: record.output };
    case 'ideas':
      return { ...base, feature: 'ideas', settings: record.settings, output: record.output };
  }
}

export function toBrandVoice(workspace: WorkspaceRecord): BrandVoice {
  const voice = workspace.brandVoice;
  return {
    description: workspace.description,
    language: workspace.defaultLanguage,
    targetAudience: voice?.targetAudience ?? '',
    tone: voice?.tone ?? DEFAULT_BRAND_TONE,
    personality: voice?.personality ?? '',
    writingStyle: voice?.writingStyle ?? '',
    wordsToUse: voice?.wordsToUse ?? [],
    wordsToAvoid: voice?.wordsToAvoid ?? [],
    emojiPreference: voice?.emojiPreference ?? DEFAULT_EMOJI_PREFERENCE,
    additionalInstructions: voice?.additionalInstructions ?? '',
    configured: voice !== null,
    updatedAt: voice?.updatedAt.toISOString() ?? null,
  };
}

/** What people see. Never provider text, status codes or configuration details. */
const FAILURES: Record<
  AiErrorKind,
  { code: 'INTEGRATION_ERROR' | 'GENERATION_REFUSED'; message: string }
> = {
  auth: {
    code: 'INTEGRATION_ERROR',
    message:
      'AI generation is not working because of a server setup problem. Ask your administrator to check the AI provider settings.',
  },
  configuration: {
    code: 'INTEGRATION_ERROR',
    message:
      'AI generation is not working because of a server setup problem. Ask your administrator to check the AI provider settings.',
  },
  quota: {
    code: 'INTEGRATION_ERROR',
    message:
      'AI generation is paused because the AI provider account has reached its limit. Ask your administrator to check the account.',
  },
  rate_limited: {
    code: 'INTEGRATION_ERROR',
    message: 'The AI service is busy right now. Try again in a minute.',
  },
  overloaded: {
    code: 'INTEGRATION_ERROR',
    message: 'The AI service is busy right now. Try again in a minute.',
  },
  unavailable: {
    code: 'INTEGRATION_ERROR',
    message: 'The AI service is having a problem right now. Try again in a few minutes.',
  },
  network: {
    code: 'INTEGRATION_ERROR',
    message: 'The AI service could not be reached. Try again in a few minutes.',
  },
  timeout: {
    code: 'INTEGRATION_ERROR',
    message: 'The AI took too long to answer. Try again, perhaps with fewer variations.',
  },
  refused: {
    code: 'GENERATION_REFUSED',
    message: 'The AI declined to write this. Try describing the post differently.',
  },
  truncated: {
    code: 'INTEGRATION_ERROR',
    message: 'The answer was cut off. Try again with fewer variations or a shorter length.',
  },
  invalid_output: {
    code: 'INTEGRATION_ERROR',
    message: 'The AI returned an answer MetaFlow AI could not use. Please try again.',
  },
};

/** Server problems an administrator has to fix: logged as errors, not warnings. */
const NEEDS_ADMIN: ReadonlySet<AiErrorKind> = new Set(['auth', 'configuration', 'quota']);

const NOT_CONFIGURED = () =>
  new AppError(
    'INTEGRATION_NOT_CONFIGURED',
    'AI generation is not set up on this server yet. Ask your administrator to add an AI provider.',
  );

/** A served model counts as the configured one when it is the same name or a dated snapshot of it. */
const sameModel = (configured: string, served: string) =>
  served === configured || served.startsWith(`${configured}-`);

export function estimateCostUsd(
  pricing: AiPricing | null,
  usage: AiTokenUsage,
  configuredModel: string,
  servedModel: string | null,
): number | null {
  if (!pricing || usage.inputTokens === null || usage.outputTokens === null) return null;
  // Prices are configured for one model: for any other, no estimate rather than a wrong one.
  if (servedModel !== null && !sameModel(configuredModel, servedModel)) return null;
  const cost =
    (usage.inputTokens * pricing.inputPerMillionTokensUsd +
      usage.outputTokens * pricing.outputPerMillionTokensUsd) /
    1_000_000;
  return Math.round(cost * 1_000_000) / 1_000_000;
}

export function createAiStudioService({
  workspaces,
  workspaceRepository,
  repositories,
  models,
  logger,
  now = () => new Date(),
  sleep,
}: {
  workspaces: Pick<WorkspaceService, 'requireAccess'>;
  /** Only to save the brand voice; access is always checked through `workspaces` first. */
  workspaceRepository: Pick<WorkspaceRepository, 'updateBrandVoice'>;
  repositories: AiRepositories;
  models: AiModelResolver;
  logger: Logger;
  now?: () => Date;
  /** Tests only: the wait before a retry. */
  sleep?: (ms: number) => Promise<void>;
}): AiStudioService {
  /**
   * Runs one generation for a workspace the caller may use: picks the model, calls the
   * provider (with the safe retry policy), checks the reply, records usage either way and
   * saves the result to the history.
   */
  async function generate<C extends GenerationContent>({
    userId,
    workspace,
    feature,
    settings,
    request,
    clean,
  }: {
    userId: string;
    workspace: WorkspaceRecord;
    feature: C['feature'];
    settings: C['settings'];
    request: AiGenerationRequest;
    clean: (output: unknown) => C['output'] | null;
  }): Promise<AiGenerationRecord> {
    const resolved = await models.resolve({ feature, workspaceId: workspace.id });
    if (!resolved) throw NOT_CONFIGURED();
    const { provider, model, pricing } = resolved;
    const started = Date.now();
    const record = (
      outcome: { status: 'succeeded' } | { status: 'failed'; errorKind: AiErrorKind },
      usage: AiTokenUsage,
      servedModel: string | null,
    ) => {
      const estimatedCostUsd = estimateCostUsd(pricing, usage, model, servedModel);
      return repositories.usage
        .record({
          workspaceId: workspace.id,
          userId,
          feature,
          provider: provider.id,
          model,
          servedModel,
          status: outcome.status,
          errorKind: outcome.status === 'failed' ? outcome.errorKind : null,
          ...usage,
          estimatedCostUsd,
          latencyMs: Math.max(0, Date.now() - started),
          createdAt: now(),
        })
        .then(() => estimatedCostUsd);
    };
    const fail = async (error: AiProviderError) => {
      await record({ status: 'failed', errorKind: error.kind }, error.usage, error.model);
      // Kind and status only: never the prompt, the reply or provider text.
      logger[NEEDS_ADMIN.has(error.kind) ? 'error' : 'warn']('ai.generation.failed', {
        feature,
        provider: provider.id,
        model,
        kind: error.kind,
        status: error.status,
      });
      const failure = FAILURES[error.kind];
      return new AppError(failure.code, failure.message);
    };

    let result;
    try {
      result = await generateWithSafeRetry(provider, request, { model }, sleep ? { sleep } : {});
    } catch (error) {
      if (error instanceof AiProviderError) throw await fail(error);
      throw error;
    }

    const output = clean(result.output);
    if (output === null) {
      throw await fail(
        new AiProviderError('invalid_output', { usage: result.usage, model: result.model }),
      );
    }
    const estimatedCostUsd = await record({ status: 'succeeded' }, result.usage, result.model);
    return repositories.generations.create({
      feature,
      settings,
      output,
      workspaceId: workspace.id,
      userId,
      provider: provider.id,
      model: result.model,
      usage: { ...result.usage, estimatedCostUsd },
    });
  }

  const system = (workspace: WorkspaceRecord) => buildSystemPrompt(workspace, now());

  return {
    async status(userId, workspaceId) {
      await workspaces.requireAccess(userId, workspaceId);
      const described = models.describe();
      return {
        configured: described !== null,
        provider: described?.provider ?? null,
        model: described?.model ?? null,
        costEstimates: described?.costEstimates ?? false,
      };
    },

    async generateCaptions(userId, workspaceId, input) {
      const { workspace } = await workspaces.requireAccess(userId, workspaceId);
      const voice = workspace.brandVoice;
      const settings: CaptionSettings = {
        topic: input.topic,
        product: input.product,
        audience: input.audience,
        platform: input.platform,
        objective: input.objective,
        tone: input.tone ?? voice?.tone ?? DEFAULT_BRAND_TONE,
        language: input.language ?? workspace.defaultLanguage,
        length: input.length,
        emoji: input.emoji ?? voice?.emojiPreference ?? DEFAULT_EMOJI_PREFERENCE,
        callToAction: input.callToAction,
        callToActionText: input.callToActionText,
        variations: input.variations,
      };
      return (await generate({
        userId,
        workspace,
        feature: 'caption',
        settings,
        request: {
          system: system(workspace),
          prompt: buildCaptionPrompt(settings, input.avoid),
          schemaName: 'captions',
          schema: CAPTION_OUTPUT_JSON_SCHEMA,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
        },
        clean: (output) => cleanCaptions(output, settings),
      })) as Generated<'caption'>;
    },

    async generateHashtags(userId, workspaceId, input) {
      const { workspace } = await workspaces.requireAccess(userId, workspaceId);
      const settings: HashtagSettings = {
        topic: input.topic,
        product: input.product,
        audience: input.audience,
        category: input.category ?? workspace.category,
        platform: input.platform,
        language: input.language ?? workspace.defaultLanguage,
      };
      return (await generate({
        userId,
        workspace,
        feature: 'hashtags',
        settings,
        request: {
          system: system(workspace),
          prompt: buildHashtagPrompt(settings),
          schemaName: 'hashtags',
          schema: HASHTAG_OUTPUT_JSON_SCHEMA,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
        },
        clean: cleanHashtags,
      })) as Generated<'hashtags'>;
    },

    async generateIdeas(userId, workspaceId, input) {
      const { workspace } = await workspaces.requireAccess(userId, workspaceId);
      const settings: IdeasSettings = {
        focus: input.focus,
        platform: input.platform ?? null,
        types: input.types,
        count: input.count,
        language: input.language ?? workspace.defaultLanguage,
      };
      return (await generate({
        userId,
        workspace,
        feature: 'ideas',
        settings,
        request: {
          system: system(workspace),
          prompt: buildIdeasPrompt(settings),
          schemaName: 'content_ideas',
          schema: IDEAS_OUTPUT_JSON_SCHEMA,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
        },
        clean: (output) => cleanIdeas(output, settings),
      })) as Generated<'ideas'>;
    },

    async getBrandVoice(userId, workspaceId) {
      const { workspace } = await workspaces.requireAccess(userId, workspaceId);
      return toBrandVoice(workspace);
    },

    async updateBrandVoice(userId, workspaceId, input) {
      await workspaces.requireAccess(userId, workspaceId, { role: 'owner' });
      const { description, language, ...voice } = input;
      const updated = await workspaceRepository.updateBrandVoice(workspaceId, {
        description,
        defaultLanguage: language,
        brandVoice: { ...voice, updatedAt: now() },
      });
      if (!updated) throw new AppError('NOT_FOUND', 'Workspace not found');
      return toBrandVoice(updated);
    },

    async listGenerations(userId, workspaceId, { feature, before, limit }) {
      await workspaces.requireAccess(userId, workspaceId);
      const page = await repositories.generations.list(workspaceId, {
        feature,
        before,
        limit: limit + 1,
      });
      const generations = page.slice(0, limit);
      return {
        generations,
        nextCursor: page.length > limit ? (generations.at(-1)?.id ?? null) : null,
      };
    },

    async usageSummary(userId, workspaceId) {
      await workspaces.requireAccess(userId, workspaceId);
      const at = now();
      const from = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
      const to = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1));
      const totals = await repositories.usage.summarize(workspaceId, from, to);
      return { periodStart: from.toISOString(), periodEnd: to.toISOString(), ...totals };
    },
  };
}
