export interface RetryPolicy {
  baseDelayMs: number;
  maxDelayMs: number;
  jitterRatio: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  baseDelayMs: 1_000,
  maxDelayMs: 60_000,
  jitterRatio: 0.2,
};

export const MAX_RETRY_AFTER_MS = 15 * 60_000;

export interface RetryPlan {
  delayMs: number;
  source: "backoff" | "retry-after";
  receiverDelayMs: number | null;
}

export function retryDelayMs(
  attemptNumber: number,
  policy = DEFAULT_RETRY_POLICY,
  random = Math.random,
): number {
  const exponential = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** Math.max(0, attemptNumber - 1));
  const jitter = exponential * policy.jitterRatio * (random() * 2 - 1);
  return Math.max(0, Math.round(exponential + jitter));
}

export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

export function parseRetryAfter(
  value: string | null | undefined,
  nowMs: number,
  maximumMs = MAX_RETRY_AFTER_MS,
): number | null {
  const normalized = value?.trim();
  if (!normalized) return null;
  if (/^\d+$/.test(normalized)) {
    return Math.min(maximumMs, Number(normalized) * 1_000);
  }
  if (/^[\d.+-]+$/.test(normalized)) return null;
  const dateMs = Date.parse(normalized);
  if (!Number.isFinite(dateMs)) return null;
  return Math.min(maximumMs, Math.max(0, dateMs - nowMs));
}

export function planRetry(
  attemptNumber: number,
  retryAfter: string | null | undefined,
  nowMs: number,
  policy = DEFAULT_RETRY_POLICY,
  random = Math.random,
): RetryPlan {
  const backoffMs = retryDelayMs(attemptNumber, policy, random);
  const receiverDelayMs = parseRetryAfter(retryAfter, nowMs);
  const delayMs = Math.max(backoffMs, receiverDelayMs ?? 0);
  return {
    delayMs,
    source: receiverDelayMs !== null && receiverDelayMs >= backoffMs ? "retry-after" : "backoff",
    receiverDelayMs,
  };
}
