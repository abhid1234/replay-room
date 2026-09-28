import type { EventDetail } from "./types.js";

export type ReplayRiskLevel = "low" | "elevated" | "high";

export interface ReplayRiskSignal {
  code: "missing_idempotency_key" | "ambiguous_network_outcome" | "prior_success" | "multiple_attempts" | "transient_receiver_failure" | "known_rejection";
  severity: ReplayRiskLevel;
  message: string;
}

export interface ReplayRiskAssessment {
  level: ReplayRiskLevel;
  requiresAcknowledgement: boolean;
  headline: string;
  summary: string;
  signals: ReplayRiskSignal[];
}

export function assessReplayRisk(event: EventDetail): ReplayRiskAssessment {
  const attempts = event.attempts.filter((attempt) => attempt.mode !== "rehearsal");
  const signals: ReplayRiskSignal[] = [];

  if (!event.idempotencyKey) {
    signals.push({
      code: "missing_idempotency_key",
      severity: "high",
      message: "The receiver has no stable idempotency key to suppress a duplicate side effect.",
    });
  }
  if (attempts.some((attempt) => attempt.statusCode === null)) {
    signals.push({
      code: "ambiguous_network_outcome",
      severity: "high",
      message: "At least one request produced no HTTP response, so receiver-side acceptance is ambiguous.",
    });
  }
  if (attempts.some((attempt) => attempt.statusCode !== null && attempt.statusCode >= 200 && attempt.statusCode < 300)) {
    signals.push({
      code: "prior_success",
      severity: "high",
      message: "A prior attempt returned success; replay could repeat an already-completed side effect.",
    });
  }
  if (attempts.length > 1) {
    signals.push({
      code: "multiple_attempts",
      severity: "elevated",
      message: `${attempts.length} production delivery attempts already reached the receiver boundary.`,
    });
  }
  if (attempts.some((attempt) => attempt.statusCode === 429 || (attempt.statusCode !== null && attempt.statusCode >= 500))) {
    signals.push({
      code: "transient_receiver_failure",
      severity: "elevated",
      message: "The receiver reported a transient failure; confirm its processing semantics before replay.",
    });
  }
  if (attempts.length > 0 && attempts.every((attempt) => attempt.statusCode !== null && attempt.statusCode >= 400 && attempt.statusCode < 500 && attempt.statusCode !== 408 && attempt.statusCode !== 425 && attempt.statusCode !== 429)) {
    signals.push({
      code: "known_rejection",
      severity: "low",
      message: "Every prior attempt returned a permanent rejection, which is a non-ambiguous outcome.",
    });
  }

  const level = signals.some((signal) => signal.severity === "high")
    ? "high"
    : signals.some((signal) => signal.severity === "elevated")
      ? "elevated"
      : "low";
  const copy = level === "high"
    ? {
        headline: "Replay can duplicate a side effect",
        summary: "The transcript contains an ambiguous outcome or lacks receiver-side deduplication evidence. Explicit operator acknowledgement is required.",
      }
    : level === "elevated"
      ? {
          headline: "Replay needs receiver confirmation",
          summary: "The failure is retryable but multiple receiver-bound attempts increase operational uncertainty.",
        }
      : {
          headline: "Replay risk is bounded",
          summary: "The transcript shows a known rejection and/or a stable idempotency key, with no ambiguous acceptance signal.",
        };

  return { level, requiresAcknowledgement: level === "high", ...copy, signals };
}
