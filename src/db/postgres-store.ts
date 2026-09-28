import { randomUUID } from "node:crypto";
import pg from "pg";
import type { CreateEventInput, CreateEventResult, DeliveryJob, Store } from "../domain/contracts.js";
import { deliveryRate, reliabilityState } from "../domain/reliability.js";
import type {
  AuditEntry,
  DashboardStats,
  DeliveryAttempt,
  DeliveryIntent,
  Endpoint,
  EndpointReliability,
  EventDetail,
  Rehearsal,
  WebhookEvent,
} from "../domain/types.js";

const { Pool } = pg;

type Row = Record<string, unknown>;

export class PostgresStore implements Store {
  readonly pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000 });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async ping(): Promise<void> {
    await this.pool.query("SELECT 1");
  }

  async createEndpoint(input: Omit<Endpoint, "id" | "createdAt">): Promise<Endpoint> {
    const result = await this.pool.query(
      `INSERT INTO endpoints (name, ingest_key, destination_url, signing_secret, max_attempts)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [input.name, input.ingestKey, input.destinationUrl, input.signingSecret, input.maxAttempts],
    );
    return mapEndpoint(result.rows[0] as Row);
  }

  async getEndpointByIngestKey(ingestKey: string): Promise<Endpoint | null> {
    const result = await this.pool.query("SELECT * FROM endpoints WHERE ingest_key = $1", [ingestKey]);
    return result.rowCount ? mapEndpoint(result.rows[0] as Row) : null;
  }

  async listEndpoints(): Promise<Endpoint[]> {
    const result = await this.pool.query("SELECT * FROM endpoints ORDER BY created_at DESC");
    return result.rows.map((row) => mapEndpoint(row as Row));
  }

  async endpointReliability(windowHours: number): Promise<EndpointReliability[]> {
    const result = await this.pool.query(
      `WITH event_rollup AS (
         SELECT endpoint_id,
           count(*)::int AS total,
           count(*) FILTER (WHERE status = 'delivered')::int AS delivered,
           count(*) FILTER (WHERE status = 'retrying')::int AS retrying,
           count(*) FILTER (WHERE status = 'dead_letter')::int AS dead_letter,
           max(received_at) AS last_event_at
         FROM webhook_events
         WHERE received_at >= now() - ($1::int * interval '1 hour')
         GROUP BY endpoint_id
       ), latency_rollup AS (
         SELECT events.endpoint_id,
           round(percentile_cont(0.95) WITHIN GROUP (ORDER BY attempts.duration_ms))::int AS p95_latency_ms
         FROM delivery_attempts attempts
         JOIN webhook_events events ON events.id = attempts.event_id
         WHERE events.received_at >= now() - ($1::int * interval '1 hour')
           AND attempts.mode <> 'rehearsal'
           AND attempts.status_code BETWEEN 200 AND 299
         GROUP BY events.endpoint_id
       )
       SELECT endpoints.id, endpoints.name, endpoints.destination_url,
         coalesce(events.total, 0)::int AS total,
         coalesce(events.delivered, 0)::int AS delivered,
         coalesce(events.retrying, 0)::int AS retrying,
         coalesce(events.dead_letter, 0)::int AS dead_letter,
         events.last_event_at,
         latency.p95_latency_ms
       FROM endpoints
       LEFT JOIN event_rollup events ON events.endpoint_id = endpoints.id
       LEFT JOIN latency_rollup latency ON latency.endpoint_id = endpoints.id
       ORDER BY events.last_event_at DESC NULLS LAST, endpoints.created_at DESC`,
      [windowHours],
    );
    return result.rows.map((row) => {
      const total = Number(row.total);
      const delivered = Number(row.delivered);
      const retrying = Number(row.retrying);
      const deadLetter = Number(row.dead_letter);
      return {
        endpointId: String(row.id),
        name: String(row.name),
        destinationUrl: String(row.destination_url),
        windowHours,
        total,
        delivered,
        retrying,
        deadLetter,
        deliveryRate: deliveryRate(delivered, deadLetter),
        p95LatencyMs: row.p95_latency_ms === null ? null : Number(row.p95_latency_ms),
        lastEventAt: row.last_event_at === null ? null : iso(row.last_event_at),
        state: reliabilityState(total, delivered, retrying, deadLetter),
      };
    });
  }

  async createEvent(input: CreateEventInput): Promise<CreateEventResult> {
    if (input.idempotencyKey) {
      const existing = await this.pool.query(
        "SELECT * FROM webhook_events WHERE endpoint_id = $1 AND idempotency_key = $2",
        [input.endpointId, input.idempotencyKey],
      );
      if (existing.rowCount) return { event: mapEvent(existing.rows[0] as Row), duplicate: true };
    }

    try {
      const result = await this.pool.query(
        `INSERT INTO webhook_events (endpoint_id, idempotency_key, headers, payload, payload_sha256)
         VALUES ($1, $2, $3::jsonb, $4::jsonb, $5) RETURNING *`,
        [input.endpointId, input.idempotencyKey, JSON.stringify(input.headers), JSON.stringify(input.payload), input.payloadSha256],
      );
      return { event: mapEvent(result.rows[0] as Row), duplicate: false };
    } catch (error) {
      if (input.idempotencyKey && isUniqueViolation(error)) {
        const existing = await this.pool.query(
          "SELECT * FROM webhook_events WHERE endpoint_id = $1 AND idempotency_key = $2",
          [input.endpointId, input.idempotencyKey],
        );
        if (existing.rowCount) return { event: mapEvent(existing.rows[0] as Row), duplicate: true };
      }
      throw error;
    }
  }

  async getEvent(id: string): Promise<EventDetail | null> {
    const result = await this.pool.query(
      `SELECT e.*, row_to_json(ep.*) AS endpoint
       FROM webhook_events e JOIN endpoints ep ON ep.id = e.endpoint_id WHERE e.id = $1`,
      [id],
    );
    if (!result.rowCount) return null;
    const row = result.rows[0] as Row;
    const [attempts, rehearsals, audit] = await Promise.all([
      this.pool.query("SELECT * FROM delivery_attempts WHERE event_id = $1 ORDER BY created_at DESC", [id]),
      this.pool.query("SELECT * FROM rehearsals WHERE event_id = $1 ORDER BY created_at DESC", [id]),
      this.pool.query("SELECT * FROM audit_log WHERE event_id = $1 ORDER BY created_at DESC", [id]),
    ]);
    return {
      ...mapEvent(row),
      endpoint: mapEndpoint(row.endpoint as Row),
      attempts: attempts.rows.map((item) => mapAttempt(item as Row)),
      rehearsals: rehearsals.rows.map((item) => mapRehearsal(item as Row)),
      audit: audit.rows.map((item) => mapAudit(item as Row)),
    };
  }

  async listEvents(limit: number): Promise<WebhookEvent[]> {
    const result = await this.pool.query("SELECT * FROM webhook_events ORDER BY received_at DESC LIMIT $1", [limit]);
    return result.rows.map((row) => mapEvent(row as Row));
  }

  async updateEvent(
    id: string,
    patch: Partial<Pick<WebhookEvent, "status" | "attemptCount" | "lastError">>,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE webhook_events SET
        status = COALESCE($2, status),
        attempt_count = COALESCE($3, attempt_count),
        last_error = CASE WHEN $4::boolean THEN $5 ELSE last_error END,
        updated_at = now()
       WHERE id = $1`,
      [id, patch.status ?? null, patch.attemptCount ?? null, Object.hasOwn(patch, "lastError"), patch.lastError ?? null],
    );
  }

  async addAttempt(input: Omit<DeliveryAttempt, "id" | "createdAt">): Promise<DeliveryAttempt> {
    const result = await this.pool.query(
      `INSERT INTO delivery_attempts
       (event_id, mode, destination_url, status_code, response_body, error, duration_ms)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [input.eventId, input.mode, input.destinationUrl, input.statusCode, input.responseBody, input.error, input.durationMs],
    );
    return mapAttempt(result.rows[0] as Row);
  }

  async addRehearsal(input: Omit<Rehearsal, "id" | "createdAt">): Promise<Rehearsal> {
    const result = await this.pool.query(
      `INSERT INTO rehearsals (event_id, payload_sha256, destination_url, passed, status_code, notes)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [input.eventId, input.payloadSha256, input.destinationUrl, input.passed, input.statusCode, input.notes],
    );
    return mapRehearsal(result.rows[0] as Row);
  }

  async latestPassingRehearsal(eventId: string): Promise<Rehearsal | null> {
    const result = await this.pool.query(
      "SELECT * FROM rehearsals WHERE event_id = $1 AND passed = true ORDER BY created_at DESC LIMIT 1",
      [eventId],
    );
    return result.rowCount ? mapRehearsal(result.rows[0] as Row) : null;
  }

  async addAudit(input: Omit<AuditEntry, "id" | "createdAt">): Promise<AuditEntry> {
    const result = await this.pool.query(
      `INSERT INTO audit_log (event_id, action, actor, reason, metadata)
       VALUES ($1,$2,$3,$4,$5::jsonb) RETURNING *`,
      [input.eventId, input.action, input.actor, input.reason, JSON.stringify(input.metadata)],
    );
    return mapAudit(result.rows[0] as Row);
  }

  async createDeliveryIntent(
    jobKey: string,
    job: DeliveryJob,
    availableAt = new Date().toISOString(),
  ): Promise<{ intent: DeliveryIntent; created: boolean }> {
    const intentId = randomUUID();
    const enrichedJob = { ...job, intentId };
    const inserted = await this.pool.query(
      `INSERT INTO delivery_intents (id, job_key, event_id, job, available_at)
       VALUES ($1, $2, $3, $4::jsonb, $5)
       ON CONFLICT (job_key) DO NOTHING
       RETURNING *`,
      [intentId, jobKey, job.eventId, JSON.stringify(enrichedJob), availableAt],
    );
    if (inserted.rowCount) {
      return { intent: mapDeliveryIntent(inserted.rows[0] as Row), created: true };
    }

    const existing = await this.pool.query("SELECT * FROM delivery_intents WHERE job_key = $1", [jobKey]);
    return { intent: mapDeliveryIntent(existing.rows[0] as Row), created: false };
  }

  async listDispatchableIntents(nowIso: string, staleBeforeIso: string, limit = 500): Promise<DeliveryIntent[]> {
    const result = await this.pool.query(
      `SELECT * FROM delivery_intents
       WHERE available_at <= $1
         AND (state = 'pending'
           OR (state = 'dispatched' AND dispatched_at < $2)
           OR (state = 'processing' AND processing_at < $2))
       ORDER BY available_at ASC, created_at ASC
       LIMIT $3`,
      [nowIso, staleBeforeIso, limit],
    );
    return result.rows.map((row) => mapDeliveryIntent(row as Row));
  }

  async prepareDeliveryIntentDispatch(id: string, dispatchedAt: string, staleBeforeIso: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE delivery_intents
       SET state = 'dispatched', dispatched_at = $2, processing_at = NULL
       WHERE id = $1
         AND (state = 'pending'
           OR (state = 'dispatched' AND dispatched_at < $3)
           OR (state = 'processing' AND processing_at < $3))`,
      [id, dispatchedAt, staleBeforeIso],
    );
    return (result.rowCount ?? 0) === 1;
  }

  async releaseDeliveryIntent(id: string, dispatchedAt: string): Promise<void> {
    await this.pool.query(
      `UPDATE delivery_intents
       SET state = 'pending', dispatched_at = NULL
       WHERE id = $1 AND state = 'dispatched' AND dispatched_at = $2`,
      [id, dispatchedAt],
    );
  }

  async claimDeliveryIntent(id: string, processingAt: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE delivery_intents
       SET state = 'processing', processing_at = $2
       WHERE id = $1 AND state = 'dispatched'`,
      [id, processingAt],
    );
    return (result.rowCount ?? 0) === 1;
  }

  async releaseDeliveryIntentClaim(id: string, processingAt: string): Promise<void> {
    await this.pool.query(
      `UPDATE delivery_intents
       SET state = 'dispatched', processing_at = NULL
       WHERE id = $1 AND state = 'processing' AND processing_at = $2`,
      [id, processingAt],
    );
  }

  async completeDeliveryIntent(id: string, completedAt: string): Promise<void> {
    await this.pool.query(
      `UPDATE delivery_intents
       SET state = 'completed', completed_at = $2
       WHERE id = $1 AND state <> 'completed'`,
      [id, completedAt],
    );
  }

  async stats(): Promise<DashboardStats> {
    const result = await this.pool.query(
      `SELECT count(*)::int AS total,
       count(*) FILTER (WHERE status='queued')::int AS queued,
       count(*) FILTER (WHERE status='delivered')::int AS delivered,
       count(*) FILTER (WHERE status='retrying')::int AS retrying,
       count(*) FILTER (WHERE status='dead_letter')::int AS dead_letter
       FROM webhook_events`,
    );
    const row = result.rows[0] as { total: number; queued: number; delivered: number; retrying: number; dead_letter: number };
    return {
      total: row.total,
      queued: row.queued,
      delivered: row.delivered,
      retrying: row.retrying,
      deadLetter: row.dead_letter,
      deliveryRate: row.total ? Math.round((row.delivered / row.total) * 1000) / 10 : 100,
    };
  }

  async recoverPending(beforeIso: string): Promise<Array<{ eventId: string; attemptCount: number }>> {
    const recovered = await this.pool.query(
      `UPDATE webhook_events SET status='retrying', last_error='Reconciled after a stuck delivery', updated_at=now()
       WHERE status='delivering' AND updated_at < $1
         AND NOT EXISTS (
           SELECT 1 FROM delivery_intents intents
           WHERE intents.event_id = webhook_events.id AND intents.state <> 'completed'
         )
       RETURNING id, attempt_count`,
      [beforeIso],
    );
    const pending = await this.pool.query(
      `SELECT id, attempt_count FROM webhook_events
       WHERE status IN ('queued', 'retrying') AND updated_at < $1
         AND NOT EXISTS (
           SELECT 1 FROM delivery_intents intents
           WHERE intents.event_id = webhook_events.id AND intents.state <> 'completed'
         )
       ORDER BY updated_at ASC LIMIT 500`,
      [beforeIso],
    );
    return [...new Map([...recovered.rows, ...pending.rows].map((row) => [String(row.id), {
      eventId: String(row.id),
      attemptCount: Number(row.attempt_count),
    }])).values()];
  }

  async deleteOlderThan(beforeIso: string): Promise<number> {
    const result = await this.pool.query("DELETE FROM webhook_events WHERE received_at < $1", [beforeIso]);
    return result.rowCount ?? 0;
  }
}

