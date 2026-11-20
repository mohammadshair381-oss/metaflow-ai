import { describe, expect, it, vi } from 'vitest';
import {
  AiProviderError,
  retryAfterMs,
  type AiGenerationRequest,
} from '../src/integrations/ai/ai-provider';
import { createAnthropicProvider } from '../src/integrations/ai/anthropic-provider';
import { createGeminiProvider } from '../src/integrations/ai/gemini-provider';
import { createOpenAiProvider } from '../src/integrations/ai/openai-provider';

const KEY = 'test-key-not-real-1234567890';
const REQUEST: AiGenerationRequest = {
  system: 'You write social media content.',
  prompt: 'Write one caption.',
  schemaName: 'captions',
  schema: {
    type: 'object',
    properties: { captions: { type: 'array', items: { type: 'string' } } },
    required: ['captions'],
    additionalProperties: false,
  },
  maxOutputTokens: 16_000,
};
const REPLY = { captions: [{ text: 'Fresh bread every morning.' }] };

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

/** A network made of canned responses; records every request. */
function network(...responses: (Response | Error | 'hang')[]) {
  const requests: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
  const fetchImpl = vi.fn<typeof fetch>((input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    requests.push({
      url,
      headers: new Headers(init?.headers),
      body:
        typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {},
    });
    const next = responses.shift();
    if (next === undefined) throw new Error('Unexpected request');
    if (next === 'hang') {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(init.signal?.reason instanceof Error ? init.signal.reason : new Error('aborted'));
        });
      });
    }
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  });
  return { fetchImpl, requests };
}

async function failureOf(promise: Promise<unknown>): Promise<AiProviderError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(AiProviderError);
    return error as AiProviderError;
  }
  throw new Error('Expected the call to fail');
}

const keyNotInUrl = (url: string) => expect(url).not.toContain(KEY);

