import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { diagnoseEvent } from "./diagnosis.js";
import { assessReplayRisk } from "./replay-risk.js";
import type { EventDetail } from "./types.js";

const isoDate = z.string().datetime({ offset: true });
const sha256Hex = z.string().regex(/^[a-f0-9]{64}$/);
const uuid = z.string().uuid();

const attemptSchema = z.object({
  id: uuid,
  eventId: uuid,
  mode: z.enum(["live", "rehearsal", "replay"]),
  destinationUrl: z.string().url(),
  statusCode: z.number().int().min(100).max(599).nullable(),
  responseBody: z.string().nullable(),
  error: z.string().nullable(),
  durationMs: z.number().int().nonnegative(),
  createdAt: isoDate,
}).strict();

const rehearsalSchema = z.object({
  id: uuid,
  eventId: uuid,
  payloadSha256: sha256Hex,
  destinationUrl: z.string().url(),
  passed: z.boolean(),
  statusCode: z.number().int().min(100).max(599).nullable(),
  notes: z.string(),
  createdAt: isoDate,
}).strict();

const auditSchema = z.object({
  id: uuid,
  eventId: uuid,
  action: z.string().min(1),
  actor: z.string().min(1),
  reason: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: isoDate,
}).strict();

export const evidenceBundleSchema = z.object({
  schemaVersion: z.literal("replay-room.evidence/v1"),
  generatedAt: isoDate,
  event: z.object({
    id: uuid,
    endpointId: uuid,
    endpointName: z.string().min(1),
    idempotencyKey: z.string().nullable(),
    headers: z.record(z.string(), z.string()),
    payload: z.unknown(),
    payloadSha256: sha256Hex,
    status: z.enum(["queued", "delivering", "retrying", "delivered", "dead_letter"]),
    attemptCount: z.number().int().nonnegative(),
    lastError: z.string().nullable(),
    receivedAt: isoDate,
    updatedAt: isoDate,
  }).strict(),
  diagnosis: z.object({
    code: z.enum(["nominal", "queued", "in_flight", "transient", "receiver_outage", "rate_limited", "contract_rejection", "network_failure", "attempts_exhausted"]),
    severity: z.enum(["info", "warning", "critical"]),
    headline: z.string().min(1),
    summary: z.string().min(1),
    evidence: z.array(z.string()),
    nextAction: z.string().min(1),
  }).strict(),
  replayRisk: z.object({
    level: z.enum(["low", "elevated", "high"]),
    requiresAcknowledgement: z.boolean(),
    headline: z.string().min(1),
    summary: z.string().min(1),
    signals: z.array(z.object({
      code: z.enum(["missing_idempotency_key", "ambiguous_network_outcome", "prior_success", "multiple_attempts", "transient_receiver_failure", "known_rejection"]),
      severity: z.enum(["low", "elevated", "high"]),
      message: z.string().min(1),
    }).strict()),
  }).strict(),
  attempts: z.array(attemptSchema),
  rehearsals: z.array(rehearsalSchema),
  audit: z.array(auditSchema),
  integrity: z.object({
    algorithm: z.literal("HMAC-SHA256"),
    contentSha256: sha256Hex,
    signature: sha256Hex,
  }).strict(),
}).strict();

export type EvidenceBundle = z.infer<typeof evidenceBundleSchema>;

export function parseEvidenceBundle(value: unknown): EvidenceBundle {
  return evidenceBundleSchema.parse(value);
}

export function createEvidenceBundle(
  detail: EventDetail,
  secret: string,
  generatedAt = new Date().toISOString(),
): EvidenceBundle {
  const content = {
    schemaVersion: "replay-room.evidence/v1" as const,
    generatedAt,
    event: {
      id: detail.id,
      endpointId: detail.endpointId,
      endpointName: detail.endpoint.name,
      idempotencyKey: detail.idempotencyKey,
      headers: detail.headers,
      payload: detail.payload,
      payloadSha256: detail.payloadSha256,
      status: detail.status,
      attemptCount: detail.attemptCount,
      lastError: detail.lastError,
      receivedAt: detail.receivedAt,
      updatedAt: detail.updatedAt,
    },
    diagnosis: diagnoseEvent(detail),
    replayRisk: assessReplayRisk(detail),
    attempts: detail.attempts,
    rehearsals: detail.rehearsals,
    audit: detail.audit,
  };
  const canonical = canonicalJson(content);
  return {
    ...content,
    integrity: {
      algorithm: "HMAC-SHA256",
      contentSha256: createHash("sha256").update(canonical).digest("hex"),
      signature: createHmac("sha256", secret).update(canonical).digest("hex"),
    },
  };
}

export function verifyEvidenceBundle(value: unknown, secret: string): boolean {
  const bundle = parseEvidenceBundle(value);
  const { integrity, ...content } = bundle;
  const canonical = canonicalJson(content);
  const contentSha256 = createHash("sha256").update(canonical).digest("hex");
  const signature = createHmac("sha256", secret).update(canonical).digest("hex");
  return safeEqual(integrity.contentSha256, contentSha256) && safeEqual(integrity.signature, signature);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
