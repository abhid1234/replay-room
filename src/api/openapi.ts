const bearerSecurity = [{ bearerAuth: [] }];
const dateTime = { type: "string", format: "date-time" } as const;
const uuid = { type: "string", format: "uuid" } as const;
const uri = { type: "string", format: "uri" } as const;
const sha256 = { type: "string", pattern: "^[a-f0-9]{64}$" } as const;
const nonnegativeInteger = { type: "integer", minimum: 0 } as const;
const eventStatus = { enum: ["queued", "delivering", "retrying", "delivered", "dead_letter"] } as const;

export const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "Replay Room API",
    version: "0.1.0",
    summary: "Capture, diagnose, rehearse, and safely replay webhook incidents.",
    description: "Public ingest is separated from bearer-protected operator endpoints. Replays require passing rehearsal evidence bound to the exact payload digest and destination.",
    license: { name: "MIT", identifier: "MIT" },
  },
  externalDocs: { url: "https://github.com/abhid1234/replay-room", description: "Source, architecture, fixtures, and deployment guide" },
  tags: [
    { name: "public", description: "Unauthenticated health and webhook receipt" },
    { name: "operator", description: "Bearer-protected incident operations" },
  ],
  paths: {
    "/health": {
      get: {
        tags: ["public"],
        summary: "Check Postgres and Key Value connectivity",
        operationId: "getHealth",
        responses: { "200": response("Service and required dependencies are healthy", "Health"), "503": response("A required dependency is unavailable", "Problem") },
      },
    },
    "/openapi.json": {
      get: {
        tags: ["public"],
        summary: "Read this API contract",
        operationId: "getOpenApi",
        responses: { "200": { description: "OpenAPI 3.1 document" } },
      },
    },
    "/ingest/{ingestKey}": {
      post: {
        tags: ["public"],
        summary: "Persist and enqueue a webhook event",
        operationId: "ingestEvent",
        parameters: [
          { name: "ingestKey", in: "path", required: true, schema: { type: "string", minLength: 12 } },
          { name: "Idempotency-Key", in: "header", required: false, schema: { type: "string" } },
          { name: "X-Replay-Signature", in: "header", required: false, description: "sha256=<hex HMAC> when the endpoint has a signing secret", schema: { type: "string" } },
        ],
        requestBody: { required: true, content: { "application/json": { schema: true } } },
        responses: {
          "200": response("Duplicate event already exists", "IngestReceipt"),
          "202": response("Event durably accepted", "IngestReceipt"),
          "401": response("Webhook signature is invalid", "Problem"),
          "404": response("Ingest endpoint does not exist", "Problem"),
          "429": response("Per-endpoint ingest limit exceeded", "Problem"),
        },
      },
    },
    "/api/stats": { get: operatorGet("Read global event counters", "getStats", "DashboardStats") },
    "/api/system": { get: operatorGet("Read live dependency, queue, heartbeat, and deploy state", "getSystem", "SystemSnapshot") },
    "/api/endpoints": {
      get: operatorGet("List webhook endpoints", "listEndpoints", "EndpointList"),
      post: {
        tags: ["operator"],
        summary: "Create a webhook endpoint",
        operationId: "createEndpoint",
        security: bearerSecurity,
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/CreateEndpoint" } } } },
        responses: { "201": response("Endpoint created", "Endpoint"), "400": response("Input or destination is unsafe", "Problem"), "401": response("Bearer token is missing or invalid", "Problem") },
      },
    },
    "/api/endpoints/reliability": {
      get: {
        ...operatorGet("Read per-destination reliability over a time window", "getEndpointReliability", "EndpointReliabilityList"),
        parameters: [{ name: "windowHours", in: "query", schema: { type: "integer", minimum: 1, maximum: 168, default: 24 } }],
      },
    },
    "/api/events": {
      get: {
        ...operatorGet("List recent webhook events", "listEvents", "EventList"),
        parameters: [{ name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 200, default: 50 } }],
      },
    },
    "/api/events/{eventId}": { get: operatorEventGet("Read an incident transcript and deterministic diagnosis", "getEvent", "EventDetail") },
    "/api/events/{eventId}/evidence": { get: operatorEventGet("Download a signed incident evidence bundle", "getEvidence", "EvidenceBundle") },
    "/api/events/{eventId}/rehearse": {
      post: operatorAction("Queue a rehearsal against a controlled destination", "rehearseEvent", "RehearsalRequest", "Rehearsal queued"),
    },
    "/api/events/{eventId}/replay": {
      post: operatorAction("Evaluate the replay guard and queue an approved replay", "replayEvent", "ReplayRequest", "Replay queued"),
    },
  },
  components: {
    securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } },
    schemas: {
      Problem: object(["error"], { error: { type: "string" }, requestId: { type: "string" }, reasons: { type: "array", items: { type: "string" } } }),
      Health: object(["status", "service", "timestamp", "dependencies"], {
        status: { const: "ok" }, service: { type: "string" }, timestamp: dateTime,
        dependencies: object(["databaseLatencyMs", "queueLatencyMs"], { databaseLatencyMs: nonnegativeInteger, queueLatencyMs: nonnegativeInteger }),
      }),
      IngestReceipt: object(["accepted", "duplicate", "eventId", "status"], {
        accepted: { const: true }, duplicate: { type: "boolean" }, eventId: uuid, status: eventStatus,
      }),
      CreateEndpoint: object(["name", "destinationUrl"], {
        name: { type: "string", minLength: 2, maxLength: 80 }, destinationUrl: uri,
        signingSecret: { type: ["string", "null"], minLength: 16, maxLength: 256 }, maxAttempts: { type: "integer", minimum: 1, maximum: 20, default: 5 },
      }),
      Endpoint: object(["id", "name", "ingestKey", "destinationUrl", "maxAttempts", "createdAt", "signingSecretConfigured"], {
        id: uuid, name: { type: "string" }, ingestKey: { type: "string" }, destinationUrl: uri,
        maxAttempts: { type: "integer" }, createdAt: dateTime, signingSecretConfigured: { type: "boolean" },
      }),
      EndpointList: { type: "array", items: { $ref: "#/components/schemas/Endpoint" } },
      WebhookEvent: object(["id", "endpointId", "headers", "payload", "payloadSha256", "status", "attemptCount", "receivedAt", "updatedAt"], {
        id: uuid, endpointId: uuid, idempotencyKey: { type: ["string", "null"] }, headers: { type: "object", additionalProperties: { type: "string" } },
        payload: true, payloadSha256: sha256, status: eventStatus, attemptCount: nonnegativeInteger,
        lastError: { type: ["string", "null"] }, receivedAt: dateTime, updatedAt: dateTime,
      }),
      EventList: { type: "array", items: { $ref: "#/components/schemas/WebhookEvent" } },
      EventDetail: { allOf: [{ $ref: "#/components/schemas/WebhookEvent" }, object(["endpoint", "attempts", "rehearsals", "audit", "diagnosis"], {
        endpoint: { $ref: "#/components/schemas/Endpoint" }, attempts: { type: "array", items: { type: "object" } },
        rehearsals: { type: "array", items: { type: "object" } }, audit: { type: "array", items: { type: "object" } }, diagnosis: { type: "object" },
      })] },
      DashboardStats: object(["total", "queued", "delivered", "retrying", "deadLetter", "deliveryRate"], {
        total: nonnegativeInteger, queued: nonnegativeInteger, delivered: nonnegativeInteger, retrying: nonnegativeInteger, deadLetter: nonnegativeInteger, deliveryRate: { type: "number", minimum: 0, maximum: 100 },
      }),
      SystemSnapshot: { type: "object" },
      EndpointReliabilityList: { type: "array", items: { type: "object" } },
      RehearsalRequest: object(["destinationUrl"], { destinationUrl: uri, notes: { type: "string", maxLength: 500 } }),
      ReplayRequest: object(["destinationUrl", "reason"], { destinationUrl: uri, reason: { type: "string", minLength: 10, maxLength: 500 } }),
      ActionReceipt: object(["queued", "eventId", "mode", "deliveryIntentId"], {
        queued: { const: true }, eventId: uuid, mode: { enum: ["rehearsal", "replay"] }, deliveryIntentId: uuid, duplicate: { type: "boolean" },
      }),
      EvidenceBundle: { type: "object", description: "Conforms to schema/replay-room-evidence-v1.schema.json" },
    },
  },
} as const;