describe('Anthropic provider (official SDK)', () => {
  const message = (overrides: Record<string, unknown> = {}) => ({
    id: 'msg_01',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-5',
    content: [
      { type: 'thinking', thinking: '', signature: 'sig' },
      { type: 'text', text: JSON.stringify(REPLY) },
    ],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: 120,
      output_tokens: 80,
      cache_creation_input_tokens: 10,
      cache_read_input_tokens: 5,
    },
    ...overrides,
  });
  const provider = (net: ReturnType<typeof network>, timeoutMs = 5_000) =>
    createAnthropicProvider({ apiKey: KEY, timeoutMs, fetchImpl: net.fetchImpl });

  it('asks for structured JSON and returns the parsed reply, model and usage', async () => {
    const net = network(json(message()));
    const result = await provider(net).generate(REQUEST, { model: 'claude-opus-5-5' });

    expect(result).toEqual({
      output: REPLY,
      model: 'claude-opus-5-5',
      // Input includes cached prefix tokens.
      usage: { inputTokens: 135, outputTokens: 80, totalTokens: 215 },
    });
    const [sent] = net.requests;
    expect(sent?.body).toMatchObject({
      model: 'claude-opus-5-5',
      max_tokens: 16_000,
      system: REQUEST.system,
      messages: [{ role: 'user', content: REQUEST.prompt }],
      output_config: { format: { type: 'json_schema', schema: REQUEST.schema } },
    });
    // Thinking is left at the model default; no removed sampling parameters are sent.
    expect(sent?.body).not.toHaveProperty('thinking');
    expect(sent?.body).not.toHaveProperty('temperature');
  });

  it.each(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-fable-5-2', 'claude-haiku-5-5'])(
    'never asks for refusal fallbacks to another model (%s)',
    async (model) => {
      const net = network(json(message({ model })));
      await provider(net).generate(REQUEST, { model });
      const [sent] = net.requests;
      const url = new URL(sent?.url ?? '');
      expect(url.pathname).toBe('/v1/messages');
      expect(url.searchParams.has('beta')).toBe(false);
      expect(sent?.headers.get('anthropic-beta')).toBeNull();
      expect(sent?.body).not.toHaveProperty('fallbacks');
      expect(sent?.body.model).toBe(model);
    },
  );

  it('ends a refused request there: one call, no other model, no retry', async () => {
    const net = network(json(message({ stop_reason: 'refusal', content: [] })));
    const error = await failureOf(provider(net).generate(REQUEST, { model: 'claude-opus-5-5' }));
    expect(error.kind).toBe('refused');
    expect(net.fetchImpl).toHaveBeenCalledTimes(1);
    expect(net.requests.map((request) => request.body.model)).toEqual(['claude-opus-5-5']);
  });

  it('keeps the key out of the URL and uses the fixed API host', async () => {
    const net = network(json(message()));
    await provider(net).generate(REQUEST, { model: 'claude-opus-5-5' });
    const [sent] = net.requests;
    expect(new URL(sent?.url ?? '').origin).toBe('https://api.anthropic.com');
    keyNotInUrl(sent?.url ?? '');
    const headerValues = [...(sent?.headers.values() ?? [])].join(' ');
    expect(headerValues).toContain(KEY);
  });

  it('reports the model name the provider returns', async () => {
    const net = network(json(message({ model: 'claude-opus-5-5-20261101' })));
    const result = await provider(net).generate(REQUEST, { model: 'claude-opus-5-5' });
    expect(result.model).toBe('claude-opus-5-5-20261101');
  });

  it('treats a refusal as refused, keeping the usage', async () => {
    const net = network(json(message({ stop_reason: 'refusal', content: [] })));
    const error = await failureOf(provider(net).generate(REQUEST, { model: 'claude-opus-5-5' }));
    expect(error.kind).toBe('refused');
    expect(error.usage.outputTokens).toBe(80);
  });

  it('treats a reply cut off at max_tokens as truncated', async () => {
    const net = network(json(message({ stop_reason: 'max_tokens' })));
    expect(
      (await failureOf(provider(net).generate(REQUEST, { model: 'claude-opus-5-5' }))).kind,
    ).toBe('truncated');
  });

  it('treats text that is not JSON as invalid output, keeping the usage', async () => {
    const net = network(json(message({ content: [{ type: 'text', text: 'Sure! Here you go' }] })));
    const error = await failureOf(provider(net).generate(REQUEST, { model: 'claude-opus-5-5' }));
    expect(error.kind).toBe('invalid_output');
    expect(error.usage.totalTokens).toBe(215);
  });

  const apiError = (type: string, extra: Record<string, unknown> = {}) => ({
    type: 'error',
    error: { type, message: 'provider detail that must not leak', ...extra },
  });

  it.each([
    [401, 'authentication_error', 'auth'],
    [403, 'permission_error', 'auth'],
    [404, 'not_found_error', 'configuration'],
    [400, 'invalid_request_error', 'configuration'],
    [529, 'overloaded_error', 'overloaded'],
    [500, 'api_error', 'unavailable'],
  ] as const)('maps HTTP %s (%s) to %s', async (status, type, kind) => {
    const net = network(json(apiError(type), status));
    const error = await failureOf(provider(net).generate(REQUEST, { model: 'claude-opus-5-5' }));
    expect(error.kind).toBe(kind);
    expect(error.status).toBe(status);
    expect(error.message).not.toContain('provider detail');
  });

  it('maps a rate limit with its Retry-After', async () => {
    const net = network(json(apiError('rate_limit_error'), 429, { 'retry-after': '3' }));
    const error = await failureOf(provider(net).generate(REQUEST, { model: 'claude-opus-5-5' }));
    expect(error.kind).toBe('rate_limited');
    expect(error.retryAfterMs).toBe(3000);
  });

  it('maps a reached spend limit to quota, not to a retryable rate limit', async () => {
    const net = network(
      json(
        apiError('rate_limit_error', { details: { error_code: 'enforced_spend_limit_reached' } }),
        429,
      ),
    );
    expect(
      (await failureOf(provider(net).generate(REQUEST, { model: 'claude-opus-5-5' }))).kind,
    ).toBe('quota');
  });

  it('maps a timeout and a failed connection, without the SDK retrying', async () => {
    const slow = network('hang');
    const timedOut = await failureOf(
      provider(slow, 50).generate(REQUEST, { model: 'claude-opus-5-5' }),
    );
    expect(timedOut.kind).toBe('timeout');
    expect(slow.fetchImpl).toHaveBeenCalledTimes(1);

    const down = network(new TypeError('fetch failed'));
    const offline = await failureOf(provider(down).generate(REQUEST, { model: 'claude-opus-5-5' }));
    expect(offline.kind).toBe('network');
    expect(down.fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('OpenAI provider (Responses API)', () => {
  const response = (overrides: Record<string, unknown> = {}) => ({
    id: 'resp_1',
    object: 'response',
    status: 'completed',
    model: 'gpt-test-2026-10-01',
    output: [
      { type: 'reasoning', id: 'rs_1', summary: [] },
      {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: JSON.stringify(REPLY), annotations: [] }],
      },
    ],
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      total_tokens: 150,
      output_tokens_details: { reasoning_tokens: 20 },
    },
    ...overrides,
  });
  const provider = (net: ReturnType<typeof network>) =>
    createOpenAiProvider({ apiKey: KEY, timeoutMs: 5_000, fetchImpl: net.fetchImpl });

  it('sends a strict JSON-schema request with store disabled and parses the reply', async () => {
    const net = network(json(response()));
    const result = await provider(net).generate(REQUEST, { model: 'gpt-test' });

    expect(result).toEqual({
      output: REPLY,
      model: 'gpt-test-2026-10-01',
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
    });
    const [sent] = net.requests;
    expect(sent?.url).toBe('https://api.openai.com/v1/responses');
    keyNotInUrl(sent?.url ?? '');
    expect(sent?.headers.get('authorization')).toBe(`Bearer ${KEY}`);
    expect(sent?.body).toEqual({
      model: 'gpt-test',
      instructions: REQUEST.system,
      input: REQUEST.prompt,
      max_output_tokens: 16_000,
      store: false,
      text: {
        format: { type: 'json_schema', name: 'captions', schema: REQUEST.schema, strict: true },
      },
    });
  });

  it('records usage as unavailable, not zero, when it is missing', async () => {
    const net = network(json(response({ usage: undefined })));
    const result = await provider(net).generate(REQUEST, { model: 'gpt-test' });
    expect(result.usage).toEqual({ inputTokens: null, outputTokens: null, totalTokens: null });
  });

  it('treats a refusal item as refused', async () => {
    const net = network(
      json(
        response({
          output: [
            {
              type: 'message',
              content: [{ type: 'refusal', refusal: 'I cannot help with that.' }],
            },
          ],
        }),
      ),
    );
    expect((await failureOf(provider(net).generate(REQUEST, { model: 'gpt-test' }))).kind).toBe(
      'refused',
    );
  });

  it.each([
    ['max_output_tokens', 'truncated'],
    ['content_filter', 'refused'],
  ])('maps an incomplete response (%s) to %s', async (reason, kind) => {
    const net = network(json(response({ status: 'incomplete', incomplete_details: { reason } })));
    const error = await failureOf(provider(net).generate(REQUEST, { model: 'gpt-test' }));
    expect(error.kind).toBe(kind);
    expect(error.usage.totalTokens).toBe(150);
  });

  it('distinguishes an exhausted balance from a rate limit (both 429)', async () => {
    const quota = network(json({ error: { code: 'insufficient_quota', message: 'x' } }, 429));
    expect((await failureOf(provider(quota).generate(REQUEST, { model: 'gpt-test' }))).kind).toBe(
      'quota',
    );
    const limited = network(
      json({ error: { code: 'rate_limit_exceeded', message: 'x' } }, 429, { 'retry-after': '2' }),
    );
    const error = await failureOf(provider(limited).generate(REQUEST, { model: 'gpt-test' }));
    expect(error).toMatchObject({ kind: 'rate_limited', retryAfterMs: 2000 });
  });

  it.each([
    [401, 'auth'],
    [404, 'configuration'],
    [503, 'overloaded'],
    [500, 'unavailable'],
  ] as const)('maps HTTP %s to %s', async (status, kind) => {
    const net = network(json({ error: { message: 'detail' } }, status));
    expect((await failureOf(provider(net).generate(REQUEST, { model: 'gpt-test' }))).kind).toBe(
      kind,
    );
  });

  it('maps timeouts and connection failures, dropping their cause', async () => {
    const timeout = network(new DOMException('The operation timed out.', 'TimeoutError'));
    const timedOut = await failureOf(provider(timeout).generate(REQUEST, { model: 'gpt-test' }));
    expect(timedOut.kind).toBe('timeout');
    expect(timedOut.cause).toBeUndefined();

    const offline = network(new TypeError(`fetch failed https://api.openai.com?key=${KEY}`));
    const error = await failureOf(provider(offline).generate(REQUEST, { model: 'gpt-test' }));
    expect(error.kind).toBe('network');
    expect(error.message).not.toContain(KEY);
  });

  it('treats unreadable output as invalid', async () => {
    const net = network(
      json(
        response({ output: [{ type: 'message', content: [{ type: 'output_text', text: '{' }] }] }),
      ),
    );
    expect((await failureOf(provider(net).generate(REQUEST, { model: 'gpt-test' }))).kind).toBe(
      'invalid_output',
    );
  });
});

describe('Gemini provider (Interactions API)', () => {
  const interaction = (overrides: Record<string, unknown> = {}) => ({
    id: 'int_1',
    status: 'completed',
    steps: [
      { type: 'thought', status: 'done', content: [] },
      {
        type: 'model_output',
        status: 'done',
        content: [{ type: 'text', text: JSON.stringify(REPLY) }],
      },
    ],
    usage: {
      total_input_tokens: 90,
      total_output_tokens: 40,
      total_thought_tokens: 25,
      total_tokens: 155,
    },
    ...overrides,
  });
  const provider = (net: ReturnType<typeof network>) =>
    createGeminiProvider({ apiKey: KEY, timeoutMs: 5_000, fetchImpl: net.fetchImpl });

  it('sends the key in a header, requests JSON output and parses the model output step', async () => {
    const net = network(json(interaction()));
    const result = await provider(net).generate(REQUEST, { model: 'gemini-test' });

    expect(result).toEqual({
      output: REPLY,
      model: 'gemini-test',
      // Thinking tokens are reported separately and billed as output.
      usage: { inputTokens: 90, outputTokens: 65, totalTokens: 155 },
    });
    const [sent] = net.requests;
    expect(sent?.url).toBe('https://generativelanguage.googleapis.com/v1beta/interactions');
    keyNotInUrl(sent?.url ?? '');
    expect(sent?.headers.get('x-goog-api-key')).toBe(KEY);
    expect(sent?.headers.get('api-revision')).toBe('2026-05-20');
    expect(sent?.body).toEqual({
      model: 'gemini-test',
      system_instruction: REQUEST.system,
      input: REQUEST.prompt,
      generation_config: { max_output_tokens: 16_000 },
      response_format: { type: 'text', mime_type: 'application/json', schema: REQUEST.schema },
      store: false,
    });
  });

  it('treats a completed interaction without text as blocked (refused)', async () => {
    const net = network(json(interaction({ steps: [] })));
    expect((await failureOf(provider(net).generate(REQUEST, { model: 'gemini-test' }))).kind).toBe(
      'refused',
    );
  });

  it('treats an incomplete interaction as truncated', async () => {
    const net = network(json(interaction({ status: 'incomplete' })));
    expect((await failureOf(provider(net).generate(REQUEST, { model: 'gemini-test' }))).kind).toBe(
      'truncated',
    );
  });

  it.each([
    [403, 'auth'],
    [429, 'rate_limited'],
    [503, 'overloaded'],
    [500, 'unavailable'],
  ] as const)('maps HTTP %s to %s', async (status, kind) => {
    const net = network(json({ error: { code: 'x', message: 'detail' } }, status));
    expect((await failureOf(provider(net).generate(REQUEST, { model: 'gemini-test' }))).kind).toBe(
      kind,
    );
  });

  it('records missing usage as unavailable', async () => {
    const net = network(json(interaction({ usage: undefined })));
    expect((await provider(net).generate(REQUEST, { model: 'gemini-test' })).usage).toEqual({
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
    });
  });
});

describe('Retry-After parsing', () => {
  it('reads seconds and HTTP dates, and ignores anything else', () => {
    const now = Date.parse('2026-11-20T10:00:00Z');
    expect(retryAfterMs('2', now)).toBe(2000);
    expect(retryAfterMs('Fri, 20 Nov 2026 10:00:05 GMT', now)).toBe(5000);
    expect(retryAfterMs(null, now)).toBeNull();
    expect(retryAfterMs('soon', now)).toBeNull();
  });
});
