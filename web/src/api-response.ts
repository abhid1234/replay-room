// Turns an API response into data or a clear error. Render answers a sleeping or failing
// service with its own HTML page, and a dropped connection never answers at all, so the
// console must not assume every response is JSON from Replay Room.
export class ApiRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiRequestError";
  }
}

export function readApiResponse<T>(status: number, ok: boolean, text: string, apiBase: string): T {
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  const apiMessage = body !== null && typeof body === "object" && typeof (body as { error?: unknown }).error === "string"
    ? (body as { error: string }).error
    : null;
  if (!ok) {
    if (apiMessage) throw new ApiRequestError(apiMessage, status);
    throw new ApiRequestError(status >= 500
      ? `The API at ${apiBase} is unavailable (HTTP ${status}). It may be asleep, or its database may be offline.`
      : `The API at ${apiBase} answered HTTP ${status}.`, status);
  }
  if (body === null) throw new ApiRequestError(`The API at ${apiBase} sent a response the console can't read.`, status);
  return body as T;
}

export function unreachableError(apiBase: string): ApiRequestError {
  return new ApiRequestError(`Can't reach the API at ${apiBase}. It may be asleep or offline.`, 0);
}

// An outage is no answer at all or a 5xx; a 401 or 404 is the API working and saying no.
export function isApiOutage(error: unknown): boolean {
  return error instanceof ApiRequestError && (error.status === 0 || error.status >= 500);
}
