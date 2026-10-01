import type { Rehearsal, WebhookEvent } from "./types.js";
import type { ReplayRiskAssessment } from "./replay-risk.js";

export interface ReplayRequest {
  actor: string;
  reason: string;
  destinationUrl: string;
  acknowledgeRisk?: boolean;
}

export interface GuardDecision {
  allowed: boolean;
  reasons: string[];
  checks: GuardCheck[];
}

export type GuardCheckStatus = "pass" | "fail" | "pending";

export interface GuardCheck {
  code: "reason" | "actor" | "rehearsal" | "rehearsal_result" | "payload_binding" | "destination_binding" | "event_state" | "risk_acknowledgement";
  label: string;
  status: GuardCheckStatus;
  message: string;
}

export function evaluateReplay(
  event: WebhookEvent,
  rehearsal: Rehearsal | null,
  request: ReplayRequest,
  risk?: ReplayRiskAssessment,
): GuardDecision {
  const checks: GuardCheck[] = [
    check(
      "reason",
      "Operator reason",
      request.reason.trim().length >= 10,
      "Replay reason records the operator's production-change intent",
      "A replay reason of at least 10 characters is required",
    ),
    check(
      "actor",
      "Operator identity",
      Boolean(request.actor.trim()),
      `Replay is attributed to ${request.actor.trim() || "an identified operator"}`,
      "An actor is required",
    ),
    check(
      "rehearsal",
      "Passing rehearsal",
      Boolean(rehearsal),
      "A successful rehearsal exists",
      "Run a successful rehearsal before replaying",
    ),
    rehearsal
      ? check("rehearsal_result", "Rehearsal outcome", rehearsal.passed, "The latest rehearsal passed", "The latest rehearsal did not pass")
      : pending("rehearsal_result", "Rehearsal outcome", "Waiting for a successful rehearsal"),
    rehearsal
      ? check("payload_binding", "Payload binding", rehearsal.payloadSha256 === event.payloadSha256, "Payload digest matches the rehearsal", "The payload changed after rehearsal")
      : pending("payload_binding", "Payload binding", "Waiting for rehearsal evidence"),
    rehearsal
      ? check("destination_binding", "Destination binding", rehearsal.destinationUrl === request.destinationUrl, "Destination exactly matches the rehearsal", "The destination changed after rehearsal")
      : pending("destination_binding", "Destination binding", "Waiting for rehearsal evidence"),
    check(
      "event_state",
      "Dead-letter state",
      event.status === "dead_letter",
      "Event is isolated in dead letter",
      "Only dead-letter events can be replayed",
    ),
    check(
      "risk_acknowledgement",
      "Duplicate-risk acknowledgement",
      !risk?.requiresAcknowledgement || Boolean(request.acknowledgeRisk),
      risk?.requiresAcknowledgement ? "Operator acknowledged the duplicate-side-effect risk" : "No explicit risk acknowledgement is required",
      "Explicitly acknowledge the duplicate-side-effect risk before replaying",
    ),
  ];
  const reasons = checks.filter((item) => item.status === "fail").map((item) => item.message);
  return { allowed: reasons.length === 0, reasons, checks };
}

function check(code: GuardCheck["code"], label: string, passed: boolean, passMessage: string, failMessage: string): GuardCheck {
  return { code, label, status: passed ? "pass" : "fail", message: passed ? passMessage : failMessage };
}

function pending(code: GuardCheck["code"], label: string, message: string): GuardCheck {
  return { code, label, status: "pending", message };
}
