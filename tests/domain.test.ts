import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { evaluateReplay } from "../src/domain/replay-guard.js";
import { deliveryRate, reliabilityState } from "../src/domain/reliability.js";
import { diagnoseEvent } from "../src/domain/diagnosis.js";
import { createEvidenceBundle, verifyEvidenceBundle } from "../src/domain/evidence.js";
import { isRetryableStatus, retryDelayMs } from "../src/domain/retry.js";
import { assertSafeDestination, assertSafeResolvedDestination, redactHeaders, sha256, signPayload, verifySignature } from "../src/domain/security.js";
import { heartbeatAgeSeconds, heartbeatState } from "../src/domain/system.js";
import type { Rehearsal, WebhookEvent } from "../src/domain/types.js";

const event: WebhookEvent = {
  id: "3a553dce-f3c5-4da7-a612-857389682d06", endpointId: "6d1bda7a-8615-4c03-8095-3600e826f0f7",
  idempotencyKey: "checkout-1", headers: {}, payload: { ok: true }, payloadSha256: "a".repeat(64), status: "dead_letter",
  attemptCount: 5, lastError: "timeout", receivedAt: "2026-09-27T00:00:00.000Z", updatedAt: "2026-09-27T00:01:00.000Z",
};

const rehearsal: Rehearsal = {
  id: "aeb0eb77-bb9e-4ec8-aecd-51c074a1ee6d", eventId: event.id, payloadSha256: event.payloadSha256,
  destinationUrl: "https://example.com/hook", passed: true, statusCode: 204, notes: "ok", createdAt: "2026-09-27T00:02:00.000Z",
};

describe("replay guard", () => {
  it("allows a dead letter only when passing evidence binds payload and target", () => {
    expect(evaluateReplay(event, rehearsal, { actor: "abhi", reason: "Verified the receiver fix", destinationUrl: rehearsal.destinationUrl })).toEqual({ allowed: true, reasons: [] });
  });
  it("blocks target drift and payload drift", () => {
    const decision = evaluateReplay({ ...event, payloadSha256: "changed" }, rehearsal, { actor: "abhi", reason: "Verified the receiver fix", destinationUrl: "https://elsewhere.example/hook" });
    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toContain("The payload changed after rehearsal");
    expect(decision.reasons).toContain("The destination changed after rehearsal");
  });
});

describe("retry policy", () => {
  it("uses bounded exponential backoff", () => {
    expect(retryDelayMs(1, { baseDelayMs: 1000, maxDelayMs: 5000, jitterRatio: 0 }, () => 0.5)).toBe(1000);
    expect(retryDelayMs(5, { baseDelayMs: 1000, maxDelayMs: 5000, jitterRatio: 0 }, () => 0.5)).toBe(5000);
  });
  it("retries transient statuses only", () => {
    expect(isRetryableStatus(429)).toBe(true); expect(isRetryableStatus(503)).toBe(true); expect(isRetryableStatus(422)).toBe(false);
  });
});

describe("security helpers", () => {
  it("verifies HMAC signatures without leaking secret headers", () => {
    const signature = signPayload("secret", "{\"ok\":true}");
    expect(verifySignature("secret", "{\"ok\":true}", signature)).toBe(true);
    expect(redactHeaders({ authorization: "Bearer private", "x-event-id": "evt_1" })).toEqual({ authorization: "[REDACTED]", "x-event-id": "evt_1" });
    expect(sha256("same")).toBe(sha256("same"));
  });
  it("blocks private production targets", () => {
    expect(() => assertSafeDestination("http://127.0.0.1:4000", false)).toThrow("Private-network");
    expect(() => assertSafeDestination("https://[::1]/hook", false)).toThrow("Private-network");
    expect(() => assertSafeDestination("https://[fd00::1]/hook", false)).toThrow("Private-network");
    expect(assertSafeDestination("https://example.com/hook", false).hostname).toBe("example.com");
  });
  it("blocks public hostnames that resolve into private networks", async () => {
    await expect(assertSafeResolvedDestination(
      "https://hooks.example/deliver",
      false,
      async () => [{ address: "10.42.0.8", family: 4 }],
    )).rejects.toThrow("private or reserved network");
    await expect(assertSafeResolvedDestination(
      "https://hooks.example/deliver",
      false,
      async () => [{ address: "93.184.216.34", family: 4 }],
    )).resolves.toMatchObject({ hostname: "hooks.example" });
  });
});

