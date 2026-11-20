import Anthropic from '@anthropic-ai/sdk';
import {
  AiProviderError,
  isObject,
  kindForStatus,
  parseJsonReply,
  retryAfterMs,
  type AiProvider,
  type AiTokenUsage,
} from './ai-provider';

/**
 * Claude, through the official Anthropic SDK (Messages API, structured outputs with
 * `output_config.format`). Thinking is left at the model's default: on current models it
 * is adaptive and cannot be turned off.
 *
 * Refusals are final. A request the model or its safety system declines ends as `refused`:
 * it is never re-run on another model (no server-side `fallbacks`), and ai-retry.ts never
 * retries a refusal. Every request goes to exactly the configured model.
 */

export interface AnthropicProviderConfig {
  apiKey: string;
  timeoutMs: number;
  /** Tests only: replaces the network. */
  fetchImpl?: typeof fetch;
}

interface UsageFields {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

/** Input includes any cached prefix tokens, so the count matches what was processed. */
function toUsage(usage: UsageFields): AiTokenUsage {
  const input =
    usage.input_tokens +
    (usage.cache_creation_input_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0);
  return {
    inputTokens: input,
    outputTokens: usage.output_tokens,
    totalTokens: input + usage.output_tokens,
  };
}

/** Most specific SDK error class first: the timeout and connection errors extend APIError. */
function toProviderError(error: unknown): AiProviderError {
  if (error instanceof Anthropic.APIConnectionTimeoutError) return new AiProviderError('timeout');
  if (error instanceof Anthropic.APIConnectionError) return new AiProviderError('network');
  if (error instanceof Anthropic.APIError) {
    const status = typeof error.status === 'number' ? error.status : null;
    const headers = error.headers as Headers | undefined;
    const retryAfter = retryAfterMs(headers?.get('retry-after'));
    if (error instanceof Anthropic.RateLimitError) {
      // A monthly spend cap also answers 429, without retry-after; retrying cannot help.
      const body: unknown = error.error;
      const details =
        isObject(body) && isObject(body.error) && isObject(body.error.details)
          ? body.error.details
          : {};
      const spendCap = details.error_code === 'enforced_spend_limit_reached';
      return new AiProviderError(spendCap ? 'quota' : 'rate_limited', {
        status,
        retryAfterMs: retryAfter,
      });
    }
    return new AiProviderError(status === null ? 'unavailable' : kindForStatus(status), {
      status,
      retryAfterMs: retryAfter,
    });
  }
  throw error;
}

export function createAnthropicProvider({
  apiKey,
  timeoutMs,
  fetchImpl,
}: AnthropicProviderConfig): AiProvider {
  const client = new Anthropic({
    apiKey,
    // Fixed endpoint: an ANTHROPIC_BASE_URL in the environment must not redirect this key.
    baseURL: 'https://api.anthropic.com',
    timeout: timeoutMs,
    // Retries are decided by ai-retry.ts, the same way for every provider.
    maxRetries: 0,
    logLevel: 'off',
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  });

  return {
    id: 'anthropic',

    async generate(request, { model }) {
      const params = {
        model,
        max_tokens: request.maxOutputTokens,
        system: request.system,
        messages: [{ role: 'user' as const, content: request.prompt }],
        output_config: { format: { type: 'json_schema' as const, schema: request.schema } },
      };

      let reply: {
        model: string;
        stop_reason: string | null;
        usage: UsageFields;
        content: ReadonlyArray<{ type: string; text?: string }>;
      };
      try {
        reply = await client.messages.create(params);
      } catch (error) {
        throw toProviderError(error);
      }

      const usage = toUsage(reply.usage);
      // Always check why the model stopped before reading the content.
      if (reply.stop_reason === 'refusal') {
        throw new AiProviderError('refused', { usage, model: reply.model });
      }
      if (
        reply.stop_reason === 'max_tokens' ||
        reply.stop_reason === 'model_context_window_exceeded'
      ) {
        throw new AiProviderError('truncated', { usage, model: reply.model });
      }
      const text = reply.content
        .filter((block) => block.type === 'text' && typeof block.text === 'string')
        .map((block) => block.text)
        .join('');
      return { output: parseJsonReply(text, usage, reply.model), usage, model: reply.model };
    },
  };
}