function iso(value: unknown): string {
  return new Date(value as string | number | Date).toISOString();
}

function mapEndpoint(row: Row): Endpoint {
  return {
    id: String(row.id), name: String(row.name), ingestKey: String(row.ingest_key),
    destinationUrl: String(row.destination_url), signingSecret: row.signing_secret ? String(row.signing_secret) : null,
    maxAttempts: Number(row.max_attempts), createdAt: iso(row.created_at),
  };
}

function mapEvent(row: Row): WebhookEvent {
  return {
    id: String(row.id), endpointId: String(row.endpoint_id), idempotencyKey: row.idempotency_key ? String(row.idempotency_key) : null,
    headers: row.headers as Record<string, string>, payload: row.payload, payloadSha256: String(row.payload_sha256),
    status: row.status as WebhookEvent["status"], attemptCount: Number(row.attempt_count),
    lastError: row.last_error ? String(row.last_error) : null, receivedAt: iso(row.received_at), updatedAt: iso(row.updated_at),
  };
}

function mapAttempt(row: Row): DeliveryAttempt {
  return {
    id: String(row.id), eventId: String(row.event_id), mode: row.mode as DeliveryAttempt["mode"],
    destinationUrl: String(row.destination_url), statusCode: row.status_code === null ? null : Number(row.status_code),
    responseBody: row.response_body === null ? null : String(row.response_body), error: row.error === null ? null : String(row.error),
    durationMs: Number(row.duration_ms), createdAt: iso(row.created_at),
  };
}

