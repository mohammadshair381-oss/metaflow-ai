import {
  AiProviderError,
  type AiGenerationRequest,
  type AiGenerationResult,
  type AiProvider,
} from './ai-provider';

/**
 * One retry at most, and only when it is safe: the provider failed fast and said, by the
 * kind of failure, that it did not produce the answer (overloaded, a server error, a dropped
 * connection, or a rate limit with a short Retry-After). Never after a timeout (the provider
 * may still be generating, and billing, the first attempt), and never for configuration,
 * quota, refusal or invalid-output failures, which would fail the same way again.
 */
export const RETRY_POLICY = {
  maxAttempts: 2,
  /** Only failures faster than this are retried, so a retry cannot double a long wait. */
  fastFailureMs: 10_000,
  /** Longest wait before the retry, including a provider's Retry-After. */
  maxWaitMs: 4_000,
  defaultWaitMs: 1_000,
} as const;

const RETRYABLE: ReadonlySet<string> = new Set(['overloaded', 'unavailable', 'network']);

export function isSafeToRetry(error: AiProviderError, elapsedMs: number): boolean {
  if (elapsedMs > RETRY_POLICY.fastFailureMs) return false;
  if (RETRYABLE.has(error.kind))
    return error.retryAfterMs === null || error.retryAfterMs <= RETRY_POLICY.maxWaitMs;
  if (error.kind === 'rate_limited') {
    return error.retryAfterMs !== null && error.retryAfterMs <= RETRY_POLICY.maxWaitMs;
  }
  return false;
}

const sleepFor = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function generateWithSafeRetry(
  provider: AiProvider,
  request: AiGenerationRequest,
  options: { model: string },
  {
    sleep = sleepFor,
    clock = Date.now,
  }: { sleep?: (ms: number) => Promise<void>; clock?: () => number } = {},
): Promise<AiGenerationResult> {
  for (let attempt = 1; ; attempt += 1) {
    const started = clock();
    try {
      return await provider.generate(request, options);
    } catch (error) {
      const retry =
        error instanceof AiProviderError &&
        attempt < RETRY_POLICY.maxAttempts &&
        isSafeToRetry(error, clock() - started);
      if (!retry) throw error;
      await sleep(
        Math.min(error.retryAfterMs ?? RETRY_POLICY.defaultWaitMs, RETRY_POLICY.maxWaitMs),
      );
    }
  }
}
