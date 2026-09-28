export type ComponentState = "online" | "degraded" | "waiting";

export function heartbeatState(
  heartbeat: string | null,
  staleAfterMs: number,
  now = Date.now(),
): ComponentState {
  if (!heartbeat) return "waiting";
  const observedAt = Date.parse(heartbeat);
  if (!Number.isFinite(observedAt) || now - observedAt > staleAfterMs) return "degraded";
  return "online";
}

export function heartbeatAgeSeconds(heartbeat: string | null, now = Date.now()): number | null {
  if (!heartbeat) return null;
  const observedAt = Date.parse(heartbeat);
  if (!Number.isFinite(observedAt)) return null;
  return Math.max(0, Math.round((now - observedAt) / 1_000));
}
