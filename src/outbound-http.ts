import { request as httpRequest, type RequestOptions } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { StringDecoder } from "node:string_decoder";
import type { ResolvedDestination } from "./domain/security.js";

export interface DestinationPostRequest {
  destination: ResolvedDestination;
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
}

export interface DestinationPostResponse {
  status: number;
  body: string;
  retryAfter: string | null;
}

export type DestinationPost = (request: DestinationPostRequest) => Promise<DestinationPostResponse>;

export interface PinnedRequestOptions extends RequestOptions {
  autoSelectFamily: boolean;
  autoSelectFamilyAttemptTimeout: number;
  servername?: string;
  rejectUnauthorized?: boolean;
}

const MAX_RESPONSE_BYTES = 4_096;
const ADDRESS_FAMILY_ATTEMPT_TIMEOUT_MS = 250;

export const postPinnedDestination: DestinationPost = ({ destination, headers, body, timeoutMs }) => {
  const { url } = destination;
  const request = (url.protocol === "https:" ? httpsRequest : httpRequest) as typeof httpRequest;
  const requestOptions = createPinnedRequestOptions(destination, headers);

  return new Promise((resolve, reject) => {
    let settled = false;
    let deadline: NodeJS.Timeout | undefined;
    const clearDeadline = () => {
      if (deadline) clearTimeout(deadline);
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      clearDeadline();
      reject(error);
    };
    const outgoing = request(requestOptions, (incoming) => {
      const chunks: Buffer[] = [];
      let capturedBytes = 0;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearDeadline();
        resolve({
          status: incoming.statusCode ?? 0,
          body: decodeCapturedBody(chunks),
          retryAfter: firstHeader(incoming.headers["retry-after"]),
        });
      };

      incoming.on("data", (chunk: Buffer | string) => {
        if (settled) return;
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        const remaining = MAX_RESPONSE_BYTES - capturedBytes;
        const captured = buffer.subarray(0, remaining);
        chunks.push(captured);
        capturedBytes += captured.length;
        if (capturedBytes >= MAX_RESPONSE_BYTES) {
          finish();
          incoming.destroy();
        }
      });
      incoming.on("end", finish);
      incoming.on("aborted", () => fail(new Error("Destination response was aborted")));
      incoming.on("error", fail);
    });

    deadline = setTimeout(
      () => {
        fail(new Error(`Delivery timed out after ${timeoutMs}ms`));
        outgoing.destroy();
      },
      timeoutMs,
    );
    deadline.unref();
    outgoing.on("error", fail);
    outgoing.end(body);
  });
};

export function createPinnedRequestOptions(
  destination: ResolvedDestination,
  headers: Record<string, string>,
): PinnedRequestOptions {
  const { url } = destination;
  const port = url.port || (url.protocol === "https:" ? "443" : "80");
  const originalHostname = unbracket(url.hostname);
  const primaryAddress = destination.addresses[0];
  const pinnedLookup: LookupFunction = (_hostname, options, callback) => {
    if (options.all) {
      callback(null, destination.addresses);
      return;
    }
    callback(null, primaryAddress.address, primaryAddress.family);
  };

  return {
    protocol: url.protocol,
    hostname: isIP(originalHostname) ? primaryAddress.address : originalHostname,
    port,
    method: "POST",
    path: `${url.pathname}${url.search}`,
    headers: { ...headers, host: url.host },
    agent: false,
    lookup: pinnedLookup,
    autoSelectFamily: destination.addresses.length > 1,
    autoSelectFamilyAttemptTimeout: ADDRESS_FAMILY_ATTEMPT_TIMEOUT_MS,
    ...(url.protocol === "https:" ? {
      rejectUnauthorized: true,
      ...(!isIP(originalHostname) ? { servername: originalHostname } : {}),
    } : {}),
  };
}

function unbracket(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

function decodeCapturedBody(chunks: Buffer[]): string {
  const decoder = new StringDecoder("utf8");
  const decoded = decoder.write(Buffer.concat(chunks));
  const captured: string[] = [];
  let capturedBytes = 0;
  for (const character of decoded) {
    const characterBytes = Buffer.byteLength(character);
    if (capturedBytes + characterBytes > MAX_RESPONSE_BYTES) break;
    captured.push(character);
    capturedBytes += characterBytes;
  }
  return captured.join("");
}

function firstHeader(value: string | string[] | undefined): string | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}
