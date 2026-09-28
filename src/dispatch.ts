import type { DeliveryJob, DeliveryQueue, Store } from "./domain/contracts.js";
import type { DeliveryIntent } from "./domain/types.js";

const DISPATCH_LEASE_MS = 5 * 60_000;

interface ScheduleOptions {
  store: Store;
  queue: DeliveryQueue;
  job: DeliveryJob;
  jobKey: string;
  delayMs?: number;
  now?: Date;
}

export async function scheduleDelivery({
  store,
  queue,
  job,
  jobKey,
  delayMs = 0,
  now = new Date(),
}: ScheduleOptions): Promise<{ created: boolean; dispatched: boolean; intent: DeliveryIntent }> {
  const availableAt = new Date(now.getTime() + Math.max(0, delayMs)).toISOString();
  const result = await store.createDeliveryIntent(jobKey, job, availableAt);
  const dispatched = result.intent.state === "completed"
    ? false
    : await dispatchDeliveryIntent(store, queue, result.intent, now);
  return { ...result, dispatched };
}

export async function dispatchReadyIntents(
  store: Store,
  queue: DeliveryQueue,
  now = new Date(),
): Promise<{ dispatched: number; failed: number }> {
  const staleBefore = new Date(now.getTime() - DISPATCH_LEASE_MS).toISOString();
  const intents = await store.listDispatchableIntents(now.toISOString(), staleBefore);
  let dispatched = 0;
  let failed = 0;
  for (const intent of intents) {
    try {
      if (await dispatchDeliveryIntent(store, queue, intent, now)) dispatched += 1;
    } catch (error) {
      failed += 1;
      console.error(JSON.stringify({
        event: "delivery_intent.dispatch_failed",
        intentId: intent.id,
        jobKey: intent.jobKey,
        error: error instanceof Error ? error.message : "Unknown dispatch error",
      }));
    }
  }
  return { dispatched, failed };
}

export function deliveryJobKey(job: DeliveryJob): string {
  const cycleId = job.cycleId ?? job.mode;
  const attemptNumber = job.attemptNumber ?? 1;
  return `${cycleId}-${job.eventId}-attempt-${attemptNumber}`;
}

export async function dispatchDeliveryIntent(
  store: Store,
  queue: DeliveryQueue,
  intent: DeliveryIntent,
  now: Date,
): Promise<boolean> {
  const dispatchedAt = now.toISOString();
  const staleBefore = new Date(now.getTime() - DISPATCH_LEASE_MS).toISOString();
  const prepared = await store.prepareDeliveryIntentDispatch(intent.id, dispatchedAt, staleBefore);
  if (!prepared) return false;
  const delayMs = Math.max(0, Date.parse(intent.availableAt) - now.getTime());
  try {
    await queue.enqueue(intent.job, { jobId: intent.jobKey, delayMs });
    return true;
  } catch (error) {
    await store.releaseDeliveryIntent(intent.id, dispatchedAt);
    throw error;
  }
}