function object(required: readonly string[], properties: Record<string, unknown>) {
  return { type: "object", additionalProperties: false, required, properties } as const;
}

function response(description: string, schema: string) {
  return { description, content: { "application/json": { schema: { $ref: `#/components/schemas/${schema}` } } } };
}

function operatorGet(summary: string, operationId: string, schema: string) {
  return { tags: ["operator"], summary, operationId, security: bearerSecurity, responses: { "200": response("Success", schema), "401": response("Bearer token is missing or invalid", "Problem") } };
}

function operatorEventGet(summary: string, operationId: string, schema: string) {
  return { ...operatorGet(summary, operationId, schema), parameters: [{ name: "eventId", in: "path", required: true, schema: uuid }], responses: { "200": response("Success", schema), "401": response("Bearer token is missing or invalid", "Problem"), "404": response("Event not found", "Problem") } };
}

function operatorAction(summary: string, operationId: string, requestSchema: string, successDescription: string) {
  return {
    tags: ["operator"], summary, operationId, security: bearerSecurity,
    parameters: [{ name: "eventId", in: "path", required: true, schema: uuid }],
    requestBody: { required: true, content: { "application/json": { schema: { $ref: `#/components/schemas/${requestSchema}` } } } },
    responses: { "202": response(successDescription, "ActionReceipt"), "400": response("Input or destination is unsafe", "Problem"), "401": response("Bearer token is missing or invalid", "Problem"), "404": response("Event not found", "Problem"), "409": response("Replay guard rejected the request", "Problem") },
  };
}
