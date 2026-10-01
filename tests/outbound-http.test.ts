import { createServer, type IncomingMessage, type Server } from "node:http";
import { describe, expect, it } from "vitest";
import { createPinnedRequestOptions, postPinnedDestination } from "../src/outbound-http.js";

describe("pinned outbound HTTP", () => {
  it("connects to the validated address, preserves the original Host header, and does not follow redirects", async () => {
    let redirectedRequests = 0;
    const redirectTarget = createServer((_request, response) => {
      redirectedRequests += 1;
      response.writeHead(200).end("internal response");
    });
    const redirectTargetPort = await listen(redirectTarget);

    let received = { method: "", url: "", host: "", contentType: "", body: "" };
    const receiver = createServer(async (request, response) => {
      received = {
        method: request.method ?? "",
        url: request.url ?? "",
        host: request.headers.host ?? "",
        contentType: request.headers["content-type"] ?? "",
        body: await readBody(request),
      };
      response.writeHead(302, { location: `http://127.0.0.1:${redirectTargetPort}/secret` }).end("redirect blocked");
    });
    const receiverPort = await listen(receiver);

    try {
      const response = await postPinnedDestination({
        destination: {
          url: new URL(`http://safe.receiver.test:${receiverPort}/webhooks?source=replay-room`),
          addresses: [{ address: "127.0.0.1", family: 4 }],
        },
        headers: { "content-type": "application/json" },
        body: "{\"ok\":true}",
        timeoutMs: 1_000,
      });

      expect(response).toEqual({ status: 302, body: "redirect blocked", retryAfter: null });
      expect(received).toEqual({
        method: "POST",
        url: "/webhooks?source=replay-room",
        host: `safe.receiver.test:${receiverPort}`,
        contentType: "application/json",
        body: "{\"ok\":true}",
      });
      expect(redirectedRequests).toBe(0);
    } finally {
      await Promise.all([close(receiver), close(redirectTarget)]);
    }
  });

  it("captures only the Retry-After response header needed by the scheduler", async () => {
    const receiver = createServer((_request, response) => {
      response.writeHead(429, { "retry-after": "120", "x-private-debug": "do-not-store" }).end("slow down");
    });
    const receiverPort = await listen(receiver);

    try {
      const response = await postPinnedDestination({
        destination: {
          url: new URL(`http://receiver.test:${receiverPort}/webhooks`),
          addresses: [{ address: "127.0.0.1", family: 4 }],
        },
        headers: {},
        body: "{}",
        timeoutMs: 1_000,
      });

      expect(response).toEqual({ status: 429, body: "slow down", retryAfter: "120" });
      expect(response).not.toHaveProperty("headers");
    } finally {
      await close(receiver);
    }
  });

  it("captures at most 4096 response bytes", async () => {
    const receiver = createServer((_request, response) => response.writeHead(422).end("x".repeat(8_192)));
    const receiverPort = await listen(receiver);

    try {
      const response = await postPinnedDestination({
        destination: {
          url: new URL(`http://receiver.test:${receiverPort}/webhooks`),
          addresses: [{ address: "127.0.0.1", family: 4 }],
        },
        headers: {},
        body: "{}",
        timeoutMs: 1_000,
      });

      expect(response.status).toBe(422);
      expect(Buffer.byteLength(response.body)).toBe(4_096);
    } finally {
      await close(receiver);
    }
  });

  it("does not split a multibyte character at the response boundary", async () => {
    const receiver = createServer((_request, response) => response.writeHead(422).end(`${"x".repeat(4_095)}😀`));
    const receiverPort = await listen(receiver);

    try {
      const response = await postPinnedDestination({
        destination: {
          url: new URL(`http://receiver.test:${receiverPort}/webhooks`),
          addresses: [{ address: "127.0.0.1", family: 4 }],
        },
        headers: {},
        body: "{}",
        timeoutMs: 1_000,
      });

      expect(Buffer.byteLength(response.body)).toBe(4_095);
      expect(response.body.endsWith("�")).toBe(false);
    } finally {
      await close(receiver);
    }
  });

  it("enforces a total wall-clock deadline", async () => {
    const receiver = createServer(() => undefined);
    const receiverPort = await listen(receiver);

    try {
      await expect(postPinnedDestination({
        destination: {
          url: new URL(`http://receiver.test:${receiverPort}/webhooks`),
          addresses: [{ address: "127.0.0.1", family: 4 }],
        },
        headers: {},
        body: "{}",
        timeoutMs: 50,
      })).rejects.toThrow("Delivery timed out after 50ms");
    } finally {
      await close(receiver);
    }
  });

  it("enforces the same deadline after response headers and a partial body arrive", async () => {
    const receiver = createServer((_request, response) => {
      response.writeHead(200);
      response.write("partial");
    });
    const receiverPort = await listen(receiver);

    try {
      await expect(postPinnedDestination({
        destination: {
          url: new URL(`http://receiver.test:${receiverPort}/webhooks`),
          addresses: [{ address: "127.0.0.1", family: 4 }],
        },
        headers: {},
        body: "{}",
        timeoutMs: 50,
      })).rejects.toThrow("Delivery timed out after 50ms");
    } finally {
      await close(receiver);
    }
  });

  it("closes an endless response as soon as the capture limit is reached", async () => {
    let resolveClosed!: () => void;
    const closed = new Promise<void>((resolve) => { resolveClosed = resolve; });
    const receiver = createServer((_request, response) => {
      const interval = setInterval(() => response.write("x".repeat(4_096)), 5);
      response.on("close", () => {
        clearInterval(interval);
        resolveClosed();
      });
      response.writeHead(200);
      response.write("x".repeat(4_096));
    });
    const receiverPort = await listen(receiver);

    try {
      const response = await postPinnedDestination({
        destination: {
          url: new URL(`http://receiver.test:${receiverPort}/stream`),
          addresses: [{ address: "127.0.0.1", family: 4 }],
        },
        headers: {},
        body: "{}",
        timeoutMs: 1_000,
      });

      await closed;
      expect(Buffer.byteLength(response.body)).toBe(4_096);
    } finally {
      await close(receiver);
    }
  });

  it("falls back across the validated address set without another DNS lookup", async () => {
    const receiver = createServer((_request, response) => response.writeHead(204).end());
    const receiverPort = await listen(receiver);

    try {
      const response = await postPinnedDestination({
        destination: {
          url: new URL(`http://dual-stack.receiver.test:${receiverPort}/webhooks`),
          addresses: [
            { address: "::1", family: 6 },
            { address: "127.0.0.1", family: 4 },
          ],
        },
        headers: {},
        body: "{}",
        timeoutMs: 1_000,
      });

      expect(response.status).toBe(204);
    } finally {
      await close(receiver);
    }
  });

  it("opens a new pinned connection when the same hostname resolves to a new address", async () => {
    let firstReceiverHits = 0;
    let secondReceiverHits = 0;
    const firstReceiver = createServer((_request, response) => {
      firstReceiverHits += 1;
      response.writeHead(204).end();
    });
    const receiverPort = await listen(firstReceiver);
    const secondReceiver = createServer((_request, response) => {
      secondReceiverHits += 1;
      response.writeHead(204).end();
    });
    await listenIpv6(secondReceiver, receiverPort);

    const url = new URL(`http://rotating.receiver.test:${receiverPort}/webhooks`);
    try {
      await postPinnedDestination({
        destination: { url, addresses: [{ address: "127.0.0.1", family: 4 }] },
        headers: {},
        body: "{}",
        timeoutMs: 1_000,
      });
      await postPinnedDestination({
        destination: { url, addresses: [{ address: "::1", family: 6 }] },
        headers: {},
        body: "{}",
        timeoutMs: 1_000,
      });

      expect(firstReceiverHits).toBe(1);
      expect(secondReceiverHits).toBe(1);
    } finally {
      await Promise.all([close(firstReceiver), close(secondReceiver)]);
    }
  });

  it("preserves the original HTTPS identity while pinning connection addresses", () => {
    const options = createPinnedRequestOptions({
      url: new URL("https://hooks.example:8443/webhooks"),
      addresses: [{ address: "93.184.216.34", family: 4 }],
    }, { "content-type": "application/json" });

    expect(options).toMatchObject({
      hostname: "hooks.example",
      port: "8443",
      servername: "hooks.example",
      rejectUnauthorized: true,
      agent: false,
      headers: { host: "hooks.example:8443" },
    });
  });
});

async function listen(server: Server, host = "127.0.0.1", port = 0): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not expose a TCP port");
  return address.port;
}

async function listenIpv6(server: Server, port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen({ port, host: "::1", ipv6Only: true }, () => resolve());
  });
}

async function close(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}
