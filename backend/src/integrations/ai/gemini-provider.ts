import {
  AiProviderError,
  countOrNull,
  isObject,
  kindForStatus,
  parseJsonReply,
  postJson,
  retryAfterMs,
  type AiProvider,
  type AiTokenUsage,
} from './ai-provider';
import type { FetchProviderConfig } from './openai-provider';

/**
 * Google Gemini through the Interactions API (`POST /v1beta/interactions`), which Google's
 * current guides use (generateContent is labelled legacy). Structured output via
 * `response_format` with a JSON schema; `store: false` so Google keeps no copy for retrieval.
 */
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/interactions';
const API_REVISION = '2026-05-20';

export function createGeminiProvider({
  apiKey,
  timeoutMs,
  fetchImpl = fetch,
}: FetchProviderConfig): AiProvider {
  return {
    id: 'gemini',

    async generate(request, { model }) {
      const { status, headers, json } = await postJson(
        fetchImpl,
        ENDPOINT,
        // The key goes in a header, never in the URL.
        { 'x-goog-api-key': apiKey, 'Api-Revision': API_REVISION },
        {
          model,
          system_instruction: request.system,
          input: request.prompt,
          generation_config: { max_output_tokens: request.maxOutputTokens },
          response_format: { type: 'text', mime_type: 'application/json', schema: request.schema },
          store: false,
        },
        timeoutMs,
      );

      if (status < 200 || status >= 300) {
        throw new AiProviderError(kindForStatus(status), {
          status,
          retryAfterMs: retryAfterMs(headers.get('retry-after')),
        });
      }
      if (!isObject(json)) throw new AiProviderError('invalid_output');

      const usageField = isObject(json.usage) ? json.usage : {};
      const output = countOrNull(usageField.total_output_tokens);
      const thoughts = countOrNull(usageField.total_thought_tokens);
      const usage: AiTokenUsage = {
        inputTokens: countOrNull(usageField.total_input_tokens),
        // Gemini reports thinking tokens separately and bills them as output.
        outputTokens: output === null ? null : output + (thoughts ?? 0),
        totalTokens: countOrNull(usageField.total_tokens),
      };
      const servedModel = typeof json.model === 'string' ? json.model : model;

      if (json.status === 'incomplete') {
        throw new AiProviderError('truncated', { usage, model: servedModel });
      }
      if (json.status === 'failed' || json.status === 'cancelled') {
        throw new AiProviderError('unavailable', { usage, model: servedModel });
      }
      if (json.status !== 'completed') {
        throw new AiProviderError('invalid_output', { usage, model: servedModel });
      }

      const text = (Array.isArray(json.steps) ? json.steps : [])
        .filter(
          (step): step is Record<string, unknown> => isObject(step) && step.type === 'model_output',
        )
        .flatMap((step) => (Array.isArray(step.content) ? (step.content as unknown[]) : []))
        .filter(isObject)
        .filter((block) => block.type === 'text' && typeof block.text === 'string')
        .map((block) => block.text as string)
        .join('');
      // A completed interaction without text is how blocked content shows up.
      if (text.trim() === '') throw new AiProviderError('refused', { usage, model: servedModel });
      return { output: parseJsonReply(text, usage, servedModel), usage, model: servedModel };
    },
  };
}
