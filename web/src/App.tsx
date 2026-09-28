import { useCallback, useEffect, useMemo, useState } from "react";

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
type Detail = Event & {
  endpoint: Endpoint;
  attempts: Array<{ id: string; mode: string; statusCode: number | null; error: string | null; durationMs: number; createdAt: string }>;
  rehearsals: Array<{ id: string; passed: boolean; destinationUrl: string; notes: string; createdAt: string }>;
  audit: Array<{ id: string; action: string; actor: string; reason: string | null; createdAt: string }>;
};

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:4000";

export function App() {
  const [token, setToken] = useState(() => localStorage.getItem("replay-room-token") || "");
  const [events, setEvents] = useState<Event[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
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

  const refresh = useCallback(async () => {
    if (!token) return;
    setBusy(true);
    try {
      const [nextStats, nextEvents, nextEndpoints] = await Promise.all([
        request<Stats>("/api/stats"), request<Event[]>("/api/events?limit=100"), request<Endpoint[]>("/api/endpoints"),
      ]);
      setStats(nextStats); setEvents(nextEvents); setEndpoints(nextEndpoints);
      localStorage.setItem("replay-room-token", token);
      setMessage(`Connected to ${API_BASE}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load Replay Room");
    } finally { setBusy(false); }
  }, [request, token]);

  useEffect(() => { void refresh(); }, []);

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

  return (
    <main>
      <header className="masthead">
        <div className="brand"><span className="mark">RR</span><span>Replay Room</span></div>
        <div className="eyebrow">webhook operations lab / built for Render</div>
      </header>

      <section className="hero">
        <div>
          <p className="kicker">INCIDENTS NEED A REHEARSAL</p>
          <h1>Retry the event.<br/><em>Not the mistake.</em></h1>
          <p className="lede">Capture every webhook, let workers deliver it, rehearse dead letters against a safe target, then approve a production replay with an immutable audit trail.</p>
        </div>
        <div className="connection-panel">
          <label>Admin token</label>
          <input type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder="Render-generated secret" />
          <button onClick={() => void refresh()} disabled={busy}>{busy ? "Connecting..." : "Open console"}</button>
          <small>{message}</small>
        </div>
      </section>

      <section className="stats-grid">
        <Stat label="Events" value={stats?.total ?? 0} />
        <Stat label="Delivery rate" value={`${stats?.deliveryRate ?? 100}%`} accent />
        <Stat label="Retrying" value={stats?.retrying ?? 0} />
        <Stat label="Dead letters" value={stats?.deadLetter ?? 0} danger />
      </section>

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
          {selected ? <EventInspector event={selected} onRehearse={rehearse} onReplay={replay} /> : <div className="empty tall">Select an event to see payload, attempts, rehearsal evidence, and audit history.</div>}
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
        <article className="panel architecture">
          <div className="panel-title">Render topology</div>
          <div className="topology"><span>Static dashboard</span><b>→</b><span>API service</span><b>→</b><span>Key Value</span><b>→</b><span>Worker</span><b>→</b><span>Destination</span></div>
          <p>Postgres is the durable ledger. A cron service reconciles stuck work and enforces retention. The whole stack is declared in one Blueprint.</p>
        </article>
      </section>
      <footer>{endpoints.length} endpoint{endpoints.length === 1 ? "" : "s"} configured · no replay without evidence</footer>
    </main>
  );
}

function Stat({ label, value, accent, danger }: { label: string; value: string | number; accent?: boolean; danger?: boolean }) {
  return <div className={`stat ${accent ? "accent" : ""} ${danger ? "danger" : ""}`}><span>{label}</span><strong>{value}</strong></div>;
}

function EventInspector({ event, onRehearse, onReplay }: {
  event: Detail;
  onRehearse: (event: Detail, target: string) => Promise<void>;
  onReplay: (event: Detail, target: string, reason: string) => Promise<void>;
}) {
  const [target, setTarget] = useState(event.endpoint.destinationUrl);
  const [reason, setReason] = useState("Receiver fix verified; replay approved after rehearsal.");
  return <div className="inspector">
    <div className="guard-banner"><span>REPLAY GUARD</span><strong>{event.status === "dead_letter" ? "Waiting for rehearsal evidence" : "Replay locked"}</strong></div>
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
