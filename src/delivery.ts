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
  requireIntent?: boolean;
}

export async function deliver(job: DeliveryJob, deps: DeliveryDependencies): Promise<DeliveryResult> {
  if (deps.requireIntent && !job.intentId) throw new Error("Production delivery jobs require a durable intent");
  const now = deps.now ?? Date.now;
  let claimedJob = job;
  let claimProcessingAt: string | undefined;
  if (job.intentId) {
    const claim = await deps.store.claimDeliveryIntent(job.intentId);
    if (claim.status === "deferred") {
      const current = await deps.store.getEvent(claim.intent.eventId);
      if (!current) throw new Error(`Event ${claim.intent.eventId} does not exist`);
      if (current.status === "delivered") {
        await deps.store.completeDeliveryIntent(claim.intent.id, new Date(now()).toISOString());
        return { delivered: true, terminal: true, nextStatus: "delivered", retryDelayMs: null };
      }
      return {
        delivered: false,
        terminal: false,
        nextStatus: current.status,
        retryDelayMs: claim.delayMs,
        deferredUntil: claim.retryAt,
      };
    }
    if (claim.status === "unavailable") {
      const current = await deps.store.getEvent(job.eventId);
      if (!current) throw new Error(`Event ${job.eventId} does not exist`);
      return { delivered: current.status === "delivered", terminal: true, nextStatus: current.status, retryDelayMs: null };
    }
    claimedJob = claim.intent.job;
    claimProcessingAt = claim.intent.processingAt ?? undefined;
    if (!claimProcessingAt) throw new Error(`Delivery intent ${claim.intent.id} has no processing claim`);
  }

  try {
    return await deliverClaimed(claimedJob, deps, now, claimProcessingAt);
  } catch (error) {
    if (job.intentId && claimProcessingAt) await deps.store.releaseDeliveryIntentClaim(job.intentId, claimProcessingAt);
    throw error;
  }
}

