import { describe, expect, it, vi } from "vitest";
import { startAuthorizedPolling, type PollResult } from "../web/src/polling.js";

// Regression: ISSUE-001 — an invalid admin token kept polling five protected endpoints every five seconds
// Found by /qa on 2026-09-29
// Report: .gstack/qa-reports/qa-report-replay-room-web-onrender-com-2026-09-29.md
describe("authenticated console polling", () => {
  it("does not arm the polling interval after the initial request is unauthorized", async () => {
    const refresh = vi.fn(async () => "unauthorized" as PollResult);
    const setInterval = vi.fn(() => 17);
    const clearInterval = vi.fn();

    const stop = startAuthorizedPolling(refresh, 5_000, { setInterval, clearInterval });
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledWith(false));

    expect(setInterval).not.toHaveBeenCalled();
    expect(clearInterval).not.toHaveBeenCalled();
    stop();
  });

  it("clears an established polling interval when authorization later expires", async () => {
    const results: PollResult[] = ["ok", "unauthorized"];
    const refresh = vi.fn(async () => results.shift() ?? "ok");
    let intervalHandler: (() => void) | undefined;
    const setInterval = vi.fn((handler: () => void) => {
      intervalHandler = handler;
      return 23;
    });
    const clearInterval = vi.fn();

    startAuthorizedPolling(refresh, 5_000, { setInterval, clearInterval });
    await vi.waitFor(() => expect(setInterval).toHaveBeenCalledOnce());
    intervalHandler?.();
    await vi.waitFor(() => expect(clearInterval).toHaveBeenCalledWith(23));

    expect(refresh).toHaveBeenNthCalledWith(1, false);
    expect(refresh).toHaveBeenNthCalledWith(2, true);
  });
});
