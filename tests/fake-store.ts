import { randomUUID } from "node:crypto";
import type { CreateEventInput, CreateEventResult, Store } from "../src/domain/contracts.js";
import { deliveryRate, reliabilityState } from "../src/domain/reliability.js";
import type { AuditEntry, DashboardStats, DeliveryAttempt, Endpoint, EndpointReliability, EventDetail, Rehearsal, WebhookEvent } from "../src/domain/types.js";

export class FakeStore implements Store {
  endpoint: Endpoint = {
    id: randomUUID(), name: "Test", ingestKey: "hook_test_123456", destinationUrl: "https://example.com/hook",
    signingSecret: null, maxAttempts: 3, createdAt: new Date().toISOString(),
  };
  events = new Map<string, WebhookEvent>();
  attempts: DeliveryAttempt[] = [];
  rehearsals: Rehearsal[] = [];
  audit: AuditEntry[] = [];

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
  async addAttempt(input: Omit<DeliveryAttempt, "id" | "createdAt">) { const row = { ...input, id: randomUUID(), createdAt: new Date().toISOString() }; this.attempts.push(row); return row; }
  async addRehearsal(input: Omit<Rehearsal, "id" | "createdAt">) { const row = { ...input, id: randomUUID(), createdAt: new Date().toISOString() }; this.rehearsals.push(row); return row; }
  async latestPassingRehearsal(eventId: string) { return [...this.rehearsals].reverse().find((item) => item.eventId === eventId && item.passed) ?? null; }
  async addAudit(input: Omit<AuditEntry, "id" | "createdAt">) { const row = { ...input, id: randomUUID(), createdAt: new Date().toISOString() }; this.audit.push(row); return row; }
  async stats(): Promise<DashboardStats> { const all = [...this.events.values()]; const delivered = all.filter((e) => e.status === "delivered").length; return { total: all.length, queued: all.filter((e) => e.status === "queued").length, delivered, retrying: all.filter((e) => e.status === "retrying").length, deadLetter: all.filter((e) => e.status === "dead_letter").length, deliveryRate: all.length ? delivered / all.length * 100 : 100 }; }
  async recoverPending() { return []; }
  async deleteOlderThan() { return 0; }
}
