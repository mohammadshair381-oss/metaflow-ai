import { describe, expect, it, vi } from 'vitest';
import { EnvValidationError, parseEnv } from '../src/config/env';
import {
  AiProviderError,
  type AiErrorKind,
  type AiGenerationResult,
  type AiProvider,
} from '../src/integrations/ai/ai-provider';
import { RETRY_POLICY, generateWithSafeRetry } from '../src/integrations/ai/ai-retry';
import { estimateCostUsd } from '../src/services/ai-studio.service';

const RESULT: AiGenerationResult = {
  output: { ok: true },
  usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
  model: 'm',
};
const REQUEST = { system: 's', prompt: 'p', schemaName: 'x', schema: {}, maxOutputTokens: 100 };

/** A provider that fails with the given errors, then succeeds. */
function flaky(...errors: AiProviderError[]) {
  const generate = vi.fn(() => {
    const error = errors.shift();
    return error ? Promise.reject(error) : Promise.resolve(RESULT);
  });
  const provider: AiProvider = { id: 'anthropic', generate };
  return { provider, generate };
}

describe('safe retry policy', () => {
  const run = (provider: AiProvider, elapsedPerCall = 0) => {
    const sleep = vi.fn(() => Promise.resolve());
    let time = 0;
    const clock = () => (time += elapsedPerCall);
    return {
      promise: generateWithSafeRetry(provider, REQUEST, { model: 'm' }, { sleep, clock }),
      sleep,
    };
  };

  it.each(['overloaded', 'unavailable', 'network'] as AiErrorKind[])(
    'retries once after a fast %s failure',
    async (kind) => {
      const { provider, generate } = flaky(new AiProviderError(kind));
      const { promise, sleep } = run(provider);
      expect(await promise).toBe(RESULT);
      expect(generate).toHaveBeenCalledTimes(2);
      expect(sleep).toHaveBeenCalledWith(RETRY_POLICY.defaultWaitMs);
    },
  );

  it('retries a rate limit only when the provider names a short wait, and waits that long', async () => {
    const short = flaky(new AiProviderError('rate_limited', { retryAfterMs: 1500 }));
    const first = run(short.provider);
    await first.promise;
    expect(first.sleep).toHaveBeenCalledWith(1500);

    for (const retryAfterMs of [null, 30_000]) {
      const { provider, generate } = flaky(new AiProviderError('rate_limited', { retryAfterMs }));
      await expect(run(provider).promise).rejects.toMatchObject({ kind: 'rate_limited' });
      expect(generate).toHaveBeenCalledTimes(1);
    }
  });

  it.each([
    'timeout',
    'auth',
    'configuration',
    'quota',
    'refused',
    'truncated',
    'invalid_output',
  ] as AiErrorKind[])('never retries %s', async (kind) => {
    const { provider, generate } = flaky(new AiProviderError(kind));
    await expect(run(provider).promise).rejects.toMatchObject({ kind });
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('does not retry a slow failure, so a retry cannot double a long wait', async () => {
    const { provider, generate } = flaky(new AiProviderError('overloaded'));
    await expect(run(provider, RETRY_POLICY.fastFailureMs + 1).promise).rejects.toMatchObject({
      kind: 'overloaded',
    });
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('gives up after the second attempt', async () => {
    const { provider, generate } = flaky(
      new AiProviderError('overloaded'),
      new AiProviderError('overloaded'),
    );
    await expect(run(provider).promise).rejects.toMatchObject({ kind: 'overloaded' });
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it('passes other errors through untouched', async () => {
    const bug = new TypeError('programming error');
    const provider: AiProvider = { id: 'openai', generate: () => Promise.reject(bug) };
    await expect(run(provider).promise).rejects.toBe(bug);
  });
});

describe('AI configuration', () => {
  const AI = {
    AI_PROVIDER: 'anthropic',
    AI_MODEL: 'claude-opus-5-5',
    AI_API_KEY: 'test-secret-key',
  };
  const issuesOf = (source: NodeJS.ProcessEnv) => {
    try {
      parseEnv(source);
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      return (error as EnvValidationError).issues;
    }
    throw new Error('Expected parseEnv to throw');
  };

  it('is off, and the app still starts, when nothing is set', () => {
    expect(parseEnv({}).AI).toBeNull();
  });

  it('accepts a complete configuration, with or without pricing', () => {
    expect(parseEnv({ ...AI, AI_PROVIDER: ' Anthropic ' }).AI).toEqual({
      provider: 'anthropic',
      model: 'claude-opus-5-5',
      apiKey: 'test-secret-key',
      pricing: null,
    });
    expect(
      parseEnv({ ...AI, AI_PRICE_INPUT_PER_MTOK_USD: '4', AI_PRICE_OUTPUT_PER_MTOK_USD: '20' }).AI
        ?.pricing,
    ).toEqual({ inputPerMillionTokensUsd: 4, outputPerMillionTokensUsd: 20 });
  });

  it('fails on a partial configuration and never prints the key', () => {
    const issues = issuesOf({ AI_API_KEY: 'test-secret-key' });
    expect(issues).toEqual([
      'AI_PROVIDER: is required when AI generation is configured',
      'AI_MODEL: is required when AI generation is configured',
    ]);
    expect(issues.join(' ')).not.toContain('test-secret-key');
  });

  it.each([
    [{ AI_PROVIDER: 'mistral' }, /^AI_PROVIDER:/],
    [{ AI_MODEL: 'claude opus' }, /^AI_MODEL:/],
    [{ AI_API_KEY: 'two words' }, /^AI_API_KEY:/],
    [{ AI_PRICE_INPUT_PER_MTOK_USD: '4' }, /set both prices, or neither/],
    [{ AI_PRICE_INPUT_PER_MTOK_USD: '-1', AI_PRICE_OUTPUT_PER_MTOK_USD: '1' }, /^AI_PRICE_INPUT/],
  ])('rejects an invalid setting %o', (override, pattern) => {
    const issues = issuesOf({ ...AI, ...override });
    expect(issues.some((issue) => pattern.test(issue))).toBe(true);
  });

  it('rejects pricing without a provider', () => {
    expect(
      issuesOf({ AI_PRICE_INPUT_PER_MTOK_USD: '4', AI_PRICE_OUTPUT_PER_MTOK_USD: '20' }),
    ).toEqual(['AI_PRICE_*: pricing is set but AI generation is not configured']);
  });
});

describe('cost estimates', () => {
  const pricing = { inputPerMillionTokensUsd: 4, outputPerMillionTokensUsd: 20 };
  const usage = { inputTokens: 1_000, outputTokens: 500, totalTokens: 1_500 };

  it('multiplies reported tokens by the configured prices', () => {
    expect(estimateCostUsd(pricing, usage, 'claude-opus-5-5', 'claude-opus-5-5')).toBe(0.014);
    // A dated snapshot of the configured model is the same model.
    expect(estimateCostUsd(pricing, usage, 'gpt-test', 'gpt-test-2026-10-01')).toBe(0.014);
  });

  it('gives no estimate rather than a wrong one', () => {
    expect(estimateCostUsd(null, usage, 'm', 'm')).toBeNull();
    expect(estimateCostUsd(pricing, { ...usage, outputTokens: null }, 'm', 'm')).toBeNull();
    // A different model than the configured one has different prices.
    expect(estimateCostUsd(pricing, usage, 'claude-opus-5-5', 'claude-opus-4-8')).toBeNull();
  });
});
