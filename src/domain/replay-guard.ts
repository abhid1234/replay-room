import type { Rehearsal, WebhookEvent } from "./types.js";

export interface ReplayRequest {
  actor: string;
  reason: string;
  destinationUrl: string;
}

export interface GuardDecision {
  allowed: boolean;
  reasons: string[];
}

export function evaluateReplay(
  event: WebhookEvent,
  rehearsal: Rehearsal | null,
  request: ReplayRequest,
): GuardDecision {
  const reasons: string[] = [];
  if (request.reason.trim().length < 10) reasons.push("A replay reason of at least 10 characters is required");
  if (!request.actor.trim()) reasons.push("An actor is required");
  if (!rehearsal) reasons.push("Run a successful rehearsal before replaying");
  if (rehearsal && !rehearsal.passed) reasons.push("The latest rehearsal did not pass");
  if (rehearsal && rehearsal.payloadSha256 !== event.payloadSha256) reasons.push("The payload changed after rehearsal");
  if (rehearsal && rehearsal.destinationUrl !== request.destinationUrl) reasons.push("The destination changed after rehearsal");
  if (event.status !== "dead_letter") reasons.push("Only dead-letter events can be replayed");
  return { allowed: reasons.length === 0, reasons };
}
