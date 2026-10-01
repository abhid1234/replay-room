import { randomUUID } from "node:crypto";
import type { CreateEventInput, CreateEventResult, DeliveryIntentSchedule, DeliveryJob, DeliveryOutcomeInput, RetryTransitionInput, Store } from "../src/domain/contracts.js";
import { assertRetryTransitionIdentity, DELIVERY_INTENT_LEASE_MS, EVENT_BUSY_RETRY_MS, sameDeliveryJob } from "../src/domain/delivery-intent.js";
import { deliveryRate, reliabilityState } from "../src/domain/reliability.js";
import { parseRetryAfter } from "../src/domain/retry.js";
import type { AuditEntry, DashboardStats, DeliveryAttempt, DeliveryIntent, Endpoint, EndpointReliability, EventDetail, Rehearsal, WebhookEvent } from "../src/domain/types.js";

export class FakeStore implements Store {
  now: () => number = Date.now;
  endpoint: Endpoint = {
    id: randomUUID(), name: "Test", ingestKey: "hook_test_123456", destinationUrl: "https://example.com/hook",
    signingSecret: null, signatureProfile: "none", maxAttempts: 3, createdAt: new Date().toISOString(),
  };
  events = new Map<string, WebhookEvent>();
  attempts: DeliveryAttempt[] = [];
  rehearsals: Rehearsal[] = [];
  audit: AuditEntry[] = [];
  intents = new Map<string, DeliveryIntent>();

