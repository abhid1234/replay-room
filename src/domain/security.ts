import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { Resolver } from "node:dns/promises";
import { isIP } from "node:net";
import type { SignatureProfile } from "./types.js";

export type DestinationLookup = (
  hostname: string,
  signal?: AbortSignal,
) => Promise<Array<{ address: string; family: number }>>;

export interface DestinationDnsResolver {
  resolve4(hostname: string): Promise<string[]>;
  resolve6(hostname: string): Promise<string[]>;
  cancel(): void;
}

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

export interface ResolvedDestination {
  url: URL;
  addresses: [ResolvedAddress, ...ResolvedAddress[]];
}

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
  "stripe-signature",
  "x-hub-signature-256",
  "x-replay-signature",
]);

const PUBLIC_IPV6_SPACE = ipv6Cidr("2000::", 3);
const SPECIAL_IPV6_RANGES = [
  ipv6Cidr("2001::", 23),
  ipv6Cidr("2001:db8::", 32),
  ipv6Cidr("2002::", 16),
  ipv6Cidr("3fff::", 20),
];

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

export function verifyWebhookSignature(
  profile: Exclude<SignatureProfile, "none">,
  secret: string,
  rawPayload: string,
  headers: Record<string, string | string[] | undefined>,
  toleranceSeconds = 300,
  nowMs = Date.now(),
): boolean {
  if (profile === "generic") {
    return verifySignature(secret, rawPayload, headerValue(headers["x-replay-signature"]));
  }
  if (profile === "github") {
    return verifySignature(secret, rawPayload, headerValue(headers["x-hub-signature-256"]));
  }

  const stripeHeader = headerValue(headers["stripe-signature"]);
  const entries = stripeHeader.split(",").map((part) => part.trim().split("=", 2) as [string, string]);
  const timestamp = Number(entries.find(([key]) => key === "t")?.[1]);
  const signatures = entries.filter(([key]) => key === "v1").map(([, value]) => value);
  if (!Number.isInteger(timestamp) || signatures.length === 0) return false;
  if (Math.abs(Math.floor(nowMs / 1_000) - timestamp) > toleranceSeconds) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawPayload}`).digest("hex");
  return signatures.some((signature) => safeEqual(signature, expected));
}

export function signWebhookPayload(
  profile: Exclude<SignatureProfile, "none">,
  secret: string,
  rawPayload: string,
  nowMs = Date.now(),
): Record<string, string> {
  if (profile === "generic") return { "x-replay-signature": signPayload(secret, rawPayload) };
  if (profile === "github") return { "x-hub-signature-256": signPayload(secret, rawPayload) };
  const timestamp = Math.floor(nowMs / 1_000);
  const digest = createHmac("sha256", secret).update(`${timestamp}.${rawPayload}`).digest("hex");
  return { "stripe-signature": `t=${timestamp},v1=${digest}` };
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

export async function resolveSafeDestination(
  rawUrl: string,
  allowPrivate: boolean,
  lookupFn?: DestinationLookup,
  signal?: AbortSignal,
): Promise<ResolvedDestination> {
  const url = assertSafeDestination(rawUrl, allowPrivate);
  const literalAddress = normalizeAddress(url.hostname);
  const literalFamily = ipFamily(literalAddress);
  if (literalFamily) {
    const resolved = { address: literalAddress, family: literalFamily };
    return { url, addresses: [resolved] };
  }

  const addresses = await (lookupFn ?? defaultLookup)(url.hostname, signal);
  if (addresses.length === 0) throw new Error("Destination hostname did not resolve");
  const normalized = addresses.map(({ address }) => {
    const value = normalizeAddress(address);
    const family = ipFamily(value);
    if (!family) throw new UnsafeDestinationError("Destination DNS returned an invalid address");
    return { address: value, family };
  });
  if (!allowPrivate && normalized.some(({ address }) => isPrivateAddress(address))) {
    throw new UnsafeDestinationError("Destination resolves to a private or reserved network");
  }
  const [primary, ...alternates] = normalized;
  return { url, addresses: [primary!, ...alternates] };
}

export function createDestinationLookup(
  createResolver: () => DestinationDnsResolver = () => new Resolver(),
): DestinationLookup {
  return async (hostname, signal) => {
    if (signal?.aborted) throw new Error("Destination resolution was cancelled");
    const resolver = createResolver();
    const cancel = () => resolver.cancel();
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      const [ipv4Result, ipv6Result] = await Promise.allSettled([
        resolver.resolve4(hostname),
        resolver.resolve6(hostname),
      ]);
      if (signal?.aborted) throw new Error("Destination resolution was cancelled");

      const ipv4 = ipv4Result.status === "fulfilled"
        ? ipv4Result.value.map((address) => ({ address, family: 4 }))
        : [];
      const ipv6 = ipv6Result.status === "fulfilled"
        ? ipv6Result.value.map((address) => ({ address, family: 6 }))
        : [];
      const addresses = [...ipv6, ...ipv4];
      if (addresses.length > 0) return addresses;

      const unexpectedFailure = [ipv4Result, ipv6Result].find(
        (result) => result.status === "rejected" && !isEmptyDnsResult(result.reason),
      );
      if (unexpectedFailure?.status === "rejected") throw unexpectedFailure.reason;
      return [];
    } finally {
      signal?.removeEventListener("abort", cancel);
    }
  };
}

const defaultLookup = createDestinationLookup();

function isEmptyDnsResult(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  const code = String(error.code);
  return code === "ENODATA" || code === "ENOTFOUND";
}

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
    const value = ipv6ToBigInt(address);
    if (value === null || !inIpv6Cidr(value, PUBLIC_IPV6_SPACE)) return true;
    return SPECIAL_IPV6_RANGES.some((range) => inIpv6Cidr(value, range));
  }
  return false;
}

function normalizeAddress(value: string): string {
  return value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value;
}

function ipFamily(value: string): 4 | 6 | null {
  const family = isIP(value);
  return family === 4 || family === 6 ? family : null;
}

function ipv6Cidr(address: string, prefixLength: number): { network: bigint; prefixLength: number } {
  const network = ipv6ToBigInt(address);
  if (network === null) throw new Error(`Invalid IPv6 CIDR base: ${address}`);
  return { network, prefixLength };
}

function inIpv6Cidr(value: bigint, cidr: { network: bigint; prefixLength: number }): boolean {
  const shift = BigInt(128 - cidr.prefixLength);
  return value >> shift === cidr.network >> shift;
}

function ipv6ToBigInt(address: string): bigint | null {
  const value = normalizeAddress(address).toLowerCase().split("%", 1)[0]!;
  const halves = value.split("::");
  if (halves.length > 2) return null;
  const leading = halves[0] ? halves[0].split(":") : [];
  const trailing = halves[1] ? halves[1].split(":") : [];
  const missing = halves.length === 2 ? 8 - leading.length - trailing.length : 0;
  if (missing < 0 || (halves.length === 1 && leading.length !== 8)) return null;
  const groups = [...leading, ...Array.from({ length: missing }, () => "0"), ...trailing];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups.reduce((result, group) => (result << 16n) | BigInt(`0x${group}`), 0n);
}

function headerValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
