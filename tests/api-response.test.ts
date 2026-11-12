import { describe, expect, it } from "vitest";
import { ApiRequestError, isApiOutage, readApiResponse, unreachableError } from "../web/src/api-response.js";

const API = "https://replay-room-api.onrender.com";

describe("console API responses", () => {
  it("returns the parsed body of a successful JSON response", () => {
    expect(readApiResponse<{ events: unknown[] }>(200, true, '{"events":[]}', API)).toEqual({ events: [] });
  });

  it("reports a platform HTML error page as an outage instead of a JSON parse error", () => {
    const html = "<!DOCTYPE html><html><body>Service Unavailable</body></html>";
    let error: unknown;
    try { readApiResponse(503, false, html, API); } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(ApiRequestError);
    expect((error as ApiRequestError).status).toBe(503);
    expect((error as Error).message).toBe(`The API at ${API} is unavailable (HTTP 503). It may be asleep, or its database may be offline.`);
    expect(isApiOutage(error)).toBe(true);
  });

  it("keeps the API's own error message and does not treat a 401 as an outage", () => {
    let error: unknown;
    try { readApiResponse(401, false, '{"error":"Invalid operator token"}', API); } catch (caught) { error = caught; }
    expect((error as Error).message).toBe("Invalid operator token");
    expect(isApiOutage(error)).toBe(false);
  });

  it("treats no answer at all as an outage", () => {
    const error = unreachableError(API);
    expect(error.status).toBe(0);
    expect(error.message).toBe(`Can't reach the API at ${API}. It may be asleep or offline.`);
    expect(isApiOutage(error)).toBe(true);
  });

  it("rejects a successful response that is not JSON", () => {
    expect(() => readApiResponse(200, true, "<html></html>", API)).toThrow("sent a response the console can't read");
  });
});
