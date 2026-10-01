import type { DeliveryJob, DeliveryQueue, DeliveryResult, Store } from "./domain/contracts.js";
import { isRetryableStatus, retryDelayMs } from "./domain/retry.js";
import { resolveSafeDestination, type DestinationLookup, signWebhookPayload, UnsafeDestinationError } from "./domain/security.js";
import { deliveryJobKey, dispatchDeliveryIntent } from "./dispatch.js";
import { postPinnedDestination, type DestinationPost } from "./outbound-http.js";

interface DeliveryDependencies {
  store: Store;
  queue: DeliveryQueue;
  allowPrivateTargets: boolean;
  postFn?: DestinationPost;
  lookupFn?: DestinationLookup;
  now?: () => number;
  timeoutMs?: number;
}

export async function deliver(job: DeliveryJob, deps: DeliveryDependencies): Promise<DeliveryResult> {
  const now = deps.now ?? Date.now;
  const processingAt = new Date(now()).toISOString();
  if (job.intentId) {
    const claimed = await deps.store.claimDeliveryIntent(job.intentId, processingAt);
    if (!claimed) {
      const current = await deps.store.getEvent(job.eventId);
      if (!current) throw new Error(`Event ${job.eventId} does not exist`);
      return { delivered: current.status === "delivered", terminal: true, nextStatus: current.status, retryDelayMs: null };
    }
  }

  try {
    return await deliverClaimed(job, deps, now);
  } catch (error) {
    if (job.intentId) await deps.store.releaseDeliveryIntentClaim(job.intentId, processingAt);
    throw error;
  }
}

