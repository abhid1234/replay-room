import { useEffect, useMemo, useState } from "react";

type DrillStep = {
  phase: string;
  title: string;
  detail: string;
  signal: string;
  node: number;
  tone: "normal" | "warning" | "critical" | "success";
};

const STEPS: DrillStep[] = [
  { phase: "00:00.000", title: "Payment event captured", detail: "Event and recoverable delivery intent persisted before queue dispatch", signal: "202", node: 1, tone: "normal" },
  { phase: "00:00.082", title: "Worker claimed intent", detail: "Postgres claim and BullMQ lease acquired by worker-07", signal: "RUN", node: 3, tone: "normal" },
  { phase: "00:00.241", title: "Receiver unavailable", detail: "First attempt returned a retryable response", signal: "503", node: 4, tone: "warning" },
  { phase: "00:02.418", title: "Retry budget exhausted", detail: "Backoff completed; event moved to dead letter", signal: "DLQ", node: 2, tone: "critical" },
  { phase: "00:03.104", title: "Rehearsal accepted", detail: "Exact payload delivered to the recovery target", signal: "204", node: 4, tone: "success" },
  { phase: "00:03.160", title: "Replay risk assessed", detail: "Idempotency evidence present; receiver failure remains elevated risk", signal: "ELEV", node: 1, tone: "warning" },
  { phase: "00:03.188", title: "Replay guard sealed", detail: "Payload hash and destination match rehearsal evidence", signal: "PASS", node: 1, tone: "success" },
  { phase: "00:03.402", title: "Production replay delivered", detail: "Operator reason recorded in the audit trail", signal: "204", node: 4, tone: "success" },
];

const NODES = ["Ingress", "Ledger", "Queue", "Worker", "Receiver"];

export function IncidentDrill() {
  const [stepIndex, setStepIndex] = useState(-1);
  const activeStep = stepIndex >= 0 ? STEPS[stepIndex] : null;
  const complete = stepIndex === STEPS.length - 1;
  const playing = stepIndex >= 0 && !complete;

  useEffect(() => {
    if (!playing) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = window.setTimeout(() => setStepIndex((current) => Math.min(current + 1, STEPS.length - 1)), reduceMotion ? 120 : 820);
    return () => window.clearTimeout(timer);
  }, [playing, stepIndex]);

  const completedNodes = useMemo(() => new Set(STEPS.slice(0, Math.max(stepIndex, 0)).map((step) => step.node)), [stepIndex]);

  return (
    <section className={`incident-drill ${playing ? "is-running" : ""}`} aria-label="Interactive webhook outage drill">
      <div className="drill-heading">
        <div>
          <span className="drill-index">Incident drill / RR-1042</span>
          <h2>Watch one event survive an outage.</h2>
          <p>This is a simulated trace. Run it to see the safety system—not a marketing animation—step through the same states used by the real worker.</p>
        </div>
        <button className="drill-trigger" onClick={() => setStepIndex(0)} disabled={playing}>
          <span className="trigger-light" />
          {playing ? "Drill running" : complete ? "Run it again" : "Run outage drill"}
        </button>
      </div>

      <div className="flight-board">
        <div className="route-track" aria-label="Event delivery route">
          {NODES.map((node, index) => {
            const isActive = activeStep?.node === index;
            const isFailed = index === 4 && activeStep?.tone === "warning";
            return (
              <div className={`route-stop ${isActive ? "active" : ""} ${completedNodes.has(index) ? "visited" : ""} ${isFailed ? "failed" : ""}`} key={node}>
                <span className="stop-dot"><i /></span>
                <strong>{node}</strong>
                <small>{index === 0 ? "public" : index === 1 ? "postgres" : index === 2 ? "key value" : index === 3 ? "background" : "external"}</small>
              </div>
            );
          })}
          <div className="route-rail"><span style={{ width: `${stepIndex < 0 ? 0 : ((stepIndex + 1) / STEPS.length) * 100}%` }} /></div>
        </div>

        <div className="telemetry" aria-live="polite">
          <div className={`signal ${activeStep?.tone ?? "idle"}`}>{activeStep?.signal ?? "ARM"}</div>
          <div className="telemetry-copy">
            <span>{activeStep?.phase ?? "Ready for operator"}</span>
            <strong>{activeStep?.title ?? "Outage drill is standing by"}</strong>
            <p>{activeStep?.detail ?? "Nothing moves until you start the simulation."}</p>
          </div>
          <div className="payload-seal">
            <span>Payload seal</span>
            <code>{stepIndex >= 6 ? "sha256:7f3a…91c2 ✓" : "sha256:7f3a…91c2"}</code>
          </div>
        </div>

        <div className="trace-log">
          <div className="trace-head"><span>Flight recorder</span><span>{Math.max(0, stepIndex + 1).toString().padStart(2, "0")} / {STEPS.length.toString().padStart(2, "0")}</span></div>
          <ol>
            {STEPS.map((step, index) => (
              <li className={`${index <= stepIndex ? "revealed" : ""} ${index === stepIndex ? "current" : ""}`} key={step.title}>
                <time>{step.phase}</time>
                <span>{step.title}</span>
                <b className={step.tone}>{step.signal}</b>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
