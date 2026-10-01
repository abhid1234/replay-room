import type {
  AuditEntry,
  DashboardStats,
  DeliveryAttempt,
  DeliveryIntent,
  DeliveryIntentStats,
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

export interface RetryTransitionInput {
  eventId: string;
  jobKey: string;
  job: DeliveryJob;
  backoffMs: number;
  retryAfter: string | null;
  currentIntentId?: string;
  currentIntentProcessingAt?: string;
  completedAt: string;
  lastError: string;
  audit: Omit<AuditEntry, "id" | "createdAt">;
}

export type RetryTransitionResult =
  | { scheduled: true; intent: DeliveryIntent; created: boolean; delayMs: number }
  | { scheduled: false; nextStatus: EventStatus };

export interface DeliveryOutcomeInput {
  eventId: string;
  status: "delivered" | "dead_letter";
  lastError: string | null;
  currentIntentId?: string;
  currentIntentProcessingAt?: string;
  completedAt: string;
  audit: Omit<AuditEntry, "id" | "createdAt">;
}

export interface DeliveryOutcomeResult {
  applied: boolean;
  nextStatus: EventStatus;
}

export type ClaimDeliveryIntentResult =
  | { status: "claimed"; intent: DeliveryIntent }
  | { status: "deferred"; intent: DeliveryIntent; retryAt: string; delayMs: number; reason: "not-yet-available" | "event-busy" }
  | { status: "unavailable" };

export interface DeliveryIntentDispatch {
  dispatchedAt: string;
  delayMs: number;
}

export type DeliveryIntentSchedule =
  | { delayMs?: number; availableAt?: never }
  | { delayMs?: never; availableAt: string };

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
  beginDeliveryAttempt(
    eventId: string,
    attemptCount: number,
    currentIntentId?: string,
    currentIntentProcessingAt?: string,
  ): Promise<boolean>;
  addAttempt(input: Omit<DeliveryAttempt, "id" | "createdAt">): Promise<DeliveryAttempt>;
  addRehearsal(input: Omit<Rehearsal, "id" | "createdAt">): Promise<Rehearsal>;
  latestRehearsal(eventId: string): Promise<Rehearsal | null>;
  addAudit(input: Omit<AuditEntry, "id" | "createdAt">): Promise<AuditEntry>;
  createDeliveryIntent(
    jobKey: string,
    job: DeliveryJob,
    schedule?: DeliveryIntentSchedule,
  ): Promise<{ intent: DeliveryIntent; created: boolean }>;
  commitRetryTransition(input: RetryTransitionInput): Promise<RetryTransitionResult>;
  commitDeliveryOutcome(input: DeliveryOutcomeInput): Promise<DeliveryOutcomeResult>;
  listDispatchableIntents(limit?: number): Promise<DeliveryIntent[]>;
  prepareDeliveryIntentDispatch(id: string): Promise<DeliveryIntentDispatch | null>;
  releaseDeliveryIntent(id: string, dispatchedAt: string): Promise<void>;
  claimDeliveryIntent(id: string): Promise<ClaimDeliveryIntentResult>;
  releaseDeliveryIntentClaim(id: string, processingAt: string): Promise<void>;
  completeDeliveryIntent(id: string, completedAt: string, processingAt?: string): Promise<boolean>;
  deliveryIntentStats(): Promise<DeliveryIntentStats>;
  stats(): Promise<DashboardStats>;
  recoverPending(beforeIso: string): Promise<Array<{ eventId: string; attemptCount: number }>>;
  deleteOlderThan(beforeIso: string): Promise<number>;
}

export interface DeliveryJob {
  eventId: string;
  mode: DeliveryMode;
  cycleId?: string;
  attemptNumber?: number;
  intentId?: string;
  destinationUrl?: string;
  actor?: string;
  reason?: string;
}

export interface DeliveryQueue {
  enqueue(job: DeliveryJob, options?: { delayMs?: number; jobId?: string }): Promise<void>;
  health(): Promise<QueueHealth>;
  heartbeat(component: "worker" | "cron"): Promise<void>;
  consumeRateLimit(key: string, limit: number, windowSeconds: number): Promise<RateLimitDecision>;
  close(): Promise<void>;
}

export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
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
  deferredUntil?: string;
}
