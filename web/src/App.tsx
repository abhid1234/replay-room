import { useCallback, useEffect, useMemo, useState } from "react";
import { IncidentDrill } from "./IncidentDrill";

type EventStatus = "queued" | "delivering" | "retrying" | "delivered" | "dead_letter";
type Event = {
  id: string;
  endpointId: string;
  status: EventStatus;
  attemptCount: number;
  lastError: string | null;
  payload: unknown;
  receivedAt: string;
};
type Stats = { total: number; queued: number; delivered: number; retrying: number; deadLetter: number; deliveryRate: number };
type Endpoint = { id: string; name: string; ingestKey: string; destinationUrl: string; maxAttempts: number };
type EndpointReliability = {
  endpointId: string;
  name: string;
  destinationUrl: string;
  windowHours: number;
  total: number;
  delivered: number;
  retrying: number;
  deadLetter: number;
  deliveryRate: number;
  p95LatencyMs: number | null;
  lastEventAt: string | null;
  state: "healthy" | "at_risk" | "breached" | "idle";
};
type ComponentState = "online" | "degraded" | "waiting";
type SystemSnapshot = {
  observedAt: string;
  deploy: { service: string; commit: string; instance: string; environment: string; topology: "embedded-free" | "split-services" };
  components: {
    api: { state: ComponentState; uptimeSeconds: number };
    database: { state: ComponentState; latencyMs: number };
    queue: { state: ComponentState; latencyMs: number; jobs: { waiting: number; active: number; delayed: number; failed: number } };
    worker: { state: ComponentState; heartbeatAgeSeconds: number | null };
    cron: { state: ComponentState; heartbeatAgeSeconds: number | null };
  };
};
type Detail = Event & {
  endpoint: Endpoint;
  attempts: Array<{ id: string; mode: string; statusCode: number | null; error: string | null; durationMs: number; createdAt: string }>;
  rehearsals: Array<{ id: string; passed: boolean; destinationUrl: string; notes: string; createdAt: string }>;
  audit: Array<{ id: string; action: string; actor: string; reason: string | null; createdAt: string }>;
  diagnosis: {
    code: string;
    severity: "info" | "warning" | "critical";
    headline: string;
    summary: string;
    evidence: string[];
    nextAction: string;
  };
};

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:4000";