  async ping() {}
  async createEndpoint(input: Omit<Endpoint, "id" | "createdAt">) { this.endpoint = { ...input, id: randomUUID(), createdAt: new Date().toISOString() }; return this.endpoint; }
  async getEndpointByIngestKey(key: string) { return key === this.endpoint.ingestKey ? this.endpoint : null; }
  async listEndpoints() { return [this.endpoint]; }
  async endpointReliability(windowHours: number): Promise<EndpointReliability[]> {
    const events = [...this.events.values()].filter((event) => event.endpointId === this.endpoint.id);
    const total = events.length;
    const delivered = events.filter((event) => event.status === "delivered").length;
    const retrying = events.filter((event) => event.status === "retrying").length;
    const deadLetter = events.filter((event) => event.status === "dead_letter").length;
    const successfulLatencies = this.attempts
      .filter((attempt) => attempt.mode !== "rehearsal" && attempt.statusCode !== null && attempt.statusCode >= 200 && attempt.statusCode < 300)
      .map((attempt) => attempt.durationMs)
      .sort((left, right) => left - right);
    const p95Index = Math.max(0, Math.ceil(successfulLatencies.length * 0.95) - 1);
    return [{
      endpointId: this.endpoint.id,
      name: this.endpoint.name,
      destinationUrl: this.endpoint.destinationUrl,
      windowHours,
      total,
      delivered,
      retrying,
      deadLetter,
      deliveryRate: deliveryRate(delivered, deadLetter),
      p95LatencyMs: successfulLatencies[p95Index] ?? null,
      lastEventAt: events.length ? events.map((event) => event.receivedAt).sort().at(-1) ?? null : null,
      state: reliabilityState(total, delivered, retrying, deadLetter),
    }];
  }
  async createEvent(input: CreateEventInput): Promise<CreateEventResult> {
    const prior = [...this.events.values()].find((event) => event.endpointId === input.endpointId && input.idempotencyKey && event.idempotencyKey === input.idempotencyKey);
    if (prior) return { event: prior, duplicate: true };
    const now = new Date().toISOString();
    const event: WebhookEvent = { id: randomUUID(), ...input, status: "queued", attemptCount: 0, lastError: null, receivedAt: now, updatedAt: now };
    this.events.set(event.id, event); return { event, duplicate: false };
  }
  async getEvent(id: string): Promise<EventDetail | null> {
    const event = this.events.get(id); if (!event) return null;
    return { ...event, endpoint: this.endpoint, attempts: this.attempts.filter((a) => a.eventId === id), rehearsals: this.rehearsals.filter((r) => r.eventId === id), audit: this.audit.filter((a) => a.eventId === id) };
  }
  async listEvents(limit: number) { return [...this.events.values()].slice(0, limit); }
  async updateEvent(id: string, patch: Partial<Pick<WebhookEvent, "status" | "attemptCount" | "lastError">>) { const event = this.events.get(id); if (event) this.events.set(id, { ...event, ...patch, updatedAt: new Date().toISOString() }); }
  async beginDeliveryAttempt(eventId: string, attemptCount: number, currentIntentId?: string, currentIntentProcessingAt?: string) {
    if (Boolean(currentIntentId) !== Boolean(currentIntentProcessingAt)) {
      throw new Error("Delivery attempt requires both the current intent and its processing claim");
    }
    const event = this.events.get(eventId);
    if (!event || event.status === "delivered") return false;
    if (currentIntentId && currentIntentProcessingAt) {
      const intent = this.intents.get(currentIntentId);
      if (!intent
        || intent.eventId !== eventId
        || intent.state !== "processing"
        || intent.processingAt !== currentIntentProcessingAt) return false;
    }
    this.events.set(eventId, { ...event, status: "delivering", attemptCount, lastError: null, updatedAt: new Date().toISOString() });
    return true;
  }
  async addAttempt(input: Omit<DeliveryAttempt, "id" | "createdAt">) { const row = { ...input, id: randomUUID(), createdAt: new Date().toISOString() }; this.attempts.push(row); return row; }
  async addRehearsal(input: Omit<Rehearsal, "id" | "createdAt">) { const row = { ...input, id: randomUUID(), createdAt: new Date().toISOString() }; this.rehearsals.push(row); return row; }
  async latestRehearsal(eventId: string) { return [...this.rehearsals].reverse().find((item) => item.eventId === eventId) ?? null; }
  async addAudit(input: Omit<AuditEntry, "id" | "createdAt">) { const row = { ...input, id: randomUUID(), createdAt: new Date().toISOString() }; this.audit.push(row); return row; }
  async createDeliveryIntent(jobKey: string, job: DeliveryJob, schedule: DeliveryIntentSchedule = {}) {
    const delayMs = schedule.delayMs ?? 0;
    if (!Number.isSafeInteger(delayMs) || delayMs < 0) throw new Error("Delivery intent delay must be a non-negative integer");
    if (schedule.availableAt !== undefined && !Number.isFinite(Date.parse(schedule.availableAt))) {
      throw new Error("Delivery intent availability must be a valid timestamp");
    }
    const availableAt = schedule.availableAt ?? new Date(this.now() + delayMs).toISOString();
    const existing = [...this.intents.values()].find((intent) => intent.jobKey === jobKey);
    if (existing) return { intent: existing, created: false };
    const id = randomUUID();
    const intent: DeliveryIntent = {
      id,
      jobKey,
      eventId: job.eventId,
      job: { ...job, intentId: id },
      state: "pending",
      availableAt,
      dispatchedAt: null,
      processingAt: null,
      completedAt: null,
      createdAt: new Date().toISOString(),
    };
    this.intents.set(id, intent);
    return { intent, created: true };
  }
  async commitRetryTransition(input: RetryTransitionInput) {
    assertRetryTransitionIdentity(input);
    if (!Number.isSafeInteger(input.backoffMs) || input.backoffMs < 0) throw new Error("Retry backoff must be a non-negative integer");
    const event = this.events.get(input.eventId);
    if (!event) throw new Error(`Event ${input.eventId} does not exist`);
    if (Boolean(input.currentIntentId) !== Boolean(input.currentIntentProcessingAt)) {
      throw new Error("Retry transition requires both the current intent and its processing claim");
    }
    const existing = [...this.intents.values()].find((intent) => intent.jobKey === input.jobKey);
    if (existing && (existing.eventId !== input.eventId || !sameDeliveryJob(existing.job, input.job))) {
      throw new Error(`Retry intent ${input.jobKey} contains a different job`);
    }
    if (input.currentIntentId && input.currentIntentProcessingAt) {
      const current = this.intents.get(input.currentIntentId);
      if (!current
        || current.eventId !== input.eventId
        || current.state !== "processing"
        || current.processingAt !== input.currentIntentProcessingAt) {
        throw new Error(`Delivery intent ${input.currentIntentId} lost its processing claim`);
      }
      await this.completeDeliveryIntent(input.currentIntentId, input.completedAt, input.currentIntentProcessingAt);
    }
    if (event.status === "delivered") return { scheduled: false as const, nextStatus: event.status };

    const plannedAtMs = this.now();
    const receiverDelayMs = parseRetryAfter(input.retryAfter, plannedAtMs);
    const proposedDelayMs = Math.max(input.backoffMs, receiverDelayMs ?? 0);
    const proposedStrategy = receiverDelayMs !== null && receiverDelayMs >= input.backoffMs ? "retry-after" : "backoff";
    const result = await this.createDeliveryIntent(
      input.jobKey,
      input.job,
      { availableAt: new Date(plannedAtMs + proposedDelayMs).toISOString() },
    );
    if (result.intent.state === "completed") return { scheduled: false as const, nextStatus: event.status };
    const delayMs = Math.max(0, Date.parse(result.intent.availableAt) - plannedAtMs);
    const priorAudit = this.audit.find((entry) => entry.eventId === input.eventId
      && entry.action === input.audit.action
      && entry.metadata.jobKey === input.jobKey);
    if (!priorAudit) {
      await this.addAudit({
        ...input.audit,
        metadata: {
          ...input.audit.metadata,
          jobKey: input.jobKey,
          intentCreated: result.created,
          delayMs,
          strategy: result.created ? proposedStrategy : "existing-intent",
          receiverDelayMs,
          availableAt: result.intent.availableAt,
          ...(!result.created ? { proposedDelayMs, proposedStrategy } : {}),
        },
      });
    }
    await this.updateEvent(input.eventId, { status: "retrying", lastError: input.lastError });
    return { scheduled: true as const, ...result, delayMs };
  }
  async commitDeliveryOutcome(input: DeliveryOutcomeInput) {
    const event = this.events.get(input.eventId);
    if (!event) throw new Error(`Event ${input.eventId} does not exist`);
    if (Boolean(input.currentIntentId) !== Boolean(input.currentIntentProcessingAt)) {
      throw new Error("Delivery transition requires both the current intent and its processing claim");
    }
    if (input.currentIntentId && input.currentIntentProcessingAt) {
      const completed = await this.completeDeliveryIntent(
        input.currentIntentId,
        input.completedAt,
        input.currentIntentProcessingAt,
      );
      if (!completed) throw new Error(`Delivery intent ${input.currentIntentId} lost its processing claim`);
    }
    if (event.status === "delivered" && input.status === "dead_letter") {
      return { applied: false, nextStatus: event.status };
    }
    await this.updateEvent(input.eventId, { status: input.status, lastError: input.lastError });
    await this.addAudit(input.audit);
    return { applied: true, nextStatus: input.status };
  }
  async listDispatchableIntents(limit = 500) {
    const nowIso = new Date(this.now()).toISOString();
    const staleBeforeIso = new Date(this.now() - DELIVERY_INTENT_LEASE_MS).toISOString();
    return [...this.intents.values()]
      .filter((intent) => intent.availableAt <= nowIso && (
        intent.state === "pending"
        || (intent.state === "dispatched" && Boolean(intent.dispatchedAt && intent.dispatchedAt < staleBeforeIso))
        || (intent.state === "processing" && Boolean(intent.processingAt && intent.processingAt < staleBeforeIso))
      ))
      .slice(0, limit);
  }
  async prepareDeliveryIntentDispatch(id: string) {
    const dispatchedAt = new Date(this.now()).toISOString();
    const staleBeforeIso = new Date(this.now() - DELIVERY_INTENT_LEASE_MS).toISOString();
    const intent = this.intents.get(id);
    const dispatchable = intent && (
      intent.state === "pending"
      || (intent.state === "dispatched" && Boolean(intent.dispatchedAt && intent.dispatchedAt < staleBeforeIso))
      || (intent.state === "processing" && Boolean(intent.processingAt && intent.processingAt < staleBeforeIso))
    );
    if (!intent || !dispatchable) return null;
    this.intents.set(id, { ...intent, state: "dispatched", dispatchedAt, processingAt: null });
    return { dispatchedAt, delayMs: Math.max(0, Date.parse(intent.availableAt) - this.now()) };
  }
  async releaseDeliveryIntent(id: string, dispatchedAt: string) {
    const intent = this.intents.get(id);
    if (intent?.state === "dispatched" && intent.dispatchedAt === dispatchedAt) {
      this.intents.set(id, { ...intent, state: "pending", dispatchedAt: null });
    }
  }
  async claimDeliveryIntent(id: string) {
    const processingAt = new Date(this.now()).toISOString();
    const intent = this.intents.get(id);
    if (intent?.state !== "dispatched") return { status: "unavailable" as const };
    if (this.events.get(intent.eventId)?.status === "delivered" && intent.job.mode !== "rehearsal") {
      await this.completeDeliveryIntent(intent.id, processingAt);
      return { status: "unavailable" as const };
    }
    if (intent.job.mode !== "rehearsal") {
      const cycleId = intent.job.cycleId ?? intent.job.mode;
      const attemptNumber = intent.job.attemptNumber ?? 1;
      const superseded = [...this.intents.values()].some((candidate) => candidate.id !== intent.id
        && candidate.eventId === intent.eventId
        && candidate.job.mode !== "rehearsal"
        && (candidate.job.cycleId ?? candidate.job.mode) === cycleId
        && (candidate.job.attemptNumber ?? 1) > attemptNumber);
      if (superseded) {
        await this.completeDeliveryIntent(intent.id, processingAt);
        return { status: "unavailable" as const };
      }
    }
    if (intent.availableAt > processingAt) {
      return {
        status: "deferred" as const,
        intent,
        retryAt: intent.availableAt,
        delayMs: Math.max(0, Date.parse(intent.availableAt) - this.now()),
        reason: "not-yet-available" as const,
      };
    }
    if (intent.job.mode !== "rehearsal") {
      const staleBefore = new Date(Date.parse(processingAt) - DELIVERY_INTENT_LEASE_MS).toISOString();
      for (const candidate of this.intents.values()) {
        if (candidate.id !== intent.id
          && candidate.eventId === intent.eventId
          && candidate.state === "processing"
          && Boolean(candidate.processingAt && candidate.processingAt < staleBefore)
          && candidate.job.mode !== "rehearsal") {
          this.intents.set(candidate.id, { ...candidate, state: "completed", completedAt: processingAt });
        }
      }
      const busy = [...this.intents.values()].some((candidate) => candidate.id !== intent.id
        && candidate.eventId === intent.eventId
        && candidate.state === "processing"
        && Boolean(candidate.processingAt && candidate.processingAt >= staleBefore)
        && candidate.job.mode !== "rehearsal");
      if (busy) {
        return {
          status: "deferred" as const,
          intent,
          retryAt: new Date(Date.parse(processingAt) + EVENT_BUSY_RETRY_MS).toISOString(),
          delayMs: EVENT_BUSY_RETRY_MS,
          reason: "event-busy" as const,
        };
      }
    }
    const claimed: DeliveryIntent = { ...intent, state: "processing", processingAt };
    this.intents.set(id, claimed);
    return { status: "claimed" as const, intent: claimed };
  }
  async releaseDeliveryIntentClaim(id: string, processingAt: string) {
    const intent = this.intents.get(id);
    if (intent?.state === "processing" && intent.processingAt === processingAt) {
      this.intents.set(id, { ...intent, state: "dispatched", processingAt: null });
    }
  }
  async completeDeliveryIntent(id: string, completedAt: string, processingAt?: string) {
    const intent = this.intents.get(id);
    if (!intent || intent.state === "completed") return false;
    if (processingAt) {
      if (intent.state !== "processing" || intent.processingAt !== processingAt) return false;
    } else if (intent.state === "processing") {
      return false;
    }
    this.intents.set(id, { ...intent, state: "completed", completedAt });
    return true;
  }
  async deliveryIntentStats() {
    const staleBeforeIso = new Date(this.now() - DELIVERY_INTENT_LEASE_MS).toISOString();
    const active = [...this.intents.values()].filter((intent) => intent.state !== "completed");
    return {
      pending: active.filter((intent) => intent.state === "pending").length,
      dispatched: active.filter((intent) => intent.state === "dispatched").length,
      processing: active.filter((intent) => intent.state === "processing").length,
      stale: active.filter((intent) => (
        intent.state === "pending" && intent.availableAt < staleBeforeIso
      ) || (
        intent.state === "dispatched" && Boolean(intent.dispatchedAt && intent.dispatchedAt < staleBeforeIso)
      ) || (
        intent.state === "processing" && Boolean(intent.processingAt && intent.processingAt < staleBeforeIso)
      )).length,
    };
  }
  async stats(): Promise<DashboardStats> { const all = [...this.events.values()]; const delivered = all.filter((e) => e.status === "delivered").length; return { total: all.length, queued: all.filter((e) => e.status === "queued").length, delivered, retrying: all.filter((e) => e.status === "retrying").length, deadLetter: all.filter((e) => e.status === "dead_letter").length, deliveryRate: all.length ? delivered / all.length * 100 : 100 }; }
  async recoverPending(_beforeIso: string): Promise<Array<{ eventId: string; attemptCount: number }>> { return []; }
  async deleteOlderThan(_beforeIso: string): Promise<number> { return 0; }
}
