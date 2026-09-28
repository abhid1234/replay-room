import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

const REDACTED_HEADERS = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "proxy-authorization",
]);

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function signPayload(secret: string, rawPayload: string): string {
  return `sha256=${createHmac("sha256", secret).update(rawPayload).digest("hex")}`;
}

export function verifySignature(secret: string, rawPayload: string, signature: string): boolean {
  const expected = Buffer.from(signPayload(secret, rawPayload));
  const actual = Buffer.from(signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function redactHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [
      name.toLowerCase(),
      REDACTED_HEADERS.has(name.toLowerCase()) ? "[REDACTED]" : Array.isArray(value) ? value.join(", ") : value ?? "",
    ]),
  );
}

export function assertSafeDestination(rawUrl: string, allowPrivate: boolean): URL {
  const url = new URL(rawUrl);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Destination must use http or https");
  }
  if (url.username || url.password) {
    throw new Error("Destination URLs cannot include credentials");
  }
  if (!allowPrivate && isPrivateHostname(url.hostname)) {
    throw new Error("Private-network destinations are disabled");
  }
  return url;
}

function isPrivateHostname(hostname: string): boolean {
  const value = hostname.toLowerCase();
  if (value === "localhost" || value.endsWith(".local") || value.endsWith(".internal")) return true;
  if (isIP(value) === 4) {
    const [a = 0, b = 0] = value.split(".").map(Number);
    return a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  if (isIP(value) === 6) {
    return value === "::1" || value.startsWith("fc") || value.startsWith("fd") || value.startsWith("fe80");
  }
  return false;
}
