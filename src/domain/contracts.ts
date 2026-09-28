import type {
  AuditEntry,
  DashboardStats,
  DeliveryAttempt,
  DeliveryMode,
  Endpoint,
  EndpointReliability,
  EventDetail,
  EventStatus,
  Rehearsal,
  WebhookEvent,
} from "./types.js";

export interface CreateEventInput {
  endpointId: string;
  idempotencyKey: string | null;
  headers: Record<string, string>;
  payload: unknown;
  payloadSha256: string;
}

export interface CreateEventResult {
  event: WebhookEvent;
  duplicate: boolean;
}

export interface Store {
  ping(): Promise<void>;
  createEndpoint(input: Omit<Endpoint, "id" | "createdAt">): Promise<Endpoint>;
  getEndpointByIngestKey(ingestKey: string): Promise<Endpoint | null>;
  listEndpoints(): Promise<Endpoint[]>;
  endpointReliability(windowHours: number): Promise<EndpointReliability[]>;
  createEvent(input: CreateEventInput): Promise<CreateEventResult>;
  getEvent(id: string): Promise<EventDetail | null>;
  listEvents(limit: number): Promise<WebhookEvent[]>;
  updateEvent(
    id: string,
    patch: Partial<Pick<WebhookEvent, "status" | "attemptCount" | "lastError">>,
  ): Promise<void>;
  addAttempt(input: Omit<DeliveryAttempt, "id" | "createdAt">): Promise<DeliveryAttempt>;
  addRehearsal(input: Omit<Rehearsal, "id" | "createdAt">): Promise<Rehearsal>;
  latestPassingRehearsal(eventId: string): Promise<Rehearsal | null>;
  addAudit(input: Omit<AuditEntry, "id" | "createdAt">): Promise<AuditEntry>;
  stats(): Promise<DashboardStats>;
  recoverPending(beforeIso: string): Promise<string[]>;
  deleteOlderThan(beforeIso: string): Promise<number>;
}

export interface DeliveryJob {
  eventId: string;
  mode: DeliveryMode;
  destinationUrl?: string;
  actor?: string;
  reason?: string;
}

export interface DeliveryQueue {
  enqueue(job: DeliveryJob, options?: { delayMs?: number; jobId?: string }): Promise<void>;
  health(): Promise<QueueHealth>;
  heartbeat(component: "worker" | "cron"): Promise<void>;
  close(): Promise<void>;
}

export interface QueueHealth {
  latencyMs: number;
  jobs: {
    waiting: number;
    active: number;
    delayed: number;
    failed: number;
  };
  workerHeartbeat: string | null;
  cronHeartbeat: string | null;
}

export interface DeliveryResult {
  delivered: boolean;
  terminal: boolean;
  nextStatus: EventStatus;
  retryDelayMs: number | null;
}
