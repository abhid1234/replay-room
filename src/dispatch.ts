import type { DeliveryJob, DeliveryQueue, Store } from "./domain/contracts.js";
import { canonicalDeliveryJobKey } from "./domain/delivery-intent.js";
import type { DeliveryIntent } from "./domain/types.js";

interface ScheduleOptions {
  store: Store;
  queue: DeliveryQueue;
  job: DeliveryJob;
  jobKey: string;
  delayMs?: number;
}

export async function scheduleDelivery({
  store,
  queue,
  job,
  jobKey,
  delayMs = 0,
}: ScheduleOptions): Promise<{ created: boolean; dispatched: boolean; intent: DeliveryIntent }> {
  const result = await store.createDeliveryIntent(jobKey, job, { delayMs: Math.max(0, delayMs) });
  const dispatched = result.intent.state === "completed"
    ? false
    : await dispatchDeliveryIntent(store, queue, result.intent);
  return { ...result, dispatched };
}

export async function dispatchReadyIntents(
  store: Store,
  queue: DeliveryQueue,
): Promise<{ dispatched: number; failed: number }> {
  const intents = await store.listDispatchableIntents();
  let dispatched = 0;
  let failed = 0;
  for (const intent of intents) {
    try {
      if (await dispatchDeliveryIntent(store, queue, intent)) dispatched += 1;
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
  return canonicalDeliveryJobKey(job);
}

export async function dispatchDeliveryIntent(
  store: Store,
  queue: DeliveryQueue,
  intent: DeliveryIntent,
): Promise<boolean> {
  const prepared = await store.prepareDeliveryIntentDispatch(intent.id);
  if (!prepared) return false;
  try {
    await queue.enqueue(intent.job, { jobId: intent.jobKey, delayMs: prepared.delayMs });
    return true;
  } catch (error) {
    await store.releaseDeliveryIntent(intent.id, prepared.dispatchedAt);
    throw error;
  }
}