describe("incident diagnosis", () => {
  it("identifies a repeated receiver outage and gives an evidence-backed action", () => {
    const diagnosis = diagnoseEvent({
      ...event,
      endpoint: {
        id: event.endpointId,
        name: "Billing",
        ingestKey: "hook_test_123456",
        destinationUrl: "https://example.com/hook",
        signingSecret: null,
        maxAttempts: 5,
        createdAt: event.receivedAt,
      },
      attempts: [
        { id: "a1", eventId: event.id, mode: "live", destinationUrl: "https://example.com/hook", statusCode: 503, responseBody: "down", error: null, durationMs: 120, createdAt: event.updatedAt },
        { id: "a2", eventId: event.id, mode: "live", destinationUrl: "https://example.com/hook", statusCode: 502, responseBody: "down", error: null, durationMs: 90, createdAt: event.updatedAt },
      ],
      rehearsals: [],
      audit: [],
    });

    expect(diagnosis.code).toBe("receiver_outage");
    expect(diagnosis.severity).toBe("critical");
    expect(diagnosis.evidence).toContain("HTTP sequence: 503 → 502");
    expect(diagnosis.nextAction).toContain("rehearse");
  });
});

describe("component heartbeats", () => {
  it("distinguishes fresh, stale, and not-yet-seen services", () => {
    const now = Date.parse("2026-09-27T12:00:00.000Z");
    expect(heartbeatState("2026-09-27T11:59:50.000Z", 45_000, now)).toBe("online");
    expect(heartbeatState("2026-09-27T11:58:00.000Z", 45_000, now)).toBe("degraded");
    expect(heartbeatState(null, 45_000, now)).toBe("waiting");
    expect(heartbeatAgeSeconds("2026-09-27T11:59:50.000Z", now)).toBe(10);
  });
});

describe("incident evidence", () => {
  it("detects any change to an exported incident bundle", () => {
    const detail = {
      ...event,
      endpoint: {
        id: event.endpointId,
        name: "Billing",
        ingestKey: "hook_test_123456",
        destinationUrl: "https://example.com/hook",
        signingSecret: "never-export-this-secret",
        maxAttempts: 5,
        createdAt: event.receivedAt,
      },
      attempts: [],
      rehearsals: [rehearsal],
      audit: [],
    };
    const secret = "evidence-test-secret-with-at-least-32-characters";
    const bundle = createEvidenceBundle(detail, secret, "2026-09-27T12:00:00.000Z");

    expect(bundle.event.endpointName).toBe("Billing");
    expect(JSON.stringify(bundle)).not.toContain("never-export-this-secret");
    expect(verifyEvidenceBundle(bundle, secret)).toBe(true);

    const tampered = structuredClone(bundle);
    tampered.event.status = "delivered";
    expect(verifyEvidenceBundle(tampered, secret)).toBe(false);
  });
});

describe("production configuration", () => {
  it("rejects the development evidence key in production", () => {
    expect(() => loadConfig({
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://user:pass@example.com/replay_room",
      REDIS_URL: "redis://example.com:6379",
      ADMIN_TOKEN: "production-admin-token",
      EVIDENCE_SIGNING_SECRET: "development-only-evidence-secret-change-me",
    })).toThrow("Production requires a unique evidence signing secret");
  });
});

describe("endpoint reliability", () => {
  it("separates healthy, at-risk, breached, and idle destinations", () => {
    expect(reliabilityState(0, 0, 0, 0)).toBe("idle");
    expect(reliabilityState(100, 100, 0, 0)).toBe("healthy");
    expect(reliabilityState(100, 98, 1, 0)).toBe("at_risk");
    expect(reliabilityState(100, 99, 0, 1)).toBe("at_risk");
    expect(reliabilityState(100, 94, 0, 6)).toBe("breached");
    expect(deliveryRate(2, 1)).toBe(66.7);
  });
});
