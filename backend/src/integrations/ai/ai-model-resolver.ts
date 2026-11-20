import type { AiFeature, AiProviderId } from '@metaflow/shared';
import type { AiConfig, AiPricing } from '../../config/env';
import type { AiProvider } from './ai-provider';
import { createAnthropicProvider } from './anthropic-provider';
import { createGeminiProvider } from './gemini-provider';
import { createOpenAiProvider } from './openai-provider';

/** Per attempt. Long enough for a model that reasons briefly before answering. */
export const AI_REQUEST_TIMEOUT_MS = 60_000;

export function createAiProvider(
  provider: AiProviderId,
  config: { apiKey: string; timeoutMs?: number; fetchImpl?: typeof fetch },
): AiProvider {
  const options = { timeoutMs: AI_REQUEST_TIMEOUT_MS, ...config };
  switch (provider) {
    case 'anthropic':
      return createAnthropicProvider(options);
    case 'openai':
      return createOpenAiProvider(options);
    case 'gemini':
      return createGeminiProvider(options);
  }
}

export interface ResolvedAiModel {
  provider: AiProvider;
  model: string;
  pricing: AiPricing | null;
}

/**
 * Decides which provider and model serve a request. Today one model, from the environment,
 * serves every feature. Admin-managed providers and plan-based routing (by feature and by the
 * workspace's subscription) replace this implementation later; callers do not change.
 */
export interface AiModelResolver {
  /** Public facts for the UI. Never includes credentials. */
  describe(): { provider: AiProviderId; model: string; costEstimates: boolean } | null;
  resolve(request: { feature: AiFeature; workspaceId: string }): Promise<ResolvedAiModel | null>;
}

export function createEnvModelResolver(
  config: AiConfig | null,
  /** Tests only: replaces the real provider adapter. */
  providerOverride?: AiProvider,
): AiModelResolver {
  const provider = config
    ? (providerOverride ?? createAiProvider(config.provider, { apiKey: config.apiKey }))
    : null;
  return {
    describe: () =>
      config
        ? { provider: config.provider, model: config.model, costEstimates: config.pricing !== null }
        : null,
    resolve: () =>
      Promise.resolve(
        config && provider ? { provider, model: config.model, pricing: config.pricing } : null,
      ),
  };
}
