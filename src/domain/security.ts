import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export type DestinationLookup = (hostname: string) => Promise<Array<{ address: string; family: number }>>;

export class UnsafeDestinationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeDestinationError";
  }
}

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
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UnsafeDestinationError("Destination must be a valid URL");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new UnsafeDestinationError("Destination must use http or https");
  }
  if (url.username || url.password) {
    throw new UnsafeDestinationError("Destination URLs cannot include credentials");
  }
  if (!allowPrivate && isPrivateHostname(url.hostname)) {
    throw new UnsafeDestinationError("Private-network destinations are disabled");
  }
  return url;
}

export async function assertSafeResolvedDestination(
  rawUrl: string,
  allowPrivate: boolean,
  lookupFn?: DestinationLookup,
): Promise<URL> {
  const url = assertSafeDestination(rawUrl, allowPrivate);
  if (allowPrivate || isIP(normalizeAddress(url.hostname))) return url;
  const addresses = await (lookupFn ?? defaultLookup)(url.hostname);
  if (addresses.length === 0) throw new Error("Destination hostname did not resolve");
  if (addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new UnsafeDestinationError("Destination resolves to a private or reserved network");
  }
  return url;
}

const defaultLookup: DestinationLookup = (hostname) => lookup(hostname, { all: true, verbatim: true });

function isPrivateHostname(hostname: string): boolean {
  const value = hostname.toLowerCase();
  if (value === "localhost" || value.endsWith(".local") || value.endsWith(".internal")) return true;
  return isPrivateAddress(value);
}

function isPrivateAddress(value: string): boolean {
  const address = normalizeAddress(value);
  if (isIP(address) === 4) {
    const [a = 0, b = 0] = address.split(".").map(Number);
    return a === 0
      || a === 10
      || a === 127
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && (b === 0 || b === 88 || b === 168))
      || (a === 198 && (b === 18 || b === 19 || b === 51))
      || (a === 203 && b === 0)
      || a >= 224;
  }
  if (isIP(address) === 6) {
    const normalized = address.toLowerCase();
    if (normalized.startsWith("::ffff:")) return isPrivateAddress(normalized.slice(7));
    return normalized === "::"
      || normalized === "::1"
      || normalized.startsWith("fc")
      || normalized.startsWith("fd")
      || /^fe[89ab]/.test(normalized)
      || normalized.startsWith("2001:db8:");
  }
  return false;
}

function normalizeAddress(value: string): string {
  return value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value;
}
