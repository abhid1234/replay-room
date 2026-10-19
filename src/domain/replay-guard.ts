import type { Rehearsal, ReplayApproval, WebhookEvent } from "./types.js";
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
  code: "reason" | "actor" | "rehearsal" | "rehearsal_result" | "payload_binding" | "destination_binding" | "event_state" | "risk_acknowledgement" | "dual_control";
  label: string;
  status: GuardCheckStatus;
  message: string;
}

export function evaluateReplay(
  event: WebhookEvent,
  rehearsal: Rehearsal | null,
  request: ReplayRequest,
  risk?: ReplayRiskAssessment,
  approval?: ReplayApproval | null,
  now = Date.now(),
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
    dualControlCheck(event, rehearsal, request, risk, approval, now),
  ];
  const reasons = checks.filter((item) => item.status === "fail").map((item) => item.message);
  return { allowed: reasons.length === 0, reasons, checks };
}

function dualControlCheck(
  event: WebhookEvent,
  rehearsal: Rehearsal | null,
  request: ReplayRequest,
  risk: ReplayRiskAssessment | undefined,
  approval: ReplayApproval | null | undefined,
  now: number,
): GuardCheck {
  if (!risk?.requiresAcknowledgement) {
    return check(
      "dual_control",
      "Two-person approval",
      true,
      "Replay risk does not require a second operator",
      "A second operator is required",
    );
  }
  if (!approval) {
    return check(
      "dual_control",
      "Two-person approval",
      false,
      "A fresh approval from another operator is bound to this replay",
      "Record a high-risk approval before replaying",
    );
  }
  if (Date.parse(approval.expiresAt) <= now) {
    return check(
      "dual_control",
      "Two-person approval",
      false,
      "A fresh approval from another operator is bound to this replay",
      "The high-risk approval expired; record a fresh approval",
    );
  }
  const bound = rehearsal !== null
    && approval.eventId === event.id
    && approval.rehearsalId === rehearsal.id
    && approval.payloadSha256 === event.payloadSha256
    && approval.destinationUrl === request.destinationUrl;
  if (!bound) {
    return check(
      "dual_control",
      "Two-person approval",
      false,
      "A fresh approval from another operator is bound to this replay",
      "The high-risk approval does not match this rehearsal, payload, and destination",
    );
  }
  return check(
    "dual_control",
    "Two-person approval",
    approval.actor.trim().toLowerCase() !== request.actor.trim().toLowerCase(),
    `Approval by ${approval.actor} is fresh and bound to this replay`,
    "A different operator must execute the approved replay",
  );
}

function check(code: GuardCheck["code"], label: string, passed: boolean, passMessage: string, failMessage: string): GuardCheck {
  return { code, label, status: passed ? "pass" : "fail", message: passed ? passMessage : failMessage };
}

function pending(code: GuardCheck["code"], label: string, message: string): GuardCheck {
  return { code, label, status: "pending", message };
}
