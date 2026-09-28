import type { EndpointReliability } from "./types.js";

export function reliabilityState(
  total: number,
  delivered: number,
  retrying: number,
  deadLetter: number,
): EndpointReliability["state"] {
  if (total === 0) return "idle";
  const rate = deliveryRate(delivered, deadLetter);
  if (rate < 95) return "breached";
  if (retrying > 0 || deadLetter > 0 || rate < 99 || delivered === 0) return "at_risk";
  return "healthy";
}

export function deliveryRate(delivered: number, deadLetter: number): number {
  const terminal = delivered + deadLetter;
  return terminal === 0 ? 100 : Math.round(delivered / terminal * 1_000) / 10;
}
