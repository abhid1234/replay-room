// Records the Replay Room demo from the local v0.3.0 stack with CDP screencast frames,
// a drawn cursor, captions, and a closing card. Writes frames/, frames.txt, markers.json, shots/.
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

// Usage: ADMIN_TOKEN=... node launch/video/record.cjs  (see launch/video/README.md)
const os = require("os");
const DIR = process.env.RR_VIDEO_OUT || path.join(os.tmpdir(), "replay-room-video");
const FRAMES = path.join(DIR, "frames");
const SHOTS = path.join(DIR, "shots");
fs.rmSync(FRAMES, { recursive: true, force: true });
fs.mkdirSync(FRAMES, { recursive: true });
fs.mkdirSync(SHOTS, { recursive: true });

const token = process.env.ADMIN_TOKEN;
if (!token) throw new Error("Set ADMIN_TOKEN to the local API's admin token");
const staged = JSON.parse(fs.readFileSync(path.join(DIR, "staged.json"), "utf8"));
const CONSOLE_URL = process.env.RR_CONSOLE || "http://localhost:4173/";
const FIXED_RECEIVER = "http://127.0.0.1:4000/demo/sink/accept";
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const OVERLAY_CSS = `
  .ingest-card code { filter: blur(7px); }
  #rr-cap { position: fixed; left: 50%; bottom: 36px; transform: translateX(-50%); width: max-content; max-width: 1240px;
    padding: 15px 24px 16px 22px; background: rgba(244, 240, 231, .97); color: #151617; border-left: 6px solid #d84f2a;
    border-radius: 6px; font: 600 26px/1.34 Inter, "Helvetica Neue", Arial, sans-serif; letter-spacing: -.005em;
    box-shadow: 0 14px 44px rgba(0, 0, 0, .5); z-index: 2147483000; text-wrap: balance; }
  #rr-cap[hidden] { display: none; }
  #rr-badge { position: fixed; top: 16px; right: 18px; padding: 8px 12px; background: rgba(244, 240, 231, .94); color: #151617;
    border-radius: 4px; font: 600 14px/1 "IBM Plex Mono", Menlo, monospace; letter-spacing: .03em; z-index: 2147483000; }
  #rr-cursor { position: fixed; left: 1180px; top: 640px; width: 30px; height: 30px; z-index: 2147483001; pointer-events: none;
    transition: left .6s cubic-bezier(.22, .8, .3, 1), top .6s cubic-bezier(.22, .8, .3, 1); filter: drop-shadow(0 2px 3px rgba(0,0,0,.45)); }
  #rr-ripple { position: fixed; left: -100px; top: -100px; width: 46px; height: 46px; margin: -23px 0 0 -23px; border-radius: 50%;
    border: 3px solid #d84f2a; z-index: 2147483000; pointer-events: none; opacity: 0; }
  #rr-ripple.on { animation: rr-ripple .55s ease-out; }
  @keyframes rr-ripple { from { opacity: .95; transform: scale(.35); } to { opacity: 0; transform: scale(1.45); } }
  #rr-card { position: fixed; inset: 0; display: grid; place-content: center; justify-items: center; gap: 22px; text-align: center;
    background: #f4f0e7; color: #151617; z-index: 2147483002; }
  #rr-card[hidden] { display: none; }
  #rr-card .eyebrow { display: flex; align-items: center; gap: 12px; font: 600 18px/1 "IBM Plex Mono", Menlo, monospace; letter-spacing: .16em; text-transform: uppercase; }
  #rr-card .eyebrow::before { content: ""; width: 40px; height: 4px; background: #d84f2a; }
  #rr-card h1 { margin: 0; max-width: 1100px; font: 500 76px/1.04 Newsreader, Georgia, serif; letter-spacing: -.02em; }
  #rr-card h1 span { color: #d84f2a; }
  #rr-card .url { font: 600 26px/1.2 "IBM Plex Mono", Menlo, monospace; }
  #rr-card .note { font: 500 18px/1.4 Inter, Arial, sans-serif; color: #5d6266; }
`;

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1.2 });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  const cdp = await context.newCDPSession(page);

  const frames = [];
  const markers = {};
  let paused = false;
  let count = 0;
  cdp.on("Page.screencastFrame", async ({ data, metadata, sessionId }) => {
    cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
    if (paused) return;
    const file = path.join(FRAMES, `f${String(count++).padStart(6, "0")}.jpg`);
    fs.writeFileSync(file, Buffer.from(data, "base64"));
    frames.push({ file, t: metadata.timestamp });
  });
  const mark = (name) => { markers[name] = Date.now() / 1000; };

  await page.goto(CONSOLE_URL, { waitUntil: "networkidle" });
  await page.addStyleTag({ url: "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@500;600&family=Newsreader:opsz,wght@6..72,500&display=block" }).catch(() => {});
  await page.addStyleTag({ content: OVERLAY_CSS });
  await page.evaluate(() => {
    const add = (tag, id, html = "") => { const el = document.createElement(tag); el.id = id; el.innerHTML = html; document.body.append(el); return el; };
    add("div", "rr-cap").hidden = true;
    add("div", "rr-badge", "Local run · Replay Room v0.3.0 · synthetic events");
    add("div", "rr-ripple");
    add("div", "rr-cursor", '<svg viewBox="0 0 24 24" width="30" height="30"><path d="M4 2.5 L4 19.5 L8.6 15.4 L11.6 21.8 L14.4 20.5 L11.4 14.2 L17.6 14.2 Z" fill="#fff" stroke="#151617" stroke-width="1.6" stroke-linejoin="round"/></svg>');
    add("div", "rr-card", '<div class="eyebrow">Replay Room</div><h1>Rehearse a failed webhook<br><span>before you replay it.</span></h1><div class="url">github.com/abhid1234/replay-room</div><div class="note">Open source, MIT licensed. Recorded on a local run of v0.3.0 with synthetic events.</div>').hidden = true;
  });
  await page.evaluate(() => document.fonts.ready);
  await wait(600);

  const caption = async (text, holdMs = 0) => {
    await page.evaluate((value) => {
      const cap = document.getElementById("rr-cap");
      if (!value) { cap.hidden = true; return; }
      cap.textContent = value;
      cap.hidden = false;
    }, text);
    if (holdMs) await wait(holdMs);
  };
  const scrollTo = async (locator, block = "center") => {
    await locator.first().evaluate((el, where) => el.scrollIntoView({ behavior: "smooth", block: where }), block);
    await wait(950);
  };
  const pointAt = async (locator) => {
    const box = await locator.first().boundingBox();
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.evaluate(([px, py]) => { const c = document.getElementById("rr-cursor"); c.style.left = `${px - 5}px`; c.style.top = `${py - 3}px`; }, [x, y]);
    await wait(700);
    return { x, y };
  };
  const click = async (locator) => {
    const { x, y } = await pointAt(locator);
    await page.evaluate(([px, py]) => {
      const ripple = document.getElementById("rr-ripple");
      ripple.style.left = `${px}px`; ripple.style.top = `${py}px`;
      ripple.classList.remove("on"); void ripple.offsetWidth; ripple.classList.add("on");
    }, [x, y]);
    await locator.first().click();
    await wait(300);
  };
  const typeInto = async (locator, text, { clear = false } = {}) => {
    await click(locator);
    if (clear) { await locator.first().press("Control+A"); await locator.first().press("Backspace"); await wait(250); }
    await locator.first().pressSequentially(text, { delay: 42 });
    await wait(350);
  };
  const shot = async (name) => {
    paused = true;
    await page.evaluate(() => { for (const id of ["rr-cap", "rr-cursor", "rr-ripple", "rr-badge"]) document.getElementById(id).style.visibility = "hidden"; });
    await page.screenshot({ path: path.join(SHOTS, name) });
    await page.evaluate(() => { for (const id of ["rr-cap", "rr-cursor", "rr-ripple", "rr-badge"]) document.getElementById(id).style.visibility = ""; });
    await wait(150);
    paused = false;
  };
  const row = (id) => page.locator(".event-row").filter({ has: page.locator(".event-id", { hasText: id.slice(0, 8) }) });
  const waitDelivered = (id) => page.waitForFunction((prefix) => [...document.querySelectorAll(".event-row")]
    .some((r) => r.querySelector(".event-id")?.textContent === prefix && r.querySelector(".status")?.textContent === "delivered"), id.slice(0, 8), { timeout: 25000 });
  const button = (name) => page.getByRole("button", { name, exact: true });

  await shot("s01-landing.png");
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 90, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 2 });
  mark("start");
  await wait(900);

  // Scene 1: the public drill.
  await caption("A payment webhook times out. Did the receiver charge the card before the connection dropped?", 4200);
  await caption("The queue can't tell you. Press retry and you might bill the customer twice.", 3600);
  await scrollTo(page.locator(".drill-heading"), "start");
  await caption("The public drill is a labeled simulation that steps through the worker's real states.", 3000);
  mark("drill");
  await click(page.locator(".drill-trigger"));
  await caption("The event is saved first. The receiver fails, retries run out, and it lands in dead letter.", 3400);
  await caption("Then: rehearse the exact payload, assess the risk, pass the guard, and only then replay.", 0);
  await page.waitForFunction(() => document.querySelector(".drill-trigger")?.textContent?.includes("Run it again"), null, { timeout: 15000 });
  mark("drillDone");
  await wait(2600);
  await shot("s02-drill-complete.png");

  // Scene 2: the real console with Event A (elevated risk, one operator).
  await page.locator("#admin-token").fill(token);
  await caption("Now the real console: two payment webhooks failed against a receiver that returned 503.", 0);
  await scrollTo(page.locator(".connection-panel"), "center");
  await click(button("Open console"));
  await page.waitForFunction(() => document.querySelector(".connection-panel small:last-of-type")?.textContent?.startsWith("Connected"), null, { timeout: 15000 });
  await wait(1800);
  mark("console");
  await scrollTo(page.locator(".console-grid"), "start");
  await wait(1200);
  await click(row(staged.eventA));
  await page.locator(".diagnosis").first().waitFor();
  await caption("Event A carried an idempotency key. Diagnosis: receiver outage. Duplicate risk: elevated.", 0);
  await scrollTo(page.locator(".risk-card"), "center");
  await wait(3300);
  await shot("s04-diagnosis.png");

  const operatorA = page.locator(`#replay-operator-${staged.eventA}`);
  const targetA = page.locator(`#replay-target-${staged.eventA}`);
  await scrollTo(page.locator(".action-form"), "center");
  await caption("First, rehearse the exact payload against the fixed receiver.", 0);
  await typeInto(operatorA, "incident-commander");
  await typeInto(targetA, FIXED_RECEIVER, { clear: true });
  await click(button("Run rehearsal"));
  await wait(2400);
  await scrollTo(row(staged.eventA), "center");
  await click(row(staged.eventA));
  await wait(800);
  await scrollTo(page.locator(".timeline"), "center");
  await caption("The rehearsal passed, bound to this payload's hash and this exact URL.", 3200);
  await scrollTo(page.locator(".action-form"), "center");
  await click(button("Check replay"));
  await page.locator(".guard-banner.allowed").waitFor();
  await scrollTo(page.locator(".guard-banner"), "start");
  await caption("Preflight checks all nine conditions without changing anything. All nine pass.", 3600);
  await shot("s05-guard-pass.png");
  await scrollTo(page.locator(".action-form"), "center");
  await click(button("Approve replay"));
  await caption("Approved. The replay goes out through a durable delivery intent in Postgres.", 0);
  await wait(1500);
  await scrollTo(page.locator(".event-panel"), "start");
  await click(page.locator(".event-panel .panel-title button"));
  await waitDelivered(staged.eventA);
  await wait(2200);

  // Scene 3: Event B (high risk, two operators).
  mark("eventB");
  await click(row(staged.eventB));
  await page.waitForFunction((prefix) => document.querySelector(".detail-panel .panel-title .mono")?.textContent?.startsWith(prefix), staged.eventB.slice(0, 12));
  await caption("Event B had no idempotency key, so a second send could repeat the charge. Risk: high.", 0);
  await scrollTo(page.locator(".risk-card"), "center");
  await wait(3600);
  await shot("s06-high-risk.png");

  const operatorB = page.locator(`#replay-operator-${staged.eventB}`);
  const targetB = page.locator(`#replay-target-${staged.eventB}`);
  await scrollTo(page.locator(".action-form"), "center");
  await caption("safety-reviewer rehearses it against the fixed receiver.", 0);
  await typeInto(operatorB, "safety-reviewer");
  await typeInto(targetB, FIXED_RECEIVER, { clear: true });
  await click(button("Run rehearsal"));
  await wait(2400);
  await scrollTo(row(staged.eventB), "center");
  await click(row(staged.eventB));
  await wait(800);
  await scrollTo(page.locator(".risk-card"), "center");
  await caption("High risk needs an explicit acknowledgement and a second operator.", 0);
  await click(page.locator(".risk-acknowledgement input"));
  await wait(900);
  await scrollTo(page.locator(".action-form"), "center");
  await click(button("Record approval"));
  await caption("safety-reviewer records a 30-minute approval bound to this rehearsal, payload, and destination.", 3800);
  await click(button("Check replay"));
  await page.locator(".guard-banner.blocked").waitFor();
  await scrollTo(page.locator(".guard-banner"), "start");
  mark("blocked");
  await caption("The approver tries to execute their own approval. Blocked: a different operator must run it.", 4000);
  await shot("s07-self-approval-blocked.png");
  await scrollTo(page.locator(".action-form"), "center");
  await caption("A second operator, incident-commander, checks the same bound evidence.", 0);
  await typeInto(operatorB, "incident-commander", { clear: true });
  await click(button("Check replay"));
  await page.locator(".guard-banner.allowed").waitFor();
  await scrollTo(page.locator(".guard-banner"), "start");
  mark("passB");
  await caption("All nine conditions pass, with the active approval from safety-reviewer.", 3800);
  await shot("s08-dual-control-pass.png");
  await scrollTo(page.locator(".action-form"), "center");
  await click(button("Approve replay"));
  await caption("Replayed through a durable intent. Every decision is in the audit trail.", 0);
  await wait(1500);
  await scrollTo(page.locator(".event-panel"), "start");
  await click(page.locator(".event-panel .panel-title button"));
  await waitDelivered(staged.eventB);
  await click(row(staged.eventB));
  await wait(800);
  await scrollTo(page.locator(".timeline"), "center");
  await wait(3200);
  mark("delivered");

  // Closing card.
  await caption(null);
  await page.evaluate(() => { document.getElementById("rr-card").hidden = false; document.getElementById("rr-badge").style.visibility = "hidden"; document.getElementById("rr-cursor").style.visibility = "hidden"; });
  mark("card");
  await wait(4800);
  mark("end");
  await cdp.send("Page.stopScreencast");
  await wait(300);

  const end = markers.end;
  const lines = [];
  frames.forEach((frame, i) => {
    const next = i + 1 < frames.length ? frames[i + 1].t : end;
    lines.push(`file '${frame.file}'`, `duration ${Math.max(1 / 60, next - frame.t).toFixed(4)}`);
  });
  lines.push(`file '${frames[frames.length - 1].file}'`);
  fs.writeFileSync(path.join(DIR, "frames.txt"), `${lines.join("\n")}\n`);
  const t0 = frames[0].t;
  fs.writeFileSync(path.join(DIR, "markers.json"), JSON.stringify(Object.fromEntries(Object.entries(markers).map(([k, v]) => [k, Number((v - t0).toFixed(2))])), null, 2));
  console.log(`frames=${frames.length} duration=${(end - t0).toFixed(1)}s`, JSON.stringify(markers.start ? Object.fromEntries(Object.entries(markers).map(([k, v]) => [k, Number((v - t0).toFixed(1))])) : {}));
  await browser.close();
})().catch((error) => { console.error(error); process.exit(1); });
