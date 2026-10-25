import { describe, expect, it, vi } from "vitest";
import { startAuthorizedPolling, type PollResult, type PollingOptions } from "../web/src/polling.js";

function pollingHarness() {
  let timeoutHandler: (() => void) | undefined;
  let visibilityHandler: (() => void) | undefined;
  let visible = true;
  const setTimeout = vi.fn((handler: () => void) => {
    timeoutHandler = handler;
    return 17;
  });
  const clearTimeout = vi.fn();
  const unsubscribe = vi.fn();
  const options: PollingOptions = {
    intervalMs: 5_000,
    maxBackoffMs: 60_000,
    timers: { setTimeout, clearTimeout },
    visibility: {
      isVisible: () => visible,
      subscribe: (handler) => {
        visibilityHandler = handler;
        return unsubscribe;
      },
    },
  };
  return {
    options,
    setTimeout,
    clearTimeout,
    unsubscribe,
    runTimeout: () => timeoutHandler?.(),
    setVisible(next: boolean) {
      visible = next;
      visibilityHandler?.();
    },
  };
}

// Regression: ISSUE-001 — an invalid admin token kept polling protected endpoints every five seconds.
// Found by /qa on 2026-09-29.
describe("authenticated console polling", () => {
  it("does not schedule another request after the initial request is unauthorized", async () => {
    const refresh = vi.fn(async () => "unauthorized" as PollResult);
    const harness = pollingHarness();

    const stop = startAuthorizedPolling(refresh, harness.options);
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledWith(false));
    await vi.waitFor(() => expect(harness.unsubscribe).toHaveBeenCalledOnce());

    expect(harness.setTimeout).not.toHaveBeenCalled();
    stop();
  });

  it("never overlaps refreshes and schedules from completion time", async () => {
    let resolveRefresh: ((result: PollResult) => void) | undefined;
    const refresh = vi.fn(() => new Promise<PollResult>((resolve) => { resolveRefresh = resolve; }));
    const harness = pollingHarness();

    const stop = startAuthorizedPolling(refresh, harness.options);
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(harness.setTimeout).not.toHaveBeenCalled();

    resolveRefresh?.("ok");
    await vi.waitFor(() => expect(harness.setTimeout).toHaveBeenCalledWith(expect.any(Function), 5_000));
    harness.runTimeout();
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
    harness.runTimeout();
    expect(refresh).toHaveBeenCalledTimes(2);
    stop();
  });

  it("backs off retryable failures and resets after recovery", async () => {
    const results: PollResult[] = ["retryable", "retryable", "retryable", "retryable", "ok"];
    const refresh = vi.fn(async () => results.shift() ?? "ok");
    const harness = pollingHarness();

    const stop = startAuthorizedPolling(refresh, harness.options);
    await vi.waitFor(() => expect(harness.setTimeout).toHaveBeenLastCalledWith(expect.any(Function), 10_000));
    harness.runTimeout();
    await vi.waitFor(() => expect(harness.setTimeout).toHaveBeenLastCalledWith(expect.any(Function), 20_000));
    harness.runTimeout();
    await vi.waitFor(() => expect(harness.setTimeout).toHaveBeenLastCalledWith(expect.any(Function), 40_000));
    harness.runTimeout();
    await vi.waitFor(() => expect(harness.setTimeout).toHaveBeenLastCalledWith(expect.any(Function), 60_000));
    harness.runTimeout();
    await vi.waitFor(() => expect(harness.setTimeout).toHaveBeenLastCalledWith(expect.any(Function), 5_000));

    expect(refresh).toHaveBeenNthCalledWith(1, false);
    expect(refresh).toHaveBeenNthCalledWith(2, true);
    expect(refresh).toHaveBeenNthCalledWith(3, true);
    expect(refresh).toHaveBeenCalledTimes(5);
    stop();
  });

  it("pauses while hidden and refreshes immediately when visible again", async () => {
    const refresh = vi.fn(async () => "ok" as PollResult);
    const harness = pollingHarness();

    const stop = startAuthorizedPolling(refresh, harness.options);
    await vi.waitFor(() => expect(harness.setTimeout).toHaveBeenCalledOnce());
    harness.setVisible(false);
    expect(harness.clearTimeout).toHaveBeenCalledWith(17);

    harness.setVisible(true);
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
    expect(refresh).toHaveBeenNthCalledWith(2, true);
    stop();
    expect(harness.unsubscribe).toHaveBeenCalledOnce();
  });
});
