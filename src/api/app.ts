import { randomBytes } from "node:crypto";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import { Redis } from "ioredis";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import type { DeliveryQueue, Store } from "../domain/contracts.js";
import { diagnoseEvent } from "../domain/diagnosis.js";
import { createEvidenceBundle } from "../domain/evidence.js";
import { evaluateReplay } from "../domain/replay-guard.js";
import { assessReplayRisk } from "../domain/replay-risk.js";
import { assertSafeDestination, redactHeaders, sha256, UnsafeDestinationError, verifyWebhookSignature } from "../domain/security.js";
import { heartbeatAgeSeconds, heartbeatState } from "../domain/system.js";
import type { Endpoint } from "../domain/types.js";
import { deliveryJobKey, dispatchDeliveryIntent, scheduleDelivery } from "../dispatch.js";
import { openApiDocument } from "./openapi.js";

interface Dependencies {
  config: AppConfig;
  store: Store;
  queue: DeliveryQueue;
}

const endpointSchema = z.object({
  name: z.string().trim().min(2).max(80),
  destinationUrl: z.string().url(),
  signingSecret: z.string().min(16).max(256).nullable().optional(),
  signatureProfile: z.enum(["none", "generic", "github", "stripe"]).default("none"),
  maxAttempts: z.number().int().min(1).max(20).default(5),
}).superRefine((value, context) => {
  const hasSecret = Boolean(value.signingSecret);
  if (value.signatureProfile === "none" && hasSecret) {
    context.addIssue({ code: "custom", path: ["signatureProfile"], message: "Choose a signature profile when a signing secret is configured" });
  }
  if (value.signatureProfile !== "none" && !hasSecret) {
    context.addIssue({ code: "custom", path: ["signingSecret"], message: "A signing secret is required for this signature profile" });
  }
});

const rehearsalSchema = z.object({
  destinationUrl: z.string().url(),
  notes: z.string().max(500).default(""),
});

const replaySchema = z.object({
  destinationUrl: z.string().url(),
  reason: z.string().trim().min(10).max(500),
  acknowledgeRisk: z.boolean().default(false),
});

const replayPreflightSchema = replaySchema.extend({
  reason: z.string().trim().max(500).default(""),
});

