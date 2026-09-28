import { describe, expect, it } from "vitest";
import { evaluateReplay } from "../src/domain/replay-guard.js";
import { isRetryableStatus, retryDelayMs } from "../src/domain/retry.js";
import { assertSafeDestination, redactHeaders, sha256, signPayload, verifySignature } from "../src/domain/security.js";
import type { Rehearsal, WebhookEvent } from "../src/domain/types.js";

const event: WebhookEvent = {
  id: "3a553dce-f3c5-4da7-a612-857389682d06", endpointId: "6d1bda7a-8615-4c03-8095-3600e826f0f7",
  idempotencyKey: "checkout-1", headers: {}, payload: { ok: true }, payloadSha256: "abc", status: "dead_letter",
  attemptCount: 5, lastError: "timeout", receivedAt: "2026-09-27T00:00:00.000Z", updatedAt: "2026-09-27T00:01:00.000Z",
};

const rehearsal: Rehearsal = {
  id: "aeb0eb77-bb9e-4ec8-aecd-51c074a1ee6d", eventId: event.id, payloadSha256: "abc",
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
    expect(assertSafeDestination("https://example.com/hook", false).hostname).toBe("example.com");
  });
});
