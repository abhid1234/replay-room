import { randomUUID } from "node:crypto";
import type { CreateEventInput, CreateEventResult, Store } from "../src/domain/contracts.js";
import type { AuditEntry, DashboardStats, DeliveryAttempt, Endpoint, EventDetail, Rehearsal, WebhookEvent } from "../src/domain/types.js";

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
