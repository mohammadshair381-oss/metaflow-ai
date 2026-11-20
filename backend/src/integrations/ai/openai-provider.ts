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

/**
 * OpenAI Responses API (`POST /v1/responses`) with Structured Outputs: `text.format` set to a
 * strict `json_schema`. Requests are sent with `store: false`, so OpenAI does not keep the
 * prompt or reply for later retrieval.
 */
const ENDPOINT = 'https://api.openai.com/v1/responses';

export interface FetchProviderConfig {
  apiKey: string;
  timeoutMs: number;
  /** Tests only: replaces the network. */
  fetchImpl?: typeof fetch;
}

export function createOpenAiProvider({
  apiKey,
  timeoutMs,
  fetchImpl = fetch,
}: FetchProviderConfig): AiProvider {
  return {
    id: 'openai',

    async generate(request, { model }) {
      const { status, headers, json } = await postJson(
        fetchImpl,
        ENDPOINT,
        { Authorization: `Bearer ${apiKey}` },
        {
          model,
          instructions: request.system,
          input: request.prompt,
          max_output_tokens: request.maxOutputTokens,
          store: false,
          text: {
            format: {
              type: 'json_schema',
              name: request.schemaName,
              schema: request.schema,
              strict: true,
            },
          },
        },
        timeoutMs,
      );

      if (status < 200 || status >= 300) {
        const error = isObject(json) && isObject(json.error) ? json.error : {};
        // OpenAI uses 429 both for rate limits and for an exhausted account balance.
        const kind =
          status === 429 && error.code === 'insufficient_quota' ? 'quota' : kindForStatus(status);
        throw new AiProviderError(kind, {
          status,
          retryAfterMs: retryAfterMs(headers.get('retry-after')),
        });
      }
      if (!isObject(json)) throw new AiProviderError('invalid_output');

      const usageField = isObject(json.usage) ? json.usage : {};
      const usage: AiTokenUsage = {
        inputTokens: countOrNull(usageField.input_tokens),
        // Includes reasoning tokens (reported as a detail of output_tokens).
        outputTokens: countOrNull(usageField.output_tokens),
        totalTokens: countOrNull(usageField.total_tokens),
      };
      const servedModel = typeof json.model === 'string' ? json.model : model;

      if (json.status === 'incomplete') {
        const reason = isObject(json.incomplete_details) ? json.incomplete_details.reason : null;
        throw new AiProviderError(reason === 'content_filter' ? 'refused' : 'truncated', {
          usage,
          model: servedModel,
        });
      }
      if (json.status === 'failed' || json.status === 'cancelled') {
        throw new AiProviderError('unavailable', { usage, model: servedModel });
      }
      if (json.status !== 'completed') {
        throw new AiProviderError('invalid_output', { usage, model: servedModel });
      }

      const parts = (Array.isArray(json.output) ? json.output : [])
        .filter(
          (item): item is Record<string, unknown> => isObject(item) && item.type === 'message',
        )
        .flatMap((item) => (Array.isArray(item.content) ? (item.content as unknown[]) : []))
        .filter(isObject);
      if (parts.some((part) => part.type === 'refusal')) {
        throw new AiProviderError('refused', { usage, model: servedModel });
      }
      const text = parts
        .filter((part) => part.type === 'output_text' && typeof part.text === 'string')
        .map((part) => part.text as string)
        .join('');
      return { output: parseJsonReply(text, usage, servedModel), usage, model: servedModel };
    },
  };
}
