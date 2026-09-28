import type { EventDetail, IncidentDiagnosis } from "./types.js";

export function diagnoseEvent(event: EventDetail): IncidentDiagnosis {
  const deliveryAttempts = event.attempts.filter((attempt) => attempt.mode !== "rehearsal");
  const statusCodes = deliveryAttempts.flatMap((attempt) => attempt.statusCode === null ? [] : [attempt.statusCode]);
  const networkErrors = deliveryAttempts.filter((attempt) => attempt.error);
  const evidence = [
    `${deliveryAttempts.length} delivery attempt${deliveryAttempts.length === 1 ? "" : "s"} recorded`,
    ...(statusCodes.length ? [`HTTP sequence: ${statusCodes.join(" → ")}`] : []),
    ...(event.lastError ? [`Last error: ${event.lastError}`] : []),
  ].slice(0, 3);

  if (event.status === "delivered") {
    return diagnosis("nominal", "info", "Delivery completed", "The receiver accepted the event.", evidence, "No operator action is required.");
  }
  if (event.status === "queued") {
    return diagnosis("queued", "info", "Waiting for a worker", "The ledger contains the event and the queue owns the next step.", evidence, "Watch for a worker claim before investigating.");
  }
  if (event.status === "delivering") {
    return diagnosis("in_flight", "info", "Delivery is in flight", "A worker currently owns this event.", evidence, "Let the delivery timeout or complete before intervening.");
  }
  if (event.status === "retrying") {
    return diagnosis("transient", "warning", "Automatic recovery in progress", "The failure is retryable and a delayed attempt is already scheduled.", evidence, "Monitor the next attempt; avoid a manual replay while retries are active.");
  }
  if (networkErrors.length === deliveryAttempts.length && deliveryAttempts.length > 0) {
    return diagnosis("network_failure", "critical", "Receiver could not be reached", "Every attempt failed before an HTTP response arrived.", evidence, "Verify DNS, TLS, firewall rules, and receiver availability, then run a rehearsal.");
  }
  if (statusCodes.includes(429)) {
    return diagnosis("rate_limited", "critical", "Receiver throttled delivery", "At least one attempt was rejected for exceeding the receiver's rate limit.", evidence, "Confirm the receiver's recovery window, then rehearse after capacity returns.");
  }
  if (statusCodes.some((code) => code >= 500)) {
    return diagnosis("receiver_outage", "critical", "Receiver failed repeatedly", "The receiver returned server errors until the retry budget was exhausted.", evidence, "Repair or roll back the receiver, rehearse the exact payload, then approve replay.");
  }
  if (statusCodes.some((code) => code >= 400)) {
    return diagnosis("contract_rejection", "critical", "Receiver rejected the payload", "A permanent client error indicates a contract, authentication, or validation mismatch.", evidence, "Compare the stored payload and headers with the receiver contract before rehearsal.");
  }
  return diagnosis("attempts_exhausted", "critical", "Delivery budget exhausted", "The event reached dead letter without a more specific signal.", evidence, "Inspect the attempt transcript, correct the receiver, and run a rehearsal.");
}

function diagnosis(
  code: IncidentDiagnosis["code"],
  severity: IncidentDiagnosis["severity"],
  headline: string,
  summary: string,
  evidence: string[],
  nextAction: string,
): IncidentDiagnosis {
  return { code, severity, headline, summary, evidence, nextAction };
}
