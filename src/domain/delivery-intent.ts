import type { DeliveryJob, RetryTransitionInput } from "./contracts.js";

export const DELIVERY_INTENT_LEASE_MS = 5 * 60_000;
export const EVENT_BUSY_RETRY_MS = 1_000;

export function canonicalDeliveryJobKey(job: DeliveryJob): string {
  return `${job.cycleId ?? job.mode}-${job.eventId}-attempt-${job.attemptNumber ?? 1}`;
}

export function assertRetryTransitionIdentity(input: RetryTransitionInput): void {
  if (input.job.eventId !== input.eventId || input.audit.eventId !== input.eventId) {
    throw new Error("Retry transition event identities do not match");
  }
  const expectedJobKey = canonicalDeliveryJobKey(input.job);
  if (input.jobKey !== expectedJobKey) throw new Error(`Retry transition job key must be ${expectedJobKey}`);
  if (input.audit.action !== "delivery.retry_scheduled") {
    throw new Error("Retry transition requires a delivery.retry_scheduled audit action");
  }
}

export function sameDeliveryJob(left: DeliveryJob, right: DeliveryJob): boolean {
  return left.eventId === right.eventId
    && left.mode === right.mode
    && (left.cycleId ?? left.mode) === (right.cycleId ?? right.mode)
    && (left.attemptNumber ?? 1) === (right.attemptNumber ?? 1)
    && (left.destinationUrl ?? null) === (right.destinationUrl ?? null)
    && (left.actor ?? null) === (right.actor ?? null)
    && (left.reason ?? null) === (right.reason ?? null);
}