export async function buildApp({ config, store, queue }: Dependencies): Promise<FastifyInstance> {
  const app = Fastify({
    logger: config.NODE_ENV === "test" ? false : { level: config.NODE_ENV === "production" ? "info" : "debug" },
    bodyLimit: config.MAX_PAYLOAD_BYTES,
    requestIdHeader: "x-request-id",
  });

  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "string" }, (request, body, done) => {
    try {
      const rawBody = String(body);
      (request as typeof request & { rawBody: string }).rawBody = rawBody;
      done(null, JSON.parse(rawBody));
    } catch (error) {
      done(error as Error, undefined);
    }
  });

  await app.register(cors, {
    origin: config.WEB_ORIGIN.split(",").map((origin) => origin.trim()),
    methods: ["GET", "POST", "OPTIONS"],
  });

  const rateLimitRedis = config.NODE_ENV === "test"
    ? null
    : new Redis(config.REDIS_URL, { connectTimeout: 1_000, maxRetriesPerRequest: 1 });
  await app.register(rateLimit, {
    global: true,
    max: config.OPERATOR_RATE_LIMIT_PER_MINUTE,
    timeWindow: 60_000,
    nameSpace: "replay-room:api-rate-limit:",
    skipOnError: false,
    ...(rateLimitRedis ? { redis: rateLimitRedis } : {}),
    errorResponseBuilder: (_request, context) => ({
      statusCode: 429,
      error: "API rate limit exceeded",
      retryAfterSeconds: Math.max(1, Math.ceil(context.ttl / 1_000)),
    }),
  });
  if (rateLimitRedis) {
    app.addHook("onClose", async () => {
      await rateLimitRedis.quit();
    });
  }

  app.get("/health", async (_request, reply) => {
    try {
      const databaseStartedAt = Date.now();
      await store.ping();
      const databaseLatencyMs = Date.now() - databaseStartedAt;
      const queueHealth = await queue.health();
      return {
        status: "ok",
        service: "replay-room-api",
        timestamp: new Date().toISOString(),
        dependencies: { databaseLatencyMs, queueLatencyMs: queueHealth.latencyMs },
      };
    } catch (error) {
      reply.code(503);
      return { status: "degraded", error: error instanceof Error ? error.message : "Required dependency unavailable" };
    }
  });

  app.get("/openapi.json", async (_request, reply) => {
    reply.header("cache-control", "public, max-age=300");
    return openApiDocument;
  });

  app.get("/api/stats", { preHandler: adminGuard(config) }, async () => store.stats());
  app.get("/api/system", { preHandler: adminGuard(config) }, async () => {
    const databaseStartedAt = Date.now();
    const now = Date.now();
    const staleBefore = new Date(now - 5 * 60_000).toISOString();
    const [, intentOutbox] = await Promise.all([store.ping(), store.deliveryIntentStats(staleBefore)]);
    const databaseLatencyMs = Date.now() - databaseStartedAt;
    const queueHealth = await queue.health();
    return {
      observedAt: new Date(now).toISOString(),
      deploy: {
        service: process.env.RENDER_SERVICE_NAME ?? "replay-room-api",
        commit: process.env.RENDER_GIT_COMMIT?.slice(0, 7) ?? "development",
        instance: process.env.RENDER_INSTANCE_ID ?? "local",
        environment: config.NODE_ENV,
        topology: config.EMBEDDED_WORKER ? "embedded-free" : "split-services",
      },
      components: {
        api: { state: "online", uptimeSeconds: Math.round(process.uptime()) },
        database: { state: "online", latencyMs: databaseLatencyMs },
        outbox: { state: intentOutbox.stale > 0 ? "degraded" : "online", ...intentOutbox },
        queue: { state: "online", latencyMs: queueHealth.latencyMs, jobs: queueHealth.jobs },
        worker: {
          state: heartbeatState(queueHealth.workerHeartbeat, 45_000, now),
          heartbeatAgeSeconds: heartbeatAgeSeconds(queueHealth.workerHeartbeat, now),
        },
        cron: {
          state: heartbeatState(queueHealth.cronHeartbeat, 15 * 60_000, now),
          heartbeatAgeSeconds: heartbeatAgeSeconds(queueHealth.cronHeartbeat, now),
        },
      },
    };
  });
  app.get("/api/endpoints", { preHandler: adminGuard(config) }, async () => {
    const endpoints = await store.listEndpoints();
    return endpoints.map(endpointView);
  });
  app.get("/api/endpoints/reliability", { preHandler: adminGuard(config) }, async (request) => {
    const query = z.object({ windowHours: z.coerce.number().int().min(1).max(168).default(24) }).parse(request.query);
    return store.endpointReliability(query.windowHours);
  });
  app.post("/api/endpoints", { preHandler: adminGuard(config) }, async (request, reply) => {
    const input = endpointSchema.parse(request.body);
    assertSafeDestination(input.destinationUrl, config.ALLOW_PRIVATE_TARGETS);
    const endpoint = await store.createEndpoint({
      name: input.name,
      ingestKey: `hook_${randomBytes(12).toString("base64url")}`,
      destinationUrl: input.destinationUrl,
      signingSecret: input.signingSecret ?? null,
      signatureProfile: input.signatureProfile,
      maxAttempts: input.maxAttempts,
    });
    reply.code(201);
    return endpointView(endpoint);
  });

  app.get("/api/events", { preHandler: adminGuard(config) }, async (request) => {
    const query = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }).parse(request.query);
    return store.listEvents(query.limit);
  });

  app.get("/api/events/:id", { preHandler: adminGuard(config) }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const event = await store.getEvent(id);
    if (!event) return reply.code(404).send({ error: "Event not found" });
    return { ...event, endpoint: endpointView(event.endpoint), diagnosis: diagnoseEvent(event), replayRisk: assessReplayRisk(event) };
  });

  app.get("/api/events/:id/evidence", { preHandler: adminGuard(config) }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const event = await store.getEvent(id);
    if (!event) return reply.code(404).send({ error: "Event not found" });
    const bundle = createEvidenceBundle(event, config.EVIDENCE_SIGNING_SECRET);
    reply.header("cache-control", "no-store");
    reply.header("content-disposition", `attachment; filename="replay-room-${id}.evidence.json"`);
    return bundle;
  });

  app.post("/api/events/:id/rehearse", { preHandler: adminGuard(config) }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = rehearsalSchema.parse(request.body);
    assertSafeDestination(input.destinationUrl, config.ALLOW_PRIVATE_TARGETS);
    const event = await store.getEvent(id);
    if (!event) return reply.code(404).send({ error: "Event not found" });
    const job = {
      eventId: id,
      mode: "rehearsal",
      cycleId: `rehearsal-${randomBytes(8).toString("hex")}`,
      attemptNumber: 1,
      destinationUrl: input.destinationUrl,
      actor: actorFrom(request.headers),
      reason: input.notes || "Operator-requested rehearsal",
    } as const;
    const scheduled = await scheduleDelivery({ store, queue, job, jobKey: deliveryJobKey(job) });
    reply.code(202);
    return { queued: true, eventId: id, mode: "rehearsal", deliveryIntentId: scheduled.intent.id };
  });

  app.post("/api/events/:id/replay/preflight", { preHandler: adminGuard(config) }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = replayPreflightSchema.parse(request.body);
    assertSafeDestination(input.destinationUrl, config.ALLOW_PRIVATE_TARGETS);
    const event = await store.getEvent(id);
    if (!event) return reply.code(404).send({ error: "Event not found" });
    const rehearsal = await store.latestRehearsal(id);
    const actor = actorFrom(request.headers);
    const risk = assessReplayRisk(event);
    const decision = evaluateReplay(event, rehearsal, {
      actor,
      reason: input.reason,
      destinationUrl: input.destinationUrl,
      acknowledgeRisk: input.acknowledgeRisk,
    }, risk);
    reply.header("cache-control", "no-store");
    return { ...decision, risk };
  });

  app.post("/api/events/:id/replay", { preHandler: adminGuard(config) }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = replaySchema.parse(request.body);
    assertSafeDestination(input.destinationUrl, config.ALLOW_PRIVATE_TARGETS);
    const event = await store.getEvent(id);
    if (!event) return reply.code(404).send({ error: "Event not found" });
    const rehearsal = await store.latestRehearsal(id);
    const actor = actorFrom(request.headers);
    const risk = assessReplayRisk(event);
    const decision = evaluateReplay(event, rehearsal, {
      actor,
      reason: input.reason,
      destinationUrl: input.destinationUrl,
      acknowledgeRisk: input.acknowledgeRisk,
    }, risk);
    if (!decision.allowed) {
      await store.addAudit({
        eventId: id,
        action: "replay.blocked",
        actor,
        reason: input.reason,
        metadata: { destinationUrl: input.destinationUrl, guardReasons: decision.reasons, guardChecks: decision.checks, riskLevel: risk.level, riskAcknowledged: input.acknowledgeRisk },
      });
      return reply.code(409).send({ error: "Replay guard blocked this request", reasons: decision.reasons });
    }
    const job = {
      eventId: id,
      mode: "replay",
      cycleId: `replay-${rehearsal!.id}`,
      attemptNumber: 1,
      destinationUrl: input.destinationUrl,
      actor,
      reason: input.reason,
    } as const;
    const jobKey = deliveryJobKey(job);
    const scheduled = await store.createDeliveryIntent(jobKey, job);
    await store.addAudit({
      eventId: id,
      action: scheduled.created ? "replay.approved" : "replay.duplicate_suppressed",
      actor,
      reason: input.reason,
      metadata: {
        destinationUrl: input.destinationUrl,
        guardReasons: decision.reasons,
        guardChecks: decision.checks,
        deliveryIntentId: scheduled.intent.id,
        jobKey,
        riskLevel: risk.level,
        riskAcknowledged: input.acknowledgeRisk,
      },
    });
    if (scheduled.intent.state !== "completed") {
      await dispatchDeliveryIntent(store, queue, scheduled.intent, new Date());
    }
    reply.code(202);
    return { queued: true, eventId: id, mode: "replay", deliveryIntentId: scheduled.intent.id, duplicate: !scheduled.created };
  });

  app.post("/ingest/:ingestKey", { config: { rateLimit: false } }, async (request, reply) => {
    const { ingestKey } = z.object({ ingestKey: z.string().min(12).max(100) }).parse(request.params);
    const endpoint = await store.getEndpointByIngestKey(ingestKey);
    if (!endpoint) return reply.code(404).send({ error: "Unknown ingest endpoint" });

    const rateLimit = await queue.consumeRateLimit(
      sha256(ingestKey).slice(0, 24),
      config.INGEST_RATE_LIMIT_PER_MINUTE,
      60,
    );
    reply.header("x-ratelimit-limit", config.INGEST_RATE_LIMIT_PER_MINUTE);
    reply.header("x-ratelimit-remaining", rateLimit.remaining);
    if (!rateLimit.allowed) {
      reply.header("retry-after", rateLimit.retryAfterSeconds);
      return reply.code(429).send({ error: "Ingest rate limit exceeded", retryAfterSeconds: rateLimit.retryAfterSeconds });
    }

    const rawPayload = (request as typeof request & { rawBody?: string }).rawBody ?? JSON.stringify(request.body ?? null);
    if (endpoint.signingSecret && endpoint.signatureProfile !== "none") {
      if (!verifyWebhookSignature(
        endpoint.signatureProfile,
        endpoint.signingSecret,
        rawPayload,
        request.headers,
        config.SIGNATURE_TOLERANCE_SECONDS,
      )) {
        return reply.code(401).send({ error: "Invalid webhook signature" });
      }
    }

    const result = await store.createEvent({
      endpointId: endpoint.id,
      idempotencyKey: stringHeader(request.headers["idempotency-key"] ?? request.headers["x-event-id"]),
      headers: redactHeaders(request.headers),
      payload: request.body ?? null,
      payloadSha256: sha256(rawPayload),
    });

    if (!result.duplicate) {
      await store.addAudit({
        eventId: result.event.id,
        action: "event.received",
        actor: "ingest",
        reason: null,
        metadata: { requestId: request.id, endpoint: endpoint.name },
      });
    }
    const job = { eventId: result.event.id, mode: "live", cycleId: "live", attemptNumber: 1 } as const;
    await scheduleDelivery({ store, queue, job, jobKey: deliveryJobKey(job) });

    reply.code(result.duplicate ? 200 : 202);
    return { accepted: true, duplicate: result.duplicate, eventId: result.event.id, status: result.event.status };
  });

  app.post("/demo/sink/:behavior", async (request, reply) => {
    if (config.NODE_ENV === "production") return reply.code(404).send({ error: "Not found" });
    const { behavior } = z.object({ behavior: z.enum(["accept", "reject", "retry"]) }).parse(request.params);
    if (behavior === "reject") return reply.code(400).send({ accepted: false, reason: "Permanent validation failure" });
    if (behavior === "retry") return reply.code(503).send({ accepted: false, reason: "Simulated downstream outage" });
    return { accepted: true, receivedAt: new Date().toISOString(), mode: request.headers["x-replay-room-mode"] };
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof z.ZodError) {
      return reply.code(400).send({ error: "Invalid request", issues: error.issues });
    }
    if (error instanceof UnsafeDestinationError) {
      return reply.code(400).send({ error: error.message });
    }
    if (typeof error === "object" && error !== null && "statusCode" in error && error.statusCode === 429) {
      return reply.code(429).send({
        error: "API rate limit exceeded",
        retryAfterSeconds: Number(reply.getHeader("retry-after") ?? 1),
      });
    }
    request.log.error(error);
    return reply.code(500).send({ error: "Internal server error", requestId: request.id });
  });

  return app;
}

function adminGuard(config: AppConfig) {
  return async (request: { headers: Record<string, unknown> }, reply: { code(status: number): { send(body: unknown): unknown } }) => {
    const token = stringHeader(request.headers.authorization)?.replace(/^Bearer\s+/i, "");
    if (token !== config.ADMIN_TOKEN) return reply.code(401).send({ error: "Unauthorized" });
  };
}

function actorFrom(headers: Record<string, unknown>): string {
  return stringHeader(headers["x-operator"])?.slice(0, 120) || "operator";
}

function stringHeader(value: unknown): string | null {
  if (Array.isArray(value)) return value[0] ? String(value[0]) : null;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function endpointView(endpoint: Endpoint) {
  const { signingSecret, ...safe } = endpoint;
  return { ...safe, signingSecretConfigured: Boolean(signingSecret) };
}
