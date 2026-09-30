export type PollResult = "ok" | "unauthorized" | "retryable";

type Refresh = (silent: boolean) => Promise<PollResult>;
type TimerHandle = unknown;
type PollingTimers = {
  setInterval: (handler: () => void, intervalMs: number) => TimerHandle;
  clearInterval: (handle: TimerHandle) => void;
};

const browserTimers: PollingTimers = {
  setInterval: (handler, delay) => window.setInterval(handler, delay),
  clearInterval: (handle) => window.clearInterval(handle as number),
};

export function startAuthorizedPolling(
  refresh: Refresh,
  intervalMs = 5_000,
  timers: PollingTimers = browserTimers,
) {
  let stopped = false;
  let timer: TimerHandle | null = null;

  const stop = () => {
    stopped = true;
    if (timer !== null) {
      timers.clearInterval(timer);
      timer = null;
    }
  };

  const poll = async (silent: boolean) => {
    const result = await refresh(silent);
    if (stopped) return;
    if (result === "unauthorized") {
      stop();
      return;
    }
    if (!silent && timer === null) {
      timer = timers.setInterval(() => void poll(true), intervalMs);
    }
  };

  void poll(false);
  return stop;
}
