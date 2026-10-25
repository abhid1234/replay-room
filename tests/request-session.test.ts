import { describe, expect, it } from "vitest";
import { OperatorRequestSession, RequestSessionCancelledError } from "../web/src/request-session.js";

describe("operator request session", () => {
  it("aborts and rejects every in-flight request when the session is invalidated", async () => {
    const session = new OperatorRequestSession();
    const releases: Array<() => void> = [];
    const signals: AbortSignal[] = [];
    const operations = [1, 2].map((value) => session.run(async (signal) => {
      signals.push(signal);
      await new Promise<void>((resolve) => releases.push(resolve));
      return value;
    }));

    await Promise.resolve();
    session.invalidate();
    releases.forEach((release) => release());

    expect(signals).toHaveLength(2);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    await expect(Promise.all(operations)).rejects.toBeInstanceOf(RequestSessionCancelledError);
  });

  it("returns current results and preserves ordinary request failures", async () => {
    const session = new OperatorRequestSession();

    await expect(session.run(async () => "current")).resolves.toBe("current");
    await expect(session.run(async () => { throw new Error("network unavailable"); }))
      .rejects.toThrow("network unavailable");
  });
});
