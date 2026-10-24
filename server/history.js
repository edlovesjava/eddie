// Local version history: content-addressed snapshots of every save.
//
// Git stays the real VCS; this is the safety net for the churn between
// commits and for files outside any repo. Objects are gzipped full contents
// keyed by the same 16-hex sha256 prefix the trace stamps on save records
// (context.doc.hash), so a History row and its snapshot join on the hash.
// The index is append-only JSONL, pruned by age; personal scale throughout
// (read it whole, filter in memory).
//
// Layout: ~/.eddie/history/objects/<hash>.gz + ~/.eddie/history/index.jsonl

const fsp = require("fs/promises");
const path = require("path");
const os = require("os");
const zlib = require("zlib");
const crypto = require("crypto");

const HIST_DIR = path.join(os.homedir(), ".eddie", "history");
const OBJ_DIR = path.join(HIST_DIR, "objects");
const INDEX = path.join(HIST_DIR, "index.jsonl");

function hashOf(text) {
  return crypto.createHash("sha256").update(text).digest("hex").slice(0, 16);
}

function objPath(hash) {
  return path.join(OBJ_DIR, `${hash}.gz`);
}

async function readIndex() {
  try {
    return (await fsp.readFile(INDEX, "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

// Last snapshot hash per path, so consecutive identical saves don't append
// index entries. Loaded lazily from the index once, maintained in memory.
let lastByPath = null;

async function lastHash(filePath) {
  if (!lastByPath) {
    lastByPath = new Map();
    for (const e of await readIndex()) lastByPath.set(e.path, e.hash);
  }
  return lastByPath.get(filePath);
}

// Store one version of a file. origin: "save" (eddie wrote it) or "disk"
// (content found on disk that eddie never saw — captured before overwriting
// so external edits aren't lost). Identical-to-last contents are skipped.
async function snapshot(filePath, content, origin = "save") {
  const hash = hashOf(content);
  if ((await lastHash(filePath)) === hash) return { hash, stored: false };
  await fsp.mkdir(OBJ_DIR, { recursive: true });
  try {
    await fsp.access(objPath(hash));
  } catch {
    await fsp.writeFile(objPath(hash), zlib.gzipSync(Buffer.from(content, "utf8")));
  }
  const entry = {
    ts: new Date().toISOString(),
    path: filePath,
    hash,
    bytes: Buffer.byteLength(content, "utf8"),
    origin,
  };
  await fsp.appendFile(INDEX, JSON.stringify(entry) + "\n");
  lastByPath.set(filePath, hash);
  return { hash, stored: true };
}

async function listFor(filePath, limit = 100) {
  const entries = (await readIndex()).filter((e) => e.path === filePath);
  return entries.slice(-limit).reverse(); // newest first
}

async function content(hash) {
  if (!/^[0-9a-f]{16}$/.test(hash)) return null;
  try {
    return zlib.gunzipSync(await fsp.readFile(objPath(hash))).toString("utf8");
  } catch {
    return null;
  }
}

// Drop index entries older than `days` and delete objects nothing references.
// A hash still referenced by a newer entry (unchanged file) survives.
async function prune(days) {
  if (!days || days <= 0) return { removed: 0 };
  const entries = await readIndex();
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const keep = entries.filter((e) => Date.parse(e.ts) >= cutoff);
  if (keep.length === entries.length) return { removed: 0 };
  const kept = new Set(keep.map((e) => e.hash));
  await fsp.writeFile(INDEX, keep.map((e) => JSON.stringify(e)).join("\n") + (keep.length ? "\n" : ""));
  lastByPath = null; // rebuild lazily
  let removed = 0;
  for (const e of entries) {
    if (kept.has(e.hash)) continue;
    try {
      await fsp.unlink(objPath(e.hash));
      removed++;
    } catch {
      /* already gone */
    }
    kept.add(e.hash); // only try each orphan once
  }
  return { removed };
}

module.exports = { snapshot, listFor, content, prune, hashOf };
