import type { AiProviderId } from '@metaflow/shared';

/**
 * The contract every AI provider adapter implements. The rest of the application only sees
 * these types: which provider and model answer a request is decided by the model resolver,
 * from server configuration.
 */

/** A JSON Schema object in the subset all providers accept (no length or numeric limits). */
export type JsonSchema = Record<string, unknown>;

export interface AiGenerationRequest {
  /** Rules and business context. */
  system: string;
  /** The specific task. */
  prompt: string;
  /** Short identifier for the output schema: letters, digits and underscores. */
  schemaName: string;
  /** The output must be one JSON value matching this schema. */
  schema: JsonSchema;
  /** Upper bound for the reply, including any reasoning tokens the model spends. */
  maxOutputTokens: number;
}

/** Token counts as the provider reported them. Null means "not reported", never zero. */
export interface AiTokenUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
}

export const NO_USAGE: AiTokenUsage = { inputTokens: null, outputTokens: null, totalTokens: null };

export interface AiGenerationResult {
  /** The parsed JSON reply. Not yet checked against the feature's rules. */
  output: unknown;
  usage: AiTokenUsage;
  /** The model that answered, as the provider reported it (e.g. a dated snapshot name). */
  model: string;
}

export interface AiProvider {
  readonly id: AiProviderId;
  generate(request: AiGenerationRequest, options: { model: string }): Promise<AiGenerationResult>;
}

export type AiErrorKind =
  /** The API key was rejected or lacks access: a server configuration problem. */
  | 'auth'
  /** The model is unknown or the request was rejected as invalid: a configuration problem. */
  | 'configuration'
  /** The provider account is out of credit or reached its spend limit. */
  | 'quota'
  | 'rate_limited'
  /** The provider says it did not process the request (overloaded / unavailable). */
  | 'overloaded'
  /** Another server-side failure at the provider. */
  | 'unavailable'
  | 'timeout'
  /** No response at all (connection failed). */
  | 'network'
  /** The model or the provider's safety system declined. */
  | 'refused'
  /** The reply was cut off by the token limit. */
  | 'truncated'
  /** The reply was not usable JSON. */
  | 'invalid_output';

/**
 * A failed provider call. The message is ours: it never contains provider text, the prompt,
 * the reply or credentials.
 */
export class AiProviderError extends Error {
  readonly status: number | null;
  readonly retryAfterMs: number | null;
  /** Tokens the failed call still used, when the provider reported them. */
  readonly usage: AiTokenUsage;
  readonly model: string | null;

  constructor(
    readonly kind: AiErrorKind,
    details: {
      status?: number | null;
      retryAfterMs?: number | null;
      usage?: AiTokenUsage;
      model?: string | null;
    } = {},
  ) {
    super(`AI provider error (${kind}${details.status ? `, HTTP ${details.status}` : ''})`);
    this.name = 'AiProviderError';
    this.status = details.status ?? null;
    this.retryAfterMs = details.retryAfterMs ?? null;
    this.usage = details.usage ?? NO_USAGE;
    this.model = details.model ?? null;
  }
}

/** Retry-After as milliseconds: seconds or an HTTP date. Null when absent or unreadable. */
export function retryAfterMs(header: string | null | undefined, now = Date.now()): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const date = Date.parse(header);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}

/** The meaning of an HTTP error status, the same way for every provider. */
export function kindForStatus(status: number): AiErrorKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 402) return 'quota';
  if (status === 429) return 'rate_limited';
  if (status === 503 || status === 529) return 'overloaded';
  if (status === 408 || status === 504) return 'timeout';
  if (status >= 500) return 'unavailable';
  return 'configuration';
}

export const countOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;

/** Parses the model's JSON reply, keeping the usage for the record if it is not JSON. */
export function parseJsonReply(text: string, usage: AiTokenUsage, model: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AiProviderError('invalid_output', { usage, model });
  }
}

/** A JSON POST with a timeout. Network and timeout failures drop their cause (it has URLs). */
export async function postJson(
  fetchImpl: typeof fetch,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs: number,
): Promise<{ status: number; headers: Headers; json: unknown }> {
  const isTimeout = (error: unknown) =>
    error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new AiProviderError(isTimeout(error) ? 'timeout' : 'network');
  }
  let json: unknown;
  try {
    json = await response.json();
  } catch (error) {
    if (isTimeout(error)) throw new AiProviderError('timeout');
    json = undefined;
  }
  return { status: response.status, headers: response.headers, json };
}

export type Json = Record<string, unknown>;
export const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
