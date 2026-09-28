export type EventStatus =
  | "queued"
  | "delivering"
  | "retrying"
  | "delivered"
  | "dead_letter";

export type DeliveryMode = "live" | "rehearsal" | "replay";

export interface Endpoint {
  id: string;
  name: string;
  ingestKey: string;
  destinationUrl: string;
  signingSecret: string | null;
  maxAttempts: number;
  createdAt: string;
}

export interface WebhookEvent {
  id: string;
  endpointId: string;
  idempotencyKey: string | null;
  headers: Record<string, string>;
  payload: unknown;
  payloadSha256: string;
  status: EventStatus;
  attemptCount: number;
  lastError: string | null;
  receivedAt: string;
  updatedAt: string;
}

export interface DeliveryAttempt {
  id: string;
  eventId: string;
  mode: DeliveryMode;
  destinationUrl: string;
  statusCode: number | null;
  responseBody: string | null;
  error: string | null;
  durationMs: number;
  createdAt: string;
}

export interface Rehearsal {
  id: string;
  eventId: string;
  payloadSha256: string;
  destinationUrl: string;
  passed: boolean;
  statusCode: number | null;
  notes: string;
  createdAt: string;
}

export interface AuditEntry {
  id: string;
  eventId: string;
  action: string;
  actor: string;
  reason: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface EventDetail extends WebhookEvent {
  endpoint: Endpoint;
  attempts: DeliveryAttempt[];
  rehearsals: Rehearsal[];
  audit: AuditEntry[];
}

export interface DashboardStats {
  total: number;
  queued: number;
  delivered: number;
  retrying: number;
  deadLetter: number;
  deliveryRate: number;
}
