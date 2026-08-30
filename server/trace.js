// Eddie trace log — the auditable substrate (docs/design/ai-integration.md §1).
// Append-only JSONL segments under ~/.eddie/trace/; the event bus is this
// log's live tail (one write path: append → publish). Dependency-free.

const fs = require("fs");
const path = require("path");
const os = require("os");

const TRACE_DIR = path.join(os.homedir(), ".eddie", "trace");
const MEMORY_CAP = 5000; // recent records kept in memory for query/chain
const KINDS = ["event", "message", "action", "proposal", "decision", "run", "outcome", "lesson"];

let records = [];
const byId = new Map();
const subscribers = new Set();
let seq = 0;
let lastWriteError = null;

function segmentPath(date = new Date()) {
  return path.join(TRACE_DIR, `${date.toISOString().slice(0, 10)}.jsonl`);
}

function init() {
  fs.mkdirSync(TRACE_DIR, { recursive: true });
  // Load the two most recent segments so "why?" chains survive a restart.
  const segments = fs
    .readdirSync(TRACE_DIR)
    .filter((f) => f.endsWith(".jsonl"))
    .sort()
    .slice(-2);
  for (const seg of segments) {
    for (const line of fs.readFileSync(path.join(TRACE_DIR, seg), "utf8").split("\n")) {
      if (!line) continue;
      try {
        remember(JSON.parse(line));
      } catch {
        /* skip corrupt line; the log is append-only, never repaired in place */
      }
    }
  }
}

function remember(rec) {
  records.push(rec);
  byId.set(rec.id, rec);
  if (records.length > MEMORY_CAP) {
    const evicted = records.splice(0, records.length - MEMORY_CAP);
    for (const e of evicted) byId.delete(e.id);
  }
}

function newId() {
  return `r_${Date.now().toString(36)}${(++seq).toString(36).padStart(3, "0")}`;
}

// Append a record. Fills in id/ts/defaults; returns the full record.
function append(partial) {
  if (!KINDS.includes(partial.kind)) throw new Error(`bad record kind: ${partial.kind}`);
  const rec = {
    id: newId(),
    ts: new Date().toISOString(),
    actor: partial.actor || { kind: "system", id: "eddie" },
    thread: partial.thread || null,
    cause: partial.cause || [],
    context: partial.context || {},
    kind: partial.kind,
    body: partial.body || {},
  };
  if (!rec.thread) rec.thread = `t_${rec.id.slice(2)}`;
  fs.appendFile(segmentPath(), JSON.stringify(rec) + "\n", (err) => {
    if (err && err.message !== lastWriteError) {
      lastWriteError = err.message;
      console.error(`trace write failed — history will not persist: ${err.message}`);
    } else if (!err) {
      lastWriteError = null;
    }
  });
  remember(rec);
  for (const fn of subscribers) {
    try {
      fn(rec);
    } catch {
      /* a bad subscriber must not break the write path */
    }
  }
  return rec;
}

function subscribe(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

function get(id) {
  return byId.get(id) || null;
}

function query({ kinds, thread, actorKind, limit = 100 } = {}) {
  const out = [];
  for (let i = records.length - 1; i >= 0 && out.length < limit; i--) {
    const r = records[i];
    if (kinds && !kinds.includes(r.kind)) continue;
    if (thread && r.thread !== thread) continue;
    if (actorKind && r.actor.kind !== actorKind) continue;
    out.push(r);
  }
  return out;
}

// Walk cause edges breadth-first: the "why?" chain for a record.
function chain(id, maxDepth = 8) {
  const seen = new Set();
  const layers = [];
  let frontier = [id];
  for (let depth = 0; depth <= maxDepth && frontier.length; depth++) {
    const layer = [];
    const next = [];
    for (const rid of frontier) {
      if (seen.has(rid)) continue;
      seen.add(rid);
      const rec = byId.get(rid);
      layer.push(rec || { id: rid, missing: true });
      if (rec) next.push(...(rec.cause || []));
    }
    if (layer.length) layers.push(layer);
    frontier = next;
  }
  return layers;
}

module.exports = { init, append, subscribe, get, query, chain, KINDS, writeError: () => lastWriteError };
