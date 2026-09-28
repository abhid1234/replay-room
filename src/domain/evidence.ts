import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { diagnoseEvent } from "./diagnosis.js";
import type { EventDetail } from "./types.js";

export interface EvidenceBundle {
  schemaVersion: "replay-room.evidence/v1";
  generatedAt: string;
  event: {
    id: string;
    endpointId: string;
    endpointName: string;
    idempotencyKey: string | null;
    headers: Record<string, string>;
    payload: unknown;
    payloadSha256: string;
    status: string;
    attemptCount: number;
    lastError: string | null;
    receivedAt: string;
    updatedAt: string;
  };
  diagnosis: ReturnType<typeof diagnoseEvent>;
  attempts: EventDetail["attempts"];
  rehearsals: EventDetail["rehearsals"];
  audit: EventDetail["audit"];
  integrity: {
    algorithm: "HMAC-SHA256";
    contentSha256: string;
    signature: string;
  };
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

export function verifyEvidenceBundle(bundle: EvidenceBundle, secret: string): boolean {
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