async function deliverClaimed(
  job: DeliveryJob,
  deps: DeliveryDependencies,
  now: () => number,
): Promise<DeliveryResult> {
  const detail = await deps.store.getEvent(job.eventId);
  if (!detail) throw new Error(`Event ${job.eventId} does not exist`);

  const destinationInput = job.destinationUrl ?? detail.endpoint.destinationUrl;
  let destination = safeDestinationLabel(destinationInput);
  const postFn = deps.postFn ?? postPinnedDestination;
  const timeoutMs = deps.timeoutMs ?? 10_000;
  const nextAttempt = detail.attemptCount + 1;
  const deliveryAttempt = job.attemptNumber ?? nextAttempt;
  const startedAt = now();

  if (job.mode !== "rehearsal") {
    await deps.store.updateEvent(detail.id, { status: "delivering", attemptCount: nextAttempt, lastError: null });
  }

  let statusCode: number | null = null;
  let responseBody: string | null = null;
  let errorMessage: string | null = null;
  let unsafeDestination = false;
  const body = JSON.stringify(detail.payload);
  const signatureHeaders = detail.endpoint.signingSecret && detail.endpoint.signatureProfile !== "none"
    ? signWebhookPayload(detail.endpoint.signatureProfile, detail.endpoint.signingSecret, body, startedAt)
    : {};

  try {
    const networkStartedAt = performance.now();
    const resolutionController = new AbortController();
    const resolved = await withTimeout(
      resolveSafeDestination(destinationInput, deps.allowPrivateTargets, deps.lookupFn, resolutionController.signal),
      timeoutMs,
      `Destination resolution timed out after ${timeoutMs}ms`,
      () => resolutionController.abort(),
    );
    destination = resolved.url.toString();
    const remainingTimeoutMs = Math.max(1, timeoutMs - Math.ceil(performance.now() - networkStartedAt));
    const response = await postFn({
      destination: resolved,
      headers: {
        "content-type": "application/json",
        "user-agent": "Replay-Room/0.1",
        "x-replay-room-event": detail.id,
        "x-replay-room-mode": job.mode,
        ...(detail.idempotencyKey ? { "idempotency-key": detail.idempotencyKey } : {}),
        ...signatureHeaders,
      },
      body,
      timeoutMs: remainingTimeoutMs,
    });
    statusCode = response.status;
    responseBody = response.body;
  } catch (error) {
    unsafeDestination = error instanceof UnsafeDestinationError;
    errorMessage = error instanceof Error ? error.message : "Unknown delivery error";
  }

  const durationMs = Math.max(0, now() - startedAt);
  await deps.store.addAttempt({
    eventId: detail.id,
    mode: job.mode,
    destinationUrl: destination,
    statusCode,
    responseBody,
    error: errorMessage,
    durationMs,
  });

  const successful = statusCode !== null && statusCode >= 200 && statusCode < 300;
  if (job.mode === "rehearsal") {
    await deps.store.addRehearsal({
      eventId: detail.id,
      payloadSha256: detail.payloadSha256,
      destinationUrl: destination,
      passed: successful,
      statusCode,
      notes: successful ? "The rehearsal endpoint accepted the original payload." : errorMessage ?? `HTTP ${statusCode}`,
    });
    await deps.store.addAudit({
      eventId: detail.id,
      action: successful ? "rehearsal.passed" : "rehearsal.failed",
      actor: job.actor ?? "system",
      reason: job.reason ?? null,
      metadata: { destination, statusCode, durationMs },
    });
    await completeIntent(job, deps.store, now());
    return { delivered: successful, terminal: true, nextStatus: detail.status, retryDelayMs: null };
  }

  if (successful) {
    await deps.store.updateEvent(detail.id, { status: "delivered", lastError: null });
    await deps.store.addAudit({
      eventId: detail.id,
      action: job.mode === "replay" ? "replay.delivered" : "delivery.succeeded",
      actor: job.actor ?? "worker",
      reason: job.reason ?? null,
      metadata: { destination, statusCode, attempt: nextAttempt, durationMs },
    });
    await completeIntent(job, deps.store, now());
    return { delivered: true, terminal: true, nextStatus: "delivered", retryDelayMs: null };
  }

  const retryable = !unsafeDestination && (statusCode === null || isRetryableStatus(statusCode));
  const terminal = !retryable || deliveryAttempt >= detail.endpoint.maxAttempts;
  const lastError = errorMessage ?? `Destination returned HTTP ${statusCode}`;
  if (terminal) {
    await deps.store.updateEvent(detail.id, { status: "dead_letter", lastError });
    await deps.store.addAudit({
      eventId: detail.id,
      action: "delivery.dead_lettered",
      actor: "worker",
      reason: lastError,
      metadata: { destination, statusCode, attempt: nextAttempt, deliveryAttempt },
    });
    await completeIntent(job, deps.store, now());
    return { delivered: false, terminal: true, nextStatus: "dead_letter", retryDelayMs: null };
  }

  const delayMs = retryDelayMs(deliveryAttempt);
  const { intentId: _completedIntentId, ...retryableJob } = job;
  const retryJob: DeliveryJob = {
    ...retryableJob,
    cycleId: job.cycleId ?? job.mode,
    attemptNumber: deliveryAttempt + 1,
    eventId: detail.id,
  };
  const availableAt = new Date(now() + delayMs).toISOString();
  const nextIntent = await deps.store.createDeliveryIntent(deliveryJobKey(retryJob), retryJob, availableAt);
  try {
    await dispatchDeliveryIntent(deps.store, deps.queue, nextIntent.intent, new Date(now()));
  } catch (error) {
    console.error(JSON.stringify({
      event: "delivery_retry.dispatch_deferred",
      intentId: nextIntent.intent.id,
      eventId: detail.id,
      error: error instanceof Error ? error.message : "Unknown dispatch error",
    }));
  }
  await deps.store.updateEvent(detail.id, { status: "retrying", lastError });
  await completeIntent(job, deps.store, now());
  return { delivered: false, terminal: false, nextStatus: "retrying", retryDelayMs: delayMs };
}

async function completeIntent(job: DeliveryJob, store: Store, nowMs: number): Promise<void> {
  if (job.intentId) await store.completeDeliveryIntent(job.intentId, new Date(nowMs).toISOString());
}

function safeDestinationLabel(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    url.username = "";
    url.password = "";
    return url.toString();
  } catch {
    return "[invalid destination]";
  }
}

async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  message: string,
  onTimeout?: () => void,
): Promise<T> {
  let deadline: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    deadline = setTimeout(() => {
      reject(new Error(message));
      onTimeout?.();
    }, timeoutMs);
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (deadline) clearTimeout(deadline);
  }
}
