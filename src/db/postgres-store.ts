import { randomUUID } from "node:crypto";
import pg from "pg";
import type { ClaimDeliveryIntentResult, CreateEventInput, CreateEventResult, DeliveryIntentSchedule, DeliveryJob, DeliveryOutcomeInput, DeliveryOutcomeResult, RetryTransitionInput, RetryTransitionResult, Store } from "../domain/contracts.js";
import { assertRetryTransitionIdentity, DELIVERY_INTENT_LEASE_MS, EVENT_BUSY_RETRY_MS, sameDeliveryJob } from "../domain/delivery-intent.js";
import { deliveryRate, reliabilityState } from "../domain/reliability.js";
import { parseRetryAfter } from "../domain/retry.js";
import type {
  AuditEntry,
  DashboardStats,
  DeliveryAttempt,
  DeliveryIntent,
  DeliveryIntentStats,
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
      `INSERT INTO endpoints (name, ingest_key, destination_url, signing_secret, signature_profile, max_attempts)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [input.name, input.ingestKey, input.destinationUrl, input.signingSecret, input.signatureProfile, input.maxAttempts],
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

  async beginDeliveryAttempt(
    eventId: string,
    attemptCount: number,
    currentIntentId?: string,
    currentIntentProcessingAt?: string,
  ): Promise<boolean> {
    if (Boolean(currentIntentId) !== Boolean(currentIntentProcessingAt)) {
      throw new Error("Delivery attempt requires both the current intent and its processing claim");
    }
    const result = await this.pool.query(
      `UPDATE webhook_events
       SET status = 'delivering', attempt_count = $2, last_error = NULL, updated_at = now()
       WHERE id = $1
         AND status <> 'delivered'
         AND ($3::uuid IS NULL OR EXISTS (
           SELECT 1 FROM delivery_intents
           WHERE id = $3
             AND event_id = $1
             AND state = 'processing'
             AND processing_at = $4
         ))`,
      [eventId, attemptCount, currentIntentId ?? null, currentIntentProcessingAt ?? null],
    );
    return result.rowCount === 1;
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

  async latestRehearsal(eventId: string): Promise<Rehearsal | null> {
    const result = await this.pool.query(
      "SELECT * FROM rehearsals WHERE event_id = $1 ORDER BY created_at DESC LIMIT 1",
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
    schedule: DeliveryIntentSchedule = {},
  ): Promise<{ intent: DeliveryIntent; created: boolean }> {
    const delayMs = schedule.delayMs ?? 0;
    if (!Number.isSafeInteger(delayMs) || delayMs < 0) throw new Error("Delivery intent delay must be a non-negative integer");
    if (schedule.availableAt !== undefined && !Number.isFinite(Date.parse(schedule.availableAt))) {
      throw new Error("Delivery intent availability must be a valid timestamp");
    }
    const intentId = randomUUID();
    const enrichedJob = { ...job, intentId };
    const inserted = await this.pool.query(
      `INSERT INTO delivery_intents (id, job_key, event_id, job, available_at)
       VALUES ($1, $2, $3, $4::jsonb,
         coalesce($5::timestamptz, date_trunc('milliseconds', clock_timestamp()) + ($6 * interval '1 millisecond')))
       ON CONFLICT (job_key) DO NOTHING
       RETURNING *`,
      [intentId, jobKey, job.eventId, JSON.stringify(enrichedJob), schedule.availableAt ?? null, delayMs],
    );
    if (inserted.rowCount) {
      return { intent: mapDeliveryIntent(inserted.rows[0] as Row), created: true };
    }

    const existing = await this.pool.query("SELECT * FROM delivery_intents WHERE job_key = $1", [jobKey]);
    return { intent: mapDeliveryIntent(existing.rows[0] as Row), created: false };
  }

  async commitRetryTransition(input: RetryTransitionInput): Promise<RetryTransitionResult> {
    assertRetryTransitionIdentity(input);
    if (!Number.isSafeInteger(input.backoffMs) || input.backoffMs < 0) throw new Error("Retry backoff must be a non-negative integer");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const lockedEvent = await client.query(
        "SELECT id, status FROM webhook_events WHERE id = $1 FOR UPDATE",
        [input.eventId],
      );
      if (!lockedEvent.rowCount) throw new Error(`Event ${input.eventId} does not exist`);
      const nextStatus = lockedEvent.rows[0]!.status as WebhookEvent["status"];
      const clock = await client.query("SELECT clock_timestamp() AS now");
      const plannedAt = iso(clock.rows[0]!.now);
      const receiverDelayMs = parseRetryAfter(input.retryAfter, Date.parse(plannedAt));
      const proposedDelayMs = Math.max(input.backoffMs, receiverDelayMs ?? 0);
      const proposedStrategy = receiverDelayMs !== null && receiverDelayMs >= input.backoffMs ? "retry-after" : "backoff";
      const proposedAvailableAt = new Date(Date.parse(plannedAt) + proposedDelayMs).toISOString();
      await completeCurrentIntent(
        client,
        input.eventId,
        input.currentIntentId,
        input.currentIntentProcessingAt,
        input.completedAt,
      );
      if (nextStatus === "delivered") {
        await client.query("COMMIT");
        return { scheduled: false, nextStatus };
      }

      const intentId = randomUUID();
      const enrichedJob = { ...input.job, intentId };
      const inserted = await client.query(
        `INSERT INTO delivery_intents (id, job_key, event_id, job, available_at)
         VALUES ($1, $2, $3, $4::jsonb, $5)
         ON CONFLICT (job_key) DO NOTHING
         RETURNING *`,
        [intentId, input.jobKey, input.eventId, JSON.stringify(enrichedJob), proposedAvailableAt],
      );
      const created = Boolean(inserted.rowCount);
      const existing = created
        ? null
        : await client.query(
          "SELECT * FROM delivery_intents WHERE job_key = $1 AND event_id = $2 FOR UPDATE",
          [input.jobKey, input.eventId],
        );
      if (!created && !existing?.rowCount) throw new Error(`Retry intent ${input.jobKey} belongs to a different event`);
      const intent = mapDeliveryIntent((created ? inserted.rows[0] : existing!.rows[0]) as Row);
      if (!sameDeliveryJob(intent.job, input.job)) throw new Error(`Retry intent ${input.jobKey} contains a different job`);
      if (intent.state === "completed") {
        await client.query("COMMIT");
        return { scheduled: false, nextStatus };
      }
      const effectiveDelayMs = Math.max(0, Date.parse(intent.availableAt) - Date.parse(plannedAt));
      const metadata = retryAuditMetadata(
        input,
        intent,
        created,
        effectiveDelayMs,
        proposedDelayMs,
        proposedStrategy,
        receiverDelayMs,
      );

      await client.query(
        `INSERT INTO audit_log (event_id, action, actor, reason, metadata)
         SELECT $1, $2, $3, $4, $5::jsonb
         WHERE NOT EXISTS (
           SELECT 1 FROM audit_log
           WHERE event_id = $1 AND action = $2 AND metadata ->> 'jobKey' = $6
         )`,
        [input.eventId, input.audit.action, input.audit.actor, input.audit.reason, JSON.stringify(metadata), input.jobKey],
      );
      await client.query(
        `UPDATE webhook_events
         SET status = 'retrying', last_error = $2, updated_at = now()
         WHERE id = $1`,
        [input.eventId, input.lastError],
      );
      await client.query("COMMIT");
      return { scheduled: true, intent, created, delayMs: effectiveDelayMs };
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error(JSON.stringify({
          event: "retry_transition.rollback_failed",
          eventId: input.eventId,
          error: rollbackError instanceof Error ? rollbackError.message : "Unknown rollback error",
        }));
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async commitDeliveryOutcome(input: DeliveryOutcomeInput): Promise<DeliveryOutcomeResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const lockedEvent = await client.query("SELECT id, status FROM webhook_events WHERE id = $1 FOR UPDATE", [input.eventId]);
      if (!lockedEvent.rowCount) throw new Error(`Event ${input.eventId} does not exist`);
      const currentStatus = lockedEvent.rows[0]!.status as WebhookEvent["status"];
      await completeCurrentIntent(
        client,
        input.eventId,
        input.currentIntentId,
        input.currentIntentProcessingAt,
        input.completedAt,
      );

      if (currentStatus === "delivered" && input.status === "dead_letter") {
        await client.query("COMMIT");
        return { applied: false, nextStatus: currentStatus };
      }

      await client.query(
        `UPDATE webhook_events
         SET status = $2, last_error = $3, updated_at = now()
         WHERE id = $1`,
        [input.eventId, input.status, input.lastError],
      );
      await client.query(
        `INSERT INTO audit_log (event_id, action, actor, reason, metadata)
         VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [input.eventId, input.audit.action, input.audit.actor, input.audit.reason, JSON.stringify(input.audit.metadata)],
      );
      await client.query("COMMIT");
      return { applied: true, nextStatus: input.status };
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error(JSON.stringify({
          event: "delivery_outcome.rollback_failed",
          eventId: input.eventId,
          error: rollbackError instanceof Error ? rollbackError.message : "Unknown rollback error",
        }));
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async listDispatchableIntents(limit = 500): Promise<DeliveryIntent[]> {
    const result = await this.pool.query(
      `SELECT * FROM delivery_intents
       WHERE available_at <= clock_timestamp()
         AND (state = 'pending'
           OR (state = 'dispatched' AND dispatched_at < clock_timestamp() - ($1 * interval '1 millisecond'))
           OR (state = 'processing' AND processing_at < clock_timestamp() - ($1 * interval '1 millisecond')))
       ORDER BY available_at ASC, created_at ASC
       LIMIT $2`,
      [DELIVERY_INTENT_LEASE_MS, limit],
    );
    return result.rows.map((row) => mapDeliveryIntent(row as Row));
  }

  async prepareDeliveryIntentDispatch(id: string) {
    const result = await this.pool.query(
      `UPDATE delivery_intents
       SET state = 'dispatched', dispatched_at = date_trunc('milliseconds', clock_timestamp()), processing_at = NULL
       WHERE id = $1
         AND (state = 'pending'
           OR (state = 'dispatched' AND dispatched_at < clock_timestamp() - ($2 * interval '1 millisecond'))
           OR (state = 'processing' AND processing_at < clock_timestamp() - ($2 * interval '1 millisecond')))
       RETURNING dispatched_at,
         greatest(0, ceil(extract(epoch FROM (available_at - dispatched_at)) * 1000))::bigint AS delay_ms`,
      [id, DELIVERY_INTENT_LEASE_MS],
    );
    if (!result.rowCount) return null;
    return {
      dispatchedAt: iso(result.rows[0]!.dispatched_at),
      delayMs: Number(result.rows[0]!.delay_ms),
    };
  }

  async releaseDeliveryIntent(id: string, dispatchedAt: string): Promise<void> {
    await this.pool.query(
      `UPDATE delivery_intents
       SET state = 'pending', dispatched_at = NULL
       WHERE id = $1 AND state = 'dispatched' AND dispatched_at = $2`,
      [id, dispatchedAt],
    );
  }

  async claimDeliveryIntent(id: string): Promise<ClaimDeliveryIntentResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const identity = await client.query("SELECT event_id FROM delivery_intents WHERE id = $1", [id]);
      if (!identity.rowCount) {
        await client.query("COMMIT");
        return { status: "unavailable" };
      }
      const eventId = String(identity.rows[0]!.event_id);
      const event = await client.query("SELECT id, status FROM webhook_events WHERE id = $1 FOR UPDATE", [eventId]);
      if (!event.rowCount) {
        await client.query("COMMIT");
        return { status: "unavailable" };
      }
      const candidateResult = await client.query("SELECT * FROM delivery_intents WHERE id = $1 FOR UPDATE", [id]);
      if (!candidateResult.rowCount) {
        await client.query("COMMIT");
        return { status: "unavailable" };
      }
      const candidate = mapDeliveryIntent(candidateResult.rows[0] as Row);
      if (candidate.state !== "dispatched") {
        await client.query("COMMIT");
        return { status: "unavailable" };
      }
      const clock = await client.query("SELECT clock_timestamp() AS now");
      const databaseNow = iso(clock.rows[0]!.now);
      if (event.rows[0]!.status === "delivered" && candidate.job.mode !== "rehearsal") {
        await client.query(
          "UPDATE delivery_intents SET state = 'completed', completed_at = $2 WHERE id = $1 AND state = 'dispatched'",
          [id, databaseNow],
        );
        await client.query("COMMIT");
        return { status: "unavailable" };
      }
      if (candidate.job.mode !== "rehearsal") {
        const cycleId = candidate.job.cycleId ?? candidate.job.mode;
        const attemptNumber = candidate.job.attemptNumber ?? 1;
        const siblings = await client.query(
          `SELECT job FROM delivery_intents
           WHERE event_id = $1
             AND id <> $2
             AND state IN ('pending', 'dispatched', 'processing', 'completed')`,
          [eventId, id],
        );
        const superseded = siblings.rows.some((row) => {
          const sibling = row.job as DeliveryJob;
          return sibling.mode !== "rehearsal"
            && (sibling.cycleId ?? sibling.mode) === cycleId
            && (sibling.attemptNumber ?? 1) > attemptNumber;
        });
        if (superseded) {
          await client.query(
            "UPDATE delivery_intents SET state = 'completed', completed_at = $2 WHERE id = $1 AND state = 'dispatched'",
            [id, databaseNow],
          );
          await client.query("COMMIT");
          return { status: "unavailable" };
        }
      }
      if (Date.parse(candidate.availableAt) > Date.parse(databaseNow)) {
        const delayMs = Math.max(0, Date.parse(candidate.availableAt) - Date.parse(databaseNow));
        await client.query("COMMIT");
        return { status: "deferred", intent: candidate, retryAt: candidate.availableAt, delayMs, reason: "not-yet-available" };
      }

      if (candidate.job.mode !== "rehearsal") {
        const staleBefore = new Date(Date.parse(databaseNow) - DELIVERY_INTENT_LEASE_MS).toISOString();
        await client.query(
          `UPDATE delivery_intents
           SET state = 'completed', completed_at = $3
           WHERE event_id = $1
             AND id <> $2
             AND state = 'processing'
             AND processing_at < $4
             AND job ->> 'mode' <> 'rehearsal'`,
          [eventId, id, databaseNow, staleBefore],
        );
        const active = await client.query(
          `SELECT 1 FROM delivery_intents
           WHERE event_id = $1
             AND id <> $2
             AND state = 'processing'
             AND processing_at >= $3
             AND job ->> 'mode' <> 'rehearsal'
           LIMIT 1`,
          [eventId, id, staleBefore],
        );
        if (active.rowCount) {
          const retryAt = new Date(Date.parse(databaseNow) + EVENT_BUSY_RETRY_MS).toISOString();
          await client.query("COMMIT");
          return { status: "deferred", intent: candidate, retryAt, delayMs: EVENT_BUSY_RETRY_MS, reason: "event-busy" };
        }
      }

      const claimed = await client.query(
        `UPDATE delivery_intents
         SET state = 'processing', processing_at = $2
         WHERE id = $1 AND state = 'dispatched'
         RETURNING *`,
        [id, databaseNow],
      );
      await client.query("COMMIT");
      return claimed.rowCount
        ? { status: "claimed", intent: mapDeliveryIntent(claimed.rows[0] as Row) }
        : { status: "unavailable" };
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error(JSON.stringify({
          event: "delivery_intent_claim.rollback_failed",
          intentId: id,
          error: rollbackError instanceof Error ? rollbackError.message : "Unknown rollback error",
        }));
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async releaseDeliveryIntentClaim(id: string, processingAt: string): Promise<void> {
    await this.pool.query(
      `UPDATE delivery_intents
       SET state = 'dispatched', processing_at = NULL
       WHERE id = $1 AND state = 'processing' AND processing_at = $2`,
      [id, processingAt],
    );
  }

  async completeDeliveryIntent(id: string, completedAt: string, processingAt?: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE delivery_intents
       SET state = 'completed', completed_at = $2
       WHERE id = $1
         AND state <> 'completed'
         AND (($3::timestamptz IS NULL AND state IN ('pending', 'dispatched'))
           OR (state = 'processing' AND processing_at = $3))`,
      [id, completedAt, processingAt ?? null],
    );
    return result.rowCount === 1;
  }

  async deliveryIntentStats(): Promise<DeliveryIntentStats> {
    const result = await this.pool.query(
      `SELECT
         count(*) FILTER (WHERE state = 'pending')::int AS pending,
         count(*) FILTER (WHERE state = 'dispatched')::int AS dispatched,
         count(*) FILTER (WHERE state = 'processing')::int AS processing,
         count(*) FILTER (WHERE
           (state = 'pending' AND available_at < clock_timestamp() - ($1 * interval '1 millisecond'))
           OR (state = 'dispatched' AND dispatched_at < clock_timestamp() - ($1 * interval '1 millisecond'))
           OR (state = 'processing' AND processing_at < clock_timestamp() - ($1 * interval '1 millisecond'))
         )::int AS stale
       FROM delivery_intents
       WHERE state <> 'completed'`,
      [DELIVERY_INTENT_LEASE_MS],
    );
    const row = result.rows[0] as Row;
    return {
      pending: Number(row.pending),
      dispatched: Number(row.dispatched),
      processing: Number(row.processing),
      stale: Number(row.stale),
    };
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
    signatureProfile: row.signature_profile as Endpoint["signatureProfile"],
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

function retryAuditMetadata(
  input: RetryTransitionInput,
  intent: DeliveryIntent,
  created: boolean,
  effectiveDelayMs: number,
  proposedDelayMs: number,
  proposedStrategy: "backoff" | "retry-after",
  receiverDelayMs: number | null,
): Record<string, unknown> {
  return {
    ...input.audit.metadata,
    jobKey: input.jobKey,
    intentCreated: created,
    delayMs: effectiveDelayMs,
    strategy: created ? proposedStrategy : "existing-intent",
    receiverDelayMs,
    availableAt: intent.availableAt,
    ...(!created ? { proposedDelayMs, proposedStrategy } : {}),
  };
}

async function completeCurrentIntent(
  client: pg.PoolClient,
  eventId: string,
  intentId: string | undefined,
  processingAt: string | undefined,
  completedAt: string,
): Promise<void> {
  if (Boolean(intentId) !== Boolean(processingAt)) {
    throw new Error("Delivery transition requires both the current intent and its processing claim");
  }
  if (!intentId || !processingAt) return;
  const completed = await client.query(
    `UPDATE delivery_intents
     SET state = 'completed', completed_at = $2
     WHERE id = $1
       AND event_id = $3
       AND state = 'processing'
       AND processing_at = $4`,
    [intentId, completedAt, eventId, processingAt],
  );
  if (completed.rowCount !== 1) throw new Error(`Delivery intent ${intentId} lost its processing claim`);
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

export function makeId(): string {
  return randomUUID();
}