function mapRehearsal(row: Row): Rehearsal {
  return {
    id: String(row.id), eventId: String(row.event_id), payloadSha256: String(row.payload_sha256),
    destinationUrl: String(row.destination_url), passed: Boolean(row.passed),
    statusCode: row.status_code === null ? null : Number(row.status_code), notes: String(row.notes), createdAt: iso(row.created_at),
  };
}

function mapAudit(row: Row): AuditEntry {
  return {
    id: String(row.id), eventId: String(row.event_id), action: String(row.action), actor: String(row.actor),
    reason: row.reason === null ? null : String(row.reason), metadata: row.metadata as Record<string, unknown>, createdAt: iso(row.created_at),
  };
}

function mapDeliveryIntent(row: Row): DeliveryIntent {
  return {
    id: String(row.id),
    jobKey: String(row.job_key),
    eventId: String(row.event_id),
    job: row.job as DeliveryJob,
    state: row.state as DeliveryIntent["state"],
    availableAt: iso(row.available_at),
    dispatchedAt: row.dispatched_at === null ? null : iso(row.dispatched_at),
    processingAt: row.processing_at === null ? null : iso(row.processing_at),
    completedAt: row.completed_at === null ? null : iso(row.completed_at),
    createdAt: iso(row.created_at),
  };
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

export function makeId(): string {
  return randomUUID();
}
