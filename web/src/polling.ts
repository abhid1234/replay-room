export type PollResult = "ok" | "unauthorized" | "retryable";

type Refresh = (silent: boolean) => Promise<PollResult>;
type TimerHandle = unknown;
type PollingTimers = {
  setTimeout: (handler: () => void, delayMs: number) => TimerHandle;
  clearTimeout: (handle: TimerHandle) => void;
};
type PollingVisibility = {
  isVisible: () => boolean;
  subscribe: (handler: () => void) => () => void;
};

export interface PollingOptions {
  intervalMs?: number;
  maxBackoffMs?: number;
  timers?: PollingTimers;
  visibility?: PollingVisibility;
}

const browserTimers: PollingTimers = {
  setTimeout: (handler, delay) => window.setTimeout(handler, delay),
  clearTimeout: (handle) => window.clearTimeout(handle as number),
};

const browserVisibility: PollingVisibility = {
  isVisible: () => document.visibilityState === "visible",
  subscribe: (handler) => {
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  },
};

export function startAuthorizedPolling(refresh: Refresh, options: PollingOptions = {}) {
  const intervalMs = options.intervalMs ?? 5_000;
  const maxBackoffMs = options.maxBackoffMs ?? 60_000;
  const timers = options.timers ?? browserTimers;
  const visibility = options.visibility ?? browserVisibility;
  let stopped = false;
  let inFlight = false;
  let attempted = false;
  let consecutiveFailures = 0;
  let timer: TimerHandle | null = null;

  const clearTimer = () => {
    if (timer === null) return;
    timers.clearTimeout(timer);
    timer = null;
  };

  const schedule = (delayMs: number) => {
    clearTimer();
    if (stopped || !visibility.isVisible()) return;
    timer = timers.setTimeout(() => {
      timer = null;
      void poll(true);
    }, delayMs);
  };

  const poll = async (silent: boolean) => {
    if (stopped || inFlight || !visibility.isVisible()) return;
    attempted = true;
    inFlight = true;
    const result = await refresh(silent).catch(() => "retryable" as const);
    inFlight = false;
    if (stopped) return;
    if (result === "unauthorized") {
      stop();
      return;
    }
    if (result === "retryable") {
      consecutiveFailures += 1;
      schedule(Math.min(maxBackoffMs, intervalMs * (2 ** consecutiveFailures)));
      return;
    }
    consecutiveFailures = 0;
    schedule(intervalMs);
  };

  const unsubscribe = visibility.subscribe(() => {
    clearTimer();
    if (visibility.isVisible() && !inFlight) void poll(attempted);
  });

  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearTimer();
    unsubscribe();
  };

  void poll(false);
  return stop;
}