async function deliverClaimed(
  job: DeliveryJob,
  deps: DeliveryDependencies,
  now: () => number,
  claimProcessingAt?: string,
): Promise<DeliveryResult> {
  const detail = await deps.store.getEvent(job.eventId);
  if (!detail) throw new Error(`Event ${job.eventId} does not exist`);

  if (job.mode !== "rehearsal" && detail.status === "delivered") {
    await completeIntent(job, deps.store, now(), claimProcessingAt);
    return { delivered: true, terminal: true, nextStatus: "delivered", retryDelayMs: null };
  }

  const destinationInput = job.destinationUrl ?? detail.endpoint.destinationUrl;
  let destination = safeDestinationLabel(destinationInput);
  const postFn = deps.postFn ?? postPinnedDestination;
  const timeoutMs = deps.timeoutMs ?? 10_000;
  const nextAttempt = detail.attemptCount + 1;
  const deliveryAttempt = job.attemptNumber ?? nextAttempt;
  const startedAt = now();

  if (job.mode !== "rehearsal") {
    const began = await deps.store.beginDeliveryAttempt(
      detail.id,
      nextAttempt,
      job.intentId,
      claimProcessingAt,
    );
    if (!began) {
      const current = await deps.store.getEvent(detail.id);
      if (current?.status === "delivered") {
        await completeIntent(job, deps.store, now(), claimProcessingAt);
        return { delivered: true, terminal: true, nextStatus: "delivered", retryDelayMs: null };
      }
      throw new Error(`Delivery intent ${job.intentId ?? "direct"} lost its processing claim`);
    }
  }

  let statusCode: number | null = null;
  let responseBody: string | null = null;
  let retryAfter: string | null = null;
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
    retryAfter = response.retryAfter;
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
    await completeIntent(job, deps.store, now(), claimProcessingAt);
    return { delivered: successful, terminal: true, nextStatus: detail.status, retryDelayMs: null };
  }

  if (successful) {
    const outcome = await deps.store.commitDeliveryOutcome({
      eventId: detail.id,
      status: "delivered",
      lastError: null,
      ...(job.intentId ? { currentIntentId: job.intentId } : {}),
      ...(claimProcessingAt ? { currentIntentProcessingAt: claimProcessingAt } : {}),
      completedAt: new Date(now()).toISOString(),
      audit: {
        eventId: detail.id,
        action: job.mode === "replay" ? "replay.delivered" : "delivery.succeeded",
        actor: job.actor ?? "worker",
        reason: job.reason ?? null,
        metadata: { destination, statusCode, attempt: nextAttempt, durationMs },
      },
    });
    return { delivered: outcome.nextStatus === "delivered", terminal: true, nextStatus: outcome.nextStatus, retryDelayMs: null };
  }

  const retryable = !unsafeDestination && (statusCode === null || isRetryableStatus(statusCode));
  const terminal = !retryable || deliveryAttempt >= detail.endpoint.maxAttempts;
  const lastError = errorMessage ?? `Destination returned HTTP ${statusCode}`;
  if (terminal) {
    const outcome = await deps.store.commitDeliveryOutcome({
      eventId: detail.id,
      status: "dead_letter",
      lastError,
      ...(job.intentId ? { currentIntentId: job.intentId } : {}),
      ...(claimProcessingAt ? { currentIntentProcessingAt: claimProcessingAt } : {}),
      completedAt: new Date(now()).toISOString(),
      audit: {
        eventId: detail.id,
        action: "delivery.dead_lettered",
        actor: "worker",
        reason: lastError,
        metadata: { destination, statusCode, attempt: nextAttempt, deliveryAttempt },
      },
    });
    return { delivered: outcome.nextStatus === "delivered", terminal: true, nextStatus: outcome.nextStatus, retryDelayMs: null };
  }

  const backoffMs = retryDelayMs(deliveryAttempt);
  const { intentId: _completedIntentId, ...retryableJob } = job;
  const retryJob: DeliveryJob = {
    ...retryableJob,
    cycleId: job.cycleId ?? job.mode,
    attemptNumber: deliveryAttempt + 1,
    eventId: detail.id,
  };
  const nextIntent = await deps.store.commitRetryTransition({
    eventId: detail.id,
    jobKey: deliveryJobKey(retryJob),
    job: retryJob,
    backoffMs,
    retryAfter,
    ...(job.intentId ? { currentIntentId: job.intentId } : {}),
    ...(claimProcessingAt ? { currentIntentProcessingAt: claimProcessingAt } : {}),
    completedAt: new Date(now()).toISOString(),
    lastError,
    audit: {
      eventId: detail.id,
      action: "delivery.retry_scheduled",
      actor: "worker",
      reason: lastError,
      metadata: {
        destination,
        statusCode,
        deliveryAttempt,
        nextAttempt: deliveryAttempt + 1,
      },
    },
  });
  if (!nextIntent.scheduled) {
    return {
      delivered: nextIntent.nextStatus === "delivered",
      terminal: true,
      nextStatus: nextIntent.nextStatus,
      retryDelayMs: null,
    };
  }
  try {
    await dispatchDeliveryIntent(deps.store, deps.queue, nextIntent.intent);
  } catch (error) {
    console.error(JSON.stringify({
      event: "delivery_retry.dispatch_deferred",
      intentId: nextIntent.intent.id,
      eventId: detail.id,
      error: error instanceof Error ? error.message : "Unknown dispatch error",
    }));
  }
  return { delivered: false, terminal: false, nextStatus: "retrying", retryDelayMs: nextIntent.delayMs };
}

async function completeIntent(job: DeliveryJob, store: Store, nowMs: number, processingAt?: string): Promise<void> {
  if (!job.intentId) return;
  const completed = await store.completeDeliveryIntent(job.intentId, new Date(nowMs).toISOString(), processingAt);
  if (processingAt && !completed) throw new Error(`Delivery intent ${job.intentId} lost its processing claim`);
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