export function App() {
  const [token, setToken] = useState(() => localStorage.getItem("replay-room-token") || "");
  const [events, setEvents] = useState<Event[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [reliability, setReliability] = useState<EndpointReliability[]>([]);
  const [system, setSystem] = useState<SystemSnapshot | null>(null);
  const [selected, setSelected] = useState<Detail | null>(null);
  const [message, setMessage] = useState("Enter the Render-generated admin token to open the console.");
  const [busy, setBusy] = useState(false);

  const auth = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const request = useCallback(async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
    const response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...auth, ...(init.headers || {}) },
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
    return body as T;
  }, [auth]);

  const refresh = useCallback(async (silent = false) => {
    if (!token) return;
    if (!silent) setBusy(true);
    try {
      const [nextStats, nextEvents, nextEndpoints, nextReliability, nextSystem] = await Promise.all([
        request<Stats>("/api/stats"), request<Event[]>("/api/events?limit=100"), request<Endpoint[]>("/api/endpoints"), request<EndpointReliability[]>("/api/endpoints/reliability?windowHours=24"), request<SystemSnapshot>("/api/system"),
      ]);
      setStats(nextStats); setEvents(nextEvents); setEndpoints(nextEndpoints); setReliability(nextReliability); setSystem(nextSystem);
      localStorage.setItem("replay-room-token", token);
      setMessage(`Connected to ${API_BASE}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load Replay Room");
    } finally { if (!silent) setBusy(false); }
  }, [request, token]);

  useEffect(() => {
    if (!token) return;
    void refresh();
    const timer = window.setInterval(() => void refresh(true), 5_000);
    return () => window.clearInterval(timer);
  }, [refresh, token]);

  const openEvent = async (id: string) => {
    try { setSelected(await request<Detail>(`/api/events/${id}`)); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not open event"); }
  };

  const createEndpoint = async (form: HTMLFormElement) => {
    const data = new FormData(form);
    const endpoint = await request<Endpoint>("/api/endpoints", {
      method: "POST",
      body: JSON.stringify({ name: data.get("name"), destinationUrl: data.get("destinationUrl"), maxAttempts: 5 }),
    });
    setMessage(`Endpoint created. Send webhooks to ${API_BASE}/ingest/${endpoint.ingestKey}`);
    form.reset(); await refresh();
  };

  const rehearse = async (event: Detail, destinationUrl: string) => {
    await request(`/api/events/${event.id}/rehearse`, {
      method: "POST", headers: { "x-operator": "dashboard" }, body: JSON.stringify({ destinationUrl, notes: "Dashboard rehearsal before operator replay" }),
    });
    setMessage("Rehearsal queued. Refresh in a moment to inspect the result.");
  };

  const replay = async (event: Detail, destinationUrl: string, reason: string) => {
    await request(`/api/events/${event.id}/replay`, {
      method: "POST", headers: { "x-operator": "dashboard" }, body: JSON.stringify({ destinationUrl, reason }),
    });
    setMessage("Guard approved the replay and queued it for delivery.");
  };

  const downloadEvidence = async (event: Detail) => {
    const response = await fetch(`${API_BASE}/api/events/${event.id}/evidence`, { headers: auth });
    if (!response.ok) {
      const body = await response.json();
      throw new Error(body.error || `HTTP ${response.status}`);
    }
    const url = URL.createObjectURL(await response.blob());
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `replay-room-${event.id}.evidence.json`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    setMessage("Signed incident evidence downloaded.");
  };

  return (
    <main>
      <header className="masthead">
        <div className="brand"><span className="mark">RR</span><span>Replay Room</span></div>
        <div className="eyebrow">Event recovery control / Render</div>
      </header>

      <section className="hero">
        <div>
          <p className="kicker">Webhook incidents, reconstructed</p>
          <h1>Every event leaves a flight recorder.</h1>
          <p className="lede">Replay Room explains how delivery failed, rehearses the exact recovery, and seals the evidence before anyone can replay production traffic.</p>
        </div>
        <div className="connection-panel">
          <div className="connection-title"><span>Live stack</span><i className={system ? "online" : ""} /></div>
          <label htmlFor="admin-token">Admin token</label>
          <input id="admin-token" type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder="Render-generated secret" />
          <button onClick={() => void refresh()} disabled={busy}>{busy ? "Connecting..." : "Open console"}</button>
          <small>{message}</small>
        </div>
      </section>

      <IncidentDrill />

      <section className="stats-grid">
        <Stat label="Events" value={stats?.total ?? 0} />
        <Stat label="Delivery rate" value={`${stats?.deliveryRate ?? 100}%`} accent />
        <Stat label="Retrying" value={stats?.retrying ?? 0} />
        <Stat label="Dead letters" value={stats?.deadLetter ?? 0} danger />
      </section>

      <ReliabilityBoard endpoints={reliability} />

      <section className="console-grid">
        <article className="panel event-panel">
          <div className="panel-title"><span>Event stream</span><button className="quiet" onClick={() => void refresh()}>Refresh</button></div>
          <div className="event-list">
            {events.length === 0 && <div className="empty">No events yet. Create an endpoint and send it JSON.</div>}
            {events.map((event) => (
              <button className={`event-row ${selected?.id === event.id ? "selected" : ""}`} key={event.id} onClick={() => void openEvent(event.id)}>
                <span className={`status ${event.status}`}>{event.status.replace("_", " ")}</span>
                <span className="event-id">{event.id.slice(0, 8)}</span>
                <span>{new Date(event.receivedAt).toLocaleTimeString()}</span>
                <span>{event.attemptCount} tries</span>
              </button>
            ))}
          </div>
        </article>

        <article className="panel detail-panel">
          <div className="panel-title"><span>Replay inspector</span><span className="mono">{selected?.id.slice(0, 12) ?? "NO EVENT"}</span></div>
          {selected ? <EventInspector event={selected} onRehearse={rehearse} onReplay={replay} onDownload={(event) => downloadEvidence(event).catch((error) => setMessage(error instanceof Error ? error.message : "Could not download evidence"))} /> : <div className="empty tall">Select an event to see payload, attempts, rehearsal evidence, and audit history.</div>}
        </article>
      </section>

      <section className="bottom-grid">
        <article className="panel">
          <div className="panel-title">Create endpoint</div>
          <form className="endpoint-form" onSubmit={(event) => { event.preventDefault(); void createEndpoint(event.currentTarget).catch((error) => setMessage(error.message)); }}>
            <input name="name" required minLength={2} placeholder="Billing events" />
            <input name="destinationUrl" required type="url" placeholder="https://your-app.com/webhooks" />
            <button>Create ingest URL</button>
          </form>
        </article>
        <RenderFabric system={system} />
      </section>
      <footer>{endpoints.length} endpoint{endpoints.length === 1 ? "" : "s"} configured · no replay without evidence</footer>
    </main>
  );
}

function Stat({ label, value, accent, danger }: { label: string; value: string | number; accent?: boolean; danger?: boolean }) {
  return <div className={`stat ${accent ? "accent" : ""} ${danger ? "danger" : ""}`}><span>{label}</span><strong>{value}</strong></div>;
}

function ReliabilityBoard({ endpoints }: { endpoints: EndpointReliability[] }) {
  return <section className="runway-board" aria-label="Endpoint reliability over the last 24 hours">
    <div className="runway-heading"><span>Endpoint runway / 24 hours</span><small>Success rate counts terminal deliveries. In-flight events do not reduce it.</small></div>
    {endpoints.length === 0 ? <div className="runway-empty">Connect the live stack to inspect destination reliability.</div> : <div className="runway-rows">
      {endpoints.map((endpoint) => <div className={`runway-row ${endpoint.state}`} key={endpoint.endpointId}>
        <span className="runway-state"><i />{endpoint.state.replace("_", " ")}</span>
        <span className="runway-name"><strong>{endpoint.name}</strong><small>{destinationHost(endpoint.destinationUrl)}</small></span>
        <span className="runway-volume"><b>{endpoint.total}</b><small>events</small></span>
        <span className="runway-rate">
          <span><b>{endpoint.deliveryRate}%</b><small>delivered</small></span>
          <i role="progressbar" aria-label={`${endpoint.name} delivery rate`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={endpoint.deliveryRate}><b style={{ width: `${endpoint.deliveryRate}%` }} /></i>
        </span>
        <span className="runway-latency"><b>{endpoint.p95LatencyMs === null ? "–" : `${endpoint.p95LatencyMs}ms`}</b><small>p95 latency</small></span>
        <span className="runway-failures"><b>{endpoint.retrying} / {endpoint.deadLetter}</b><small>retrying / dead</small></span>
      </div>)}
    </div>}
  </section>;
}

function destinationHost(destinationUrl: string): string {
  try { return new URL(destinationUrl).host; }
  catch { return destinationUrl; }
}

function RenderFabric({ system }: { system: SystemSnapshot | null }) {
  const embedded = system?.deploy.topology === "embedded-free";
  return <article className="panel fabric-panel" aria-live="polite">
    <div className="panel-title"><span>Live Render fabric</span><span className="mono">{system?.deploy.commit ?? "not connected"}</span></div>
    <div className="fabric-map">
      <FabricNode name="API" kind="web service" state={system?.components.api.state ?? "waiting"} metric={system ? `${system.components.api.uptimeSeconds}s up` : "waiting"} />
      <FabricNode name="Postgres" kind="durable ledger" state={system?.components.database.state ?? "waiting"} metric={system ? `${system.components.database.latencyMs}ms` : "waiting"} />
      <FabricNode name="Key Value" kind="BullMQ transport" state={system?.components.queue.state ?? "waiting"} metric={system ? `${system.components.queue.latencyMs}ms` : "waiting"} />
      <FabricNode name="Worker" kind={embedded ? "embedded consumer" : "background service"} state={system?.components.worker.state ?? "waiting"} metric={ageLabel(system?.components.worker.heartbeatAgeSeconds)} />
      <FabricNode name="Reconciler" kind={embedded ? "embedded loop" : "cron service"} state={system?.components.cron.state ?? "waiting"} metric={ageLabel(system?.components.cron.heartbeatAgeSeconds)} />
    </div>
    <dl className="queue-load">
      <div><dt>Waiting</dt><dd>{system?.components.queue.jobs.waiting ?? "–"}</dd></div>
      <div><dt>Active</dt><dd>{system?.components.queue.jobs.active ?? "–"}</dd></div>
      <div><dt>Delayed</dt><dd>{system?.components.queue.jobs.delayed ?? "–"}</dd></div>
      <div><dt>Failed</dt><dd>{system?.components.queue.jobs.failed ?? "–"}</dd></div>
    </dl>
    <p className="fabric-note">{system ? `${system.deploy.service} / ${system.deploy.instance} / ${system.deploy.topology} / observed ${new Date(system.observedAt).toLocaleTimeString()}` : "Connect the live stack to read dependency latency, queue pressure, and service heartbeats."}</p>
  </article>;
}

function FabricNode({ name, kind, state = "waiting", metric }: { name: string; kind: string; state?: ComponentState; metric: string }) {
  return <div className={`fabric-node ${state}`}>
    <i />
    <span><strong>{name}</strong><small>{kind}</small></span>
    <b>{metric}</b>
  </div>;
}

function ageLabel(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "not seen";
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.round(seconds / 60)}m ago`;
}

function EventInspector({ event, onRehearse, onReplay, onDownload }: {
  event: Detail;
  onRehearse: (event: Detail, target: string) => Promise<void>;
  onReplay: (event: Detail, target: string, reason: string) => Promise<void>;
  onDownload: (event: Detail) => Promise<void>;
}) {
  const [target, setTarget] = useState(event.endpoint.destinationUrl);
  const [reason, setReason] = useState("Receiver fix verified; replay approved after rehearsal.");
  return <div className="inspector">
    <div className={`diagnosis ${event.diagnosis.severity}`}>
      <div><span>Flight recorder diagnosis</span><b>{event.diagnosis.code.replaceAll("_", " ")}</b></div>
      <h3>{event.diagnosis.headline}</h3>
      <p>{event.diagnosis.summary}</p>
      <ul>{event.diagnosis.evidence.map((item) => <li key={item}>{item}</li>)}</ul>
      <small>{event.diagnosis.nextAction}</small>
    </div>
    <div className="evidence-strip">
      <span><b>Signed evidence</b><small>Portable JSON with an HMAC integrity seal</small></span>
      <button onClick={() => void onDownload(event)}>Download bundle</button>
    </div>
    <div className="guard-banner"><span>Replay guard</span><strong>{event.status === "dead_letter" ? "Waiting for rehearsal evidence" : "Replay locked"}</strong></div>
    <pre>{JSON.stringify(event.payload, null, 2)}</pre>
    <div className="action-form">
      <label>Rehearsal / replay target</label><input value={target} onChange={(e) => setTarget(e.target.value)} />
      <label>Operator reason</label><textarea value={reason} onChange={(e) => setReason(e.target.value)} />
      <div className="actions"><button onClick={() => void onRehearse(event, target)}>Run rehearsal</button><button className="danger-button" onClick={() => void onReplay(event, target, reason)}>Approve replay</button></div>
    </div>
    <div className="timeline">
      {[...event.audit, ...event.rehearsals.map((item) => ({ ...item, action: item.passed ? "rehearsal.passed" : "rehearsal.failed", actor: "worker", reason: item.notes }))]
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 6)
        .map((item) => <div key={item.id}><span>{new Date(item.createdAt).toLocaleTimeString()}</span><strong>{item.action}</strong><small>{item.reason}</small></div>)}
    </div>
  </div>;
}
