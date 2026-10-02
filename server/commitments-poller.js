// Background sweep that keeps commitments fresh without anyone asking:
//   - reads the hub's event log for `funes.minutes.ready` and ingests each new meeting's minutes
//     (through the hub proxy, with this app's token), remembering the last event id in the database;
//   - sends `people.commitment.overdue` once for each promise whose day has passed.
// It only talks when the hub answers, never throws, and is off with PEOPLE_COMMITMENTS_AUTO=0.
// The first time it meets a hub it starts from "now": old meetings are not replayed on their own
// (ask for them with commitments_ingest_minutes).
import fs from "node:fs";
import * as family from "./hoard-link.js";
import { startBackground } from "./hoard-commons/server.js";
import { ingestFromFunes, nudgeOverdue, pollState, setPollSince } from "./commitments.js";

export const EVENT_TYPE = "funes.minutes.ready";
export const SCAN_LIMIT = 2000; // the hub scans this many events per request before filtering by type
const MAX_ATTEMPTS = 5;

const info = { enabled: false, interval_s: 60, last_run_at: null, last_status: "never", last_error: "", ingested: 0, nudged: 0, running: false };
const attempts = new Map();
let job = null;

export const autoEnabled = (env = process.env) => !["0", "false", "no", "off"].includes(String(env.PEOPLE_COMMITMENTS_AUTO ?? "1").trim().toLowerCase());

/** GET a hub path with this app's token. Returns { status, data } (status null when unreachable). */
export async function hubGet(path, { timeoutMs = 8000 } = {}) {
  const { hub, tokenFile } = family.status();
  let token = "";
  try { token = fs.readFileSync(tokenFile, "utf8").trim(); } catch { /* the hub may accept anonymous reads */ }
  const ctl = new AbortController();
  const timeout = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(hub + path, { headers: { Accept: "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, signal: ctl.signal });
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    return { status: res.status, data };
  } catch (error) {
    return { status: null, data: { error: String(error?.message || error) } };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * One sweep. `fetchJson` and `ingest` are injectable for tests. Returns
 * { status: hub_down | baseline | idle | processed | stalled, events, ingested }.
 */
export async function pollOnce({ fetchJson = hubGet, ingest = ingestFromFunes, today } = {}) {
  const since = pollState().since_id;
  if (since === null || since === undefined) {
    const first = await fetchJson("/api/events?limit=1");
    if (first.status !== 200 || !first.data) return { status: "hub_down", events: 0, ingested: [], detail: first.data?.error || `HTTP ${first.status}` };
    setPollSince(Number(first.data.last_id) || 0);
    return { status: "baseline", events: 0, ingested: [], since_id: Number(first.data.last_id) || 0 };
  }
  const cursor = Number(since) || 0;
  const reply = await fetchJson(`/api/events?type=${encodeURIComponent(EVENT_TYPE)}&since_id=${cursor}&limit=${SCAN_LIMIT}&order=asc`);
  if (reply.status !== 200 || !reply.data || !Array.isArray(reply.data.events)) {
    return { status: "hub_down", events: 0, ingested: [], detail: reply.data?.error || `HTTP ${reply.status}` };
  }
  const events = reply.data.events.filter((e) => e && e.type === EVENT_TYPE).sort((a, b) => a.id - b.id);
  const lastId = Number(reply.data.last_id) || cursor;
  const ingested = [];
  let done = cursor;
  for (const event of events) {
    const sessionId = String(event.data?.session_id || "");
    if (sessionId && Number(event.data?.action_items) !== 0) {
      const result = await ingest(sessionId, { today });
      if (result.status === "hub_down" || result.status === "funes_error") {
        const tries = (attempts.get(event.id) || 0) + 1;
        attempts.set(event.id, tries);
        info.last_error = `${sessionId}: ${result.detail || result.status}`;
        if (tries < MAX_ATTEMPTS) return { status: "stalled", events: events.length, ingested, detail: info.last_error };
        // after repeated failures give up on this one so a broken meeting cannot block the rest
      } else {
        ingested.push({ event_id: event.id, session_id: sessionId, status: result.status, created: result.created || 0, queued: result.queued || 0 });
      }
    }
    attempts.delete(event.id);
    done = event.id;
    setPollSince(done);
  }
  // everything up to the hub's last id was scanned unless the window was full
  const truncated = lastId - cursor > SCAN_LIMIT;
  const next = truncated ? Math.max(done, cursor + SCAN_LIMIT) : Math.max(done, lastId);
  if (next !== done) setPollSince(next);
  return { status: events.length ? "processed" : "idle", events: events.length, ingested };
}

export async function sweep(options = {}) {
  if (info.running) return { status: "busy" };
  info.running = true;
  try {
    const result = await pollOnce(options);
    info.last_run_at = new Date().toISOString();
    info.last_status = result.status;
    info.ingested += result.ingested.length;
    if (result.status === "hub_down") info.last_error = result.detail || "hub_down";
    else if (result.status !== "stalled") info.last_error = "";
    if (result.status !== "hub_down") info.nudged += await nudgeOverdue({ today: options.today });
    return result;
  } catch (error) {
    info.last_status = "error";
    info.last_error = String(error?.message || error);
    return { status: "error", detail: info.last_error };
  } finally {
    info.running = false;
  }
}

export const syncStatus = () => ({ ...info, ...pollState(), hub: family.status().hub });

export function startPoller({ intervalMs = 60000, env = process.env } = {}) {
  stopPoller();
  info.enabled = autoEnabled(env);
  info.interval_s = Math.round(intervalMs / 1000);
  if (!info.enabled) { info.last_status = "off"; return false; }
  // the family's startBackground: no overlapping sweeps, a failing one is logged and the loop goes on, timers do not hold the process
  job = startBackground({ name: "people-commitments", intervalMs, firstDelayMs: 2000, tick: () => sweep() });
  return true;
}

export function stopPoller() {
  job?.stop();
  job = null;
}
