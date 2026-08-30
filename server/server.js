#!/usr/bin/env node
// Eddie server — serves the editor UI and a small JSON API over localhost.
// No dependencies: plain node:http. Binds 127.0.0.1 only.

const http = require("http");
const https = require("https");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const os = require("os");
const { execFile, spawn } = require("child_process");
const crypto = require("crypto");
const trace = require("./trace");

const PORT = parseInt(process.env.EDDIE_PORT || "4517", 10);
const HOST = "127.0.0.1";
const WEB_ROOT = path.join(__dirname, "..", "web");
const EDDIE_HOME = path.join(os.homedir(), ".eddie");
const USER_PLUGIN_DIR = path.join(EDDIE_HOME, "plugins");
const REPO_PLUGIN_DIR = path.join(__dirname, "..", "plugins");
const RECENT_FILE = path.join(EDDIE_HOME, "recent.json");
const MAX_RECENT = 30;
const VERSION = require("../package.json").version;

const LANGUAGES = {
  ".md": "markdown", ".markdown": "markdown", ".mdown": "markdown",
  ".json": "json", ".jsonc": "json",
  ".sh": "shell", ".bash": "shell", ".zsh": "shell",
  ".yml": "yaml", ".yaml": "yaml",
  ".html": "html", ".htm": "html", ".xml": "html", ".svg": "html",
  ".js": "javascript", ".mjs": "javascript", ".cjs": "javascript", ".ts": "javascript",
  ".css": "css", ".txt": "text",
};

function languageFor(file) {
  return LANGUAGES[path.extname(file).toLowerCase()] || "text";
}

// ---------- small helpers ----------

function json(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function readBody(req, limit = 20 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function expandHome(p) {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

function resolvePath(p) {
  if (!p) throw new Error("missing path");
  return path.resolve(expandHome(p));
}

function git(args, cwd) {
  return new Promise((resolve) => {
    execFile("git", args, { cwd, maxBuffer: 20 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, code: err ? err.code : 0, stdout, stderr });
    });
  });
}

async function gitRoot(fileOrDir) {
  let dir = fileOrDir;
  try {
    const st = await fsp.stat(fileOrDir);
    if (!st.isDirectory()) dir = path.dirname(fileOrDir);
  } catch {
    dir = path.dirname(fileOrDir);
  }
  const r = await git(["rev-parse", "--show-toplevel"], dir);
  return r.ok ? r.stdout.trim() : null;
}

// ---------- eddie config (behavior policy) ----------
// Each action is "auto" (just do it), "ask" (UI confirms first), or "never"
// (blocked here on the server, so API callers are refused too).

const CONFIG_DEFAULTS = {
  git: {
    commit: "auto",
    push: "auto",
    pull: "ask",
    autofetch: "auto",
    pullStrategy: "rebase", // rebase | merge | ff-only
  },
  ai: {
    chat: "auto", // auto | never
    command: "claude", // CLI that answers chat prompts (prompt on stdin)
    args: ["-p"],
  },
};

function parseJsonc(text) {
  try {
    return JSON.parse(text);
  } catch {
    return JSON.parse(text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, ""));
  }
}

function deepMerge(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over || {})) {
    out[k] = v && typeof v === "object" && !Array.isArray(v) ? deepMerge(base[k] || {}, v) : v;
  }
  return out;
}

async function loadEddieConfig(fileOrDir) {
  const globalPath = path.join(EDDIE_HOME, "config.json");
  let globalCfg = {};
  let globalExists = false;
  try {
    globalCfg = parseJsonc(await fsp.readFile(globalPath, "utf8"));
    globalExists = true;
  } catch {
    /* missing or bad global config -> defaults */
  }
  let projectCfg = {};
  let projectPath = null;
  const home = os.homedir();
  let dir = fileOrDir ? path.dirname(fileOrDir) : home;
  while (true) {
    try {
      projectCfg = parseJsonc(await fsp.readFile(path.join(dir, ".eddie.json"), "utf8"));
      projectPath = path.join(dir, ".eddie.json");
      break;
    } catch {
      /* keep walking */
    }
    const parent = path.dirname(dir);
    if (parent === dir || dir === home) break;
    dir = parent;
  }
  return {
    config: deepMerge(deepMerge(CONFIG_DEFAULTS, globalCfg), projectCfg),
    globalPath,
    globalExists,
    projectPath,
  };
}

async function gitPolicy(file, action) {
  const { config } = await loadEddieConfig(file);
  return (config.git || {})[action] || CONFIG_DEFAULTS.git[action] || "auto";
}

// ---------- trace helpers & recommendations ----------

function sha(text) {
  return "sha256:" + crypto.createHash("sha256").update(text).digest("hex").slice(0, 16);
}

// Live recommendations: message records with body.subtype "recommendation"
// that haven't been settled (applied/dismissed/resolved). Coalesced by
// producer+anchor so a producer updates its card instead of stacking.
const liveRecs = new Map(); // id -> record

function upsertRecommendation({ producer, anchor, severity, text, actions, resolveOn, cause, actor }) {
  const dupeKey = `${producer}|${JSON.stringify(anchor || { type: "general" })}`;
  const existing = [...liveRecs.values()].find((r) => r.body.dupeKey === dupeKey);
  if (existing && existing.body.text === text) return existing;
  if (existing) liveRecs.delete(existing.id);
  const rec = trace.append({
    kind: "message",
    actor: actor || { kind: "rule", id: producer },
    thread: existing ? existing.thread : undefined,
    cause: existing ? [existing.id, ...(cause || [])] : cause || [],
    body: {
      subtype: "recommendation",
      producer,
      dupeKey,
      anchor: anchor || { type: "general" },
      severity: severity || "passive",
      text,
      actions: actions || [],
      resolveOn: resolveOn || null,
    },
  });
  liveRecs.set(rec.id, rec);
  return rec;
}

function settleRecommendation(id, how, actor, note) {
  const rec = liveRecs.get(id);
  if (!rec) return null;
  liveRecs.delete(id);
  return trace.append({
    kind: how === "resolved" ? "event" : "decision",
    actor: actor || { kind: "system", id: "eddie" },
    thread: rec.thread,
    cause: [id],
    body: how === "resolved" ? { name: "recommendation.resolved" } : { choice: how, note },
  });
}

// Auto-resolve: any event record whose body.name matches a live rec's resolveOn.
trace.subscribe((rec) => {
  if (!rec.body.name || rec.kind === "decision") return;
  for (const [id, r] of liveRecs) {
    if (r.body.resolveOn === rec.body.name) settleRecommendation(id, "resolved", { kind: "system", id: "auto-resolve" });
  }
});

// ---------- git commit importer ----------
// Commit messages are the richest "why" text we get for free. Whenever
// eddie looks at a repo, pull commits it hasn't seen into the trace as
// git.commit.seen events. Baseline on first sight (no history flood);
// commits made through eddie are deduped by remembering their hash.

const GIT_IMPORT_STATE = path.join(EDDIE_HOME, "git-import.json");
let gitImportState = null;

async function loadGitImportState() {
  if (gitImportState) return gitImportState;
  try {
    gitImportState = JSON.parse(await fsp.readFile(GIT_IMPORT_STATE, "utf8"));
  } catch {
    gitImportState = {};
  }
  return gitImportState;
}

async function saveGitImportState() {
  await fsp.mkdir(EDDIE_HOME, { recursive: true });
  await fsp.writeFile(GIT_IMPORT_STATE, JSON.stringify(gitImportState, null, 2)).catch(() => {});
}

function rememberImportedCommit(root, hash) {
  loadGitImportState().then((state) => {
    state[root] = hash;
    saveGitImportState();
  });
}

async function importNewCommits(root) {
  const state = await loadGitImportState();
  const head = await git(["rev-parse", "HEAD"], root);
  if (!head.ok) return;
  const headHash = head.stdout.trim();
  const last = state[root];
  if (last === headHash) return;
  state[root] = headHash;
  await saveGitImportState();
  if (!last) return; // first sight of this repo: baseline only, no flood
  const log = await git(
    ["log", "--pretty=format:%H%x1f%an%x1f%aI%x1f%s", "-n", "20", `${last}..HEAD`],
    root
  );
  if (!log.ok) return;
  for (const line of log.stdout.split("\n").filter(Boolean).reverse()) {
    const [hash, author, when, subject] = line.split(String.fromCharCode(31));
    trace.append({
      kind: "event",
      actor: { kind: "system", id: "git-import" },
      context: { repo: root },
      body: { name: "git.commit.seen", hash, author, when, subject, repo: root },
    });
  }
}

// ---------- recent files ----------

async function loadRecent() {
  try {
    return JSON.parse(await fsp.readFile(RECENT_FILE, "utf8"));
  } catch {
    return [];
  }
}

async function touchRecent(file) {
  try {
    await fsp.mkdir(EDDIE_HOME, { recursive: true });
    let recent = await loadRecent();
    recent = recent.filter((r) => r.path !== file);
    recent.unshift({ path: file, at: Date.now() });
    recent = recent.slice(0, MAX_RECENT);
    await fsp.writeFile(RECENT_FILE, JSON.stringify(recent, null, 2));
  } catch {
    /* recent list is best-effort */
  }
}

// ---------- plugins ----------

async function listPlugins() {
  const out = [];
  for (const [origin, dir] of [["user", USER_PLUGIN_DIR], ["builtin", REPO_PLUGIN_DIR]]) {
    try {
      for (const name of await fsp.readdir(dir)) {
        if (name.endsWith(".js")) out.push({ name, origin, url: `/plugins/${origin}/${name}` });
      }
    } catch {
      /* dir may not exist */
    }
  }
  return out;
}

// ---------- API handlers ----------

const api = {
  "GET /api/health": async (req, res) => {
    json(res, 200, {
      ok: true,
      app: "eddie",
      version: VERSION,
      pid: process.pid,
      traceWriteError: trace.writeError(),
    });
  },

  "GET /api/file": async (req, res, url) => {
    const file = resolvePath(url.searchParams.get("path"));
    let content = "";
    let exists = true;
    try {
      content = await fsp.readFile(file, "utf8");
    } catch (e) {
      if (e.code === "ENOENT") exists = false;
      else throw e;
    }
    if (exists) await touchRecent(file);
    json(res, 200, {
      path: file,
      exists,
      content,
      language: languageFor(file),
      gitRoot: await gitRoot(file),
    });
  },

  "PUT /api/file": async (req, res) => {
    const body = JSON.parse((await readBody(req)).toString("utf8"));
    const file = resolvePath(body.path);
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, body.content, "utf8");
    await touchRecent(file);
    const saveRec = trace.append({
      kind: "action",
      actor: body.actor || { kind: "human", id: "ui" },
      thread: body.thread,
      context: { doc: { path: file, hash: sha(body.content) } },
      body: { name: "file.saved", path: file, bytes: Buffer.byteLength(body.content, "utf8") },
    });
    json(res, 200, {
      ok: true,
      path: file,
      bytes: Buffer.byteLength(body.content, "utf8"),
      record: saveRec.id,
      thread: saveRec.thread,
    });
  },

  "GET /api/list": async (req, res, url) => {
    const dir = resolvePath(url.searchParams.get("path") || os.homedir());
    const names = await fsp.readdir(dir, { withFileTypes: true });
    const entries = names
      .filter((d) => !d.name.startsWith("."))
      .map((d) => ({
        name: d.name,
        path: path.join(dir, d.name),
        dir: d.isDirectory(),
        language: d.isDirectory() ? null : languageFor(d.name),
      }))
      .sort((a, b) => (a.dir !== b.dir ? (a.dir ? -1 : 1) : a.name.localeCompare(b.name)));
    json(res, 200, { path: dir, parent: path.dirname(dir), entries });
  },

  "GET /api/recent": async (req, res) => {
    json(res, 200, { recent: await loadRecent() });
  },

  "GET /api/git/info": async (req, res, url) => {
    const file = resolvePath(url.searchParams.get("path"));
    const root = await gitRoot(file);
    if (!root) return json(res, 200, { root: null });
    const branch = await git(["rev-parse", "--abbrev-ref", "HEAD"], root);
    const status = await git(["status", "--porcelain", "--", file], root);
    const counts = await git(["rev-list", "--left-right", "--count", "@{u}...HEAD"], root);
    let ahead = null;
    let behind = null;
    if (counts.ok) [behind, ahead] = counts.stdout.trim().split(/\s+/).map(Number);
    // Which identity/remote a push from this repo would use (honors
    // per-directory includeIf configs, so it can differ between repos).
    const userName = await git(["config", "user.name"], root);
    const userEmail = await git(["config", "user.email"], root);
    const remote = await git(["remote", "get-url", "--push", "origin"], root);
    importNewCommits(root).catch(() => {});
    // Rule producer: remind about unpushed commits; resolves itself on push.
    if (ahead > 0) {
      upsertRecommendation({
        producer: "unpushed",
        anchor: { type: "ui", target: "panel:git" },
        severity: ahead >= 3 ? "notice" : "passive",
        text: `${ahead} commit${ahead === 1 ? "" : "s"} on ${branch.stdout.trim()} not pushed to ${remote.ok ? remote.stdout.trim() : "the remote"}`,
        actions: [{ label: "Open Git panel", command: "panel:git" }],
        resolveOn: "git.pushed",
      });
    }
    json(res, 200, {
      root,
      branch: branch.ok ? branch.stdout.trim() : null,
      fileStatus: status.stdout.trim() || "clean",
      ahead,
      behind,
      hasUpstream: counts.ok,
      userName: userName.ok ? userName.stdout.trim() : null,
      userEmail: userEmail.ok ? userEmail.stdout.trim() : null,
      remote: remote.ok ? remote.stdout.trim() : null,
    });
  },

  "GET /api/git/status": async (req, res, url) => {
    const file = resolvePath(url.searchParams.get("path"));
    const root = await gitRoot(file);
    if (!root) return json(res, 200, { root: null, status: "" });
    const r = await git(["status", "--porcelain"], root);
    json(res, 200, { root, status: r.stdout });
  },

  "GET /api/git/diff": async (req, res, url) => {
    const file = resolvePath(url.searchParams.get("path"));
    const root = await gitRoot(file);
    if (!root) return json(res, 200, { root: null, diff: "" });
    const r = await git(["diff", "--", file], root);
    json(res, 200, { root, diff: r.stdout });
  },

  "GET /api/git/log": async (req, res, url) => {
    const file = resolvePath(url.searchParams.get("path"));
    const root = await gitRoot(file);
    if (!root) return json(res, 200, { root: null, log: [] });
    const r = await git(["log", "--pretty=format:%H%x1f%h%x1f%an%x1f%ar%x1f%s", "-n", "20", "--", file], root);
    // Commits the upstream doesn't have yet; if there's no upstream at all,
    // nothing has ever been pushed, so everything counts as unpushed.
    const up = await git(["rev-list", "@{u}..HEAD"], root);
    const unpushedSet = new Set(up.ok ? up.stdout.split("\n").filter(Boolean) : []);
    const log = r.stdout
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        const [full, hash, author, when, subject] = l.split(String.fromCharCode(31));
        return { hash, author, when, subject, unpushed: !up.ok || unpushedSet.has(full) };
      });
    json(res, 200, { root, log, hasUpstream: up.ok });
  },

  "POST /api/git/fetch": async (req, res) => {
    const body = JSON.parse((await readBody(req)).toString("utf8"));
    const root = await gitRoot(resolvePath(body.path));
    if (!root) return json(res, 400, { ok: false, error: "not in a git repository" });
    const r = await git(["fetch", "--quiet"], root);
    json(res, 200, { ok: r.ok, error: r.ok ? undefined : r.stderr.trim() });
  },

  "POST /api/git/pull": async (req, res) => {
    const body = JSON.parse((await readBody(req)).toString("utf8"));
    const root = await gitRoot(resolvePath(body.path));
    if (!root) return json(res, 400, { ok: false, error: "not in a git repository" });
    const file2 = resolvePath(body.path);
    if ((await gitPolicy(file2, "pull")) === "never")
      return json(res, 403, { ok: false, error: "pull is disabled by eddie config (git.pull: never)" });
    const strategy = await gitPolicy(file2, "pullStrategy");
    const args =
      strategy === "merge"
        ? ["pull", "--no-rebase", "--no-edit"]
        : strategy === "ff-only"
          ? ["pull", "--ff-only"]
          : ["pull", "--rebase", "--autostash"];
    // Rebase (default) keeps personal history linear; autostash tolerates
    // unsaved working-tree changes. On conflict, abort so the repo is clean.
    const pull = await git(args, root);
    if (!pull.ok) {
      const conflicted = /CONFLICT|could not apply|needs merge/i.test(pull.stderr + pull.stdout);
      if (conflicted) await git(["rebase", "--abort"], root);
      return json(res, 500, {
        ok: false,
        error: conflicted
          ? "local and remote changes conflict — resolve with git in a terminal"
          : (pull.stderr || pull.stdout).trim(),
      });
    }
    trace.append({
      kind: "action",
      actor: { kind: "human", id: "ui" },
      body: { name: "git.pulled", repo: root },
    });
    json(res, 200, { ok: true, output: (pull.stdout || pull.stderr).trim() });
  },

  "POST /api/git/push": async (req, res) => {
    const body = JSON.parse((await readBody(req)).toString("utf8"));
    const file = resolvePath(body.path);
    const root = await gitRoot(file);
    if (!root) return json(res, 400, { ok: false, error: "not in a git repository" });
    if ((await gitPolicy(file, "push")) === "never")
      return json(res, 403, { ok: false, error: "push is disabled by eddie config (git.push: never)" });
    let push = await git(["push"], root);
    if (!push.ok && /no upstream|set-upstream|does not match any/i.test(push.stderr)) {
      const branch = await git(["rev-parse", "--abbrev-ref", "HEAD"], root);
      push = await git(["push", "--set-upstream", "origin", branch.stdout.trim()], root);
    }
    if (!push.ok) return json(res, 500, { ok: false, error: (push.stderr || push.stdout).trim() });
    trace.append({
      kind: "action",
      actor: { kind: "human", id: "ui" },
      body: { name: "git.pushed", repo: root },
    });
    json(res, 200, { ok: true, output: (push.stderr || push.stdout).trim() || "pushed" });
  },

  "POST /api/git/commit": async (req, res) => {
    const body = JSON.parse((await readBody(req)).toString("utf8"));
    const file = resolvePath(body.path);
    const root = await gitRoot(file);
    if (!root) return json(res, 400, { ok: false, error: "not in a git repository" });
    if ((await gitPolicy(file, "commit")) === "never")
      return json(res, 403, { ok: false, error: "commit is disabled by eddie config (git.commit: never)" });
    if (!body.message) return json(res, 400, { ok: false, error: "commit message required" });
    const add = await git(["add", "--", file], root);
    if (!add.ok) return json(res, 500, { ok: false, error: add.stderr });
    const commit = await git(["commit", "-m", body.message, "--", file], root);
    if (!commit.ok) return json(res, 500, { ok: false, error: commit.stderr || commit.stdout });
    const head = await git(["rev-parse", "HEAD"], root);
    trace.append({
      kind: "action",
      actor: { kind: "human", id: "ui" },
      context: { doc: { path: file } },
      body: { name: "git.committed", message: body.message, repo: root, hash: head.ok ? head.stdout.trim() : undefined },
    });
    if (head.ok) rememberImportedCommit(root, head.stdout.trim());
    json(res, 200, { ok: true, output: commit.stdout.trim() });
  },

  "GET /api/fetch": async (req, res, url) => {
    // Read-only fetch of a remote source (https only), e.g. a raw GitHub file.
    const remote = url.searchParams.get("url");
    if (!remote || !remote.startsWith("https://")) {
      return json(res, 400, { ok: false, error: "https:// URL required" });
    }
    https
      .get(remote, (r) => {
        let data = "";
        r.setEncoding("utf8");
        r.on("data", (c) => (data += c));
        r.on("end", () =>
          json(res, 200, { ok: r.statusCode === 200, status: r.statusCode, url: remote, content: data })
        );
      })
      .on("error", (e) => json(res, 502, { ok: false, error: e.message }));
  },

  "GET /api/config": async (req, res, url) => {
    const p = url.searchParams.get("path");
    const file = p ? resolvePath(p) : null;
    json(res, 200, await loadEddieConfig(file));
  },

  "GET /api/lint/config": async (req, res, url) => {
    // Resolve a linter's config file for a given document: walk up from the
    // file's directory looking for any of `names` (comma-separated), stopping
    // at the home directory or filesystem root; fall back to ~/.eddie/<fallback>.
    const file = resolvePath(url.searchParams.get("path"));
    const names = (url.searchParams.get("names") || "").split(",").filter(Boolean);
    const fallback = url.searchParams.get("fallback");
    const home = os.homedir();
    let dir = path.dirname(file);
    while (true) {
      for (const name of names) {
        const p = path.join(dir, name);
        try {
          const content = await fsp.readFile(p, "utf8");
          return json(res, 200, { configPath: p, content, source: "project" });
        } catch {
          /* keep walking */
        }
      }
      const parent = path.dirname(dir);
      if (parent === dir || dir === home) break;
      dir = parent;
    }
    if (fallback && !fallback.includes("/") && !fallback.includes("..")) {
      const p = path.join(EDDIE_HOME, fallback);
      try {
        const content = await fsp.readFile(p, "utf8");
        return json(res, 200, { configPath: p, content, source: "user" });
      } catch {
        return json(res, 200, { configPath: p, content: null, source: "none" });
      }
    }
    json(res, 200, { configPath: null, content: null, source: "none" });
  },

  "POST /api/ai/chat": async (req, res) => {
    const body = JSON.parse((await readBody(req)).toString("utf8"));
    const ctxPath = body.path ? resolvePath(body.path) : null;
    const { config } = await loadEddieConfig(ctxPath);
    const ai = { ...CONFIG_DEFAULTS.ai, ...(config.ai || {}) };
    if (ai.chat === "never") {
      return json(res, 403, { ok: false, error: "AI chat is disabled by eddie config (ai.chat: never)" });
    }
    const parts = [
      "You are the AI assistant panel inside eddie, the user's personal text editor.",
      "Answer the user's latest message. Be concise. Reply in plain markdown.",
    ];
    if (body.context && body.context.text != null) {
      parts.push(
        `\nThe user has this file open: ${body.context.path || "(unsaved)"} (${body.context.language || "text"})`,
        "<<<DOCUMENT", body.context.text, "DOCUMENT>>>"
      );
    }
    parts.push("\nConversation so far:");
    for (const m of body.messages || []) {
      parts.push(`${m.role === "user" ? "User" : "Assistant"}: ${m.text}`);
    }
    const prompt = parts.join("\n");
    const last = (body.messages || []).slice(-1)[0];
    const userMsg = last
      ? trace.append({
          kind: "message",
          actor: { kind: "human", id: "chat" },
          thread: body.thread,
          context: body.context ? { doc: { path: body.context.path, hash: sha(body.context.text || "") } } : {},
          body: { subtype: "chat", role: "user", text: last.text },
        })
      : null;
    const child = spawn(ai.command, ai.args, { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let errOut = "";
    let done = false;
    const finish = (status, obj) => {
      if (!done) {
        done = true;
        json(res, status, obj);
      }
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(504, { ok: false, error: `${ai.command} timed out after 180s` });
    }, 180000);
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => (errOut += c));
    child.on("error", (e) => {
      clearTimeout(timer);
      finish(500, {
        ok: false,
        error: `could not run '${ai.command}': ${e.message} — install it or set ai.command in eddie config`,
      });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        const reply = trace.append({
          kind: "message",
          actor: { kind: "agent", id: "chat" },
          thread: userMsg ? userMsg.thread : body.thread,
          cause: userMsg ? [userMsg.id] : [],
          body: { subtype: "chat", role: "assistant", text: out.trim() },
        });
        return finish(200, { ok: true, reply: out.trim(), thread: reply.thread, record: reply.id });
      }
      else finish(500, { ok: false, error: (errOut || out || `${ai.command} exited with ${code}`).trim().slice(0, 2000) });
    });
    child.stdin.end(prompt);
  },

  // ---- trace & recommendations ----

  "GET /api/events": async (req, res) => {
    // SSE: the live tail of the trace log.
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
    });
    res.write(": connected\n\n");
    const unsub = trace.subscribe((rec) => res.write(`data: ${JSON.stringify(rec)}\n\n`));
    const heartbeat = setInterval(() => res.write(": hb\n\n"), 25000);
    req.on("close", () => {
      unsub();
      clearInterval(heartbeat);
    });
  },

  "GET /api/trace": async (req, res, url) => {
    const p = url.searchParams;
    json(res, 200, {
      records: trace.query({
        kinds: p.get("kinds") ? p.get("kinds").split(",") : undefined,
        thread: p.get("thread") || undefined,
        actorKind: p.get("actor") || undefined,
        limit: Number.isFinite(parseInt(p.get("limit"), 10))
          ? Math.min(parseInt(p.get("limit"), 10), 500)
          : 100,
      }),
    });
  },

  "GET /api/trace/chain": async (req, res, url) => {
    const id = url.searchParams.get("id");
    if (!id) return json(res, 400, { ok: false, error: "id required" });
    // effects: forward links — records (notes, decisions, outcomes) whose
    // cause points at this one.
    const effects = trace.query({ limit: 500 }).filter((r) => (r.cause || []).includes(id));
    json(res, 200, { chain: trace.chain(id), effects });
  },

  "POST /api/trace": async (req, res) => {
    // Client-side ingest: UI actions, outcomes (👍/👎), human messages.
    const body = JSON.parse((await readBody(req, 256 * 1024)).toString("utf8"));
    if (!trace.KINDS.includes(body.kind)) return json(res, 400, { ok: false, error: "bad kind" });
    const rec = trace.append({
      kind: body.kind,
      actor: body.actor || { kind: "human", id: "ui" },
      thread: body.thread,
      cause: body.cause,
      context: body.context,
      body: body.body || {},
    });
    json(res, 200, { ok: true, record: rec });
  },

  "GET /api/recommendations": async (req, res) => {
    json(res, 200, { recommendations: [...liveRecs.values()] });
  },

  "POST /api/recommend": async (req, res) => {
    const body = JSON.parse((await readBody(req)).toString("utf8"));
    if (!body.text || !body.producer) return json(res, 400, { ok: false, error: "producer and text required" });
    const rec = upsertRecommendation(body);
    json(res, 200, { ok: true, record: rec });
  },

  "POST /api/recommend/settle": async (req, res) => {
    // {id, how: applied|dismissed|snoozed|resolved} or {producer, anchor, how: resolved}
    const body = JSON.parse((await readBody(req)).toString("utf8"));
    let id = body.id;
    if (!id && body.producer) {
      const dupeKey = `${body.producer}|${JSON.stringify(body.anchor || { type: "general" })}`;
      const match = [...liveRecs.values()].find((r) => r.body.dupeKey === dupeKey);
      id = match && match.id;
    }
    if (!id || !liveRecs.has(id)) return json(res, 200, { ok: true, settled: false });
    const rec = settleRecommendation(id, body.how || "dismissed", body.actor || { kind: "human", id: "ui" }, body.note);
    json(res, 200, { ok: true, settled: true, record: rec });
  },

  "GET /api/plugins": async (req, res) => {
    json(res, 200, { plugins: await listPlugins(), userPluginDir: USER_PLUGIN_DIR });
  },

  "POST /api/shutdown": async (req, res) => {
    json(res, 200, { ok: true });
    setTimeout(() => process.exit(0), 100);
  },
};

// ---------- static files ----------

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".md": "text/plain; charset=utf-8",
};

async function serveStatic(res, file) {
  try {
    const data = await fsp.readFile(file);
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(data);
    return true;
  } catch {
    return false;
  }
}

// ---------- request routing ----------

const server = http.createServer(async (req, res) => {
  // Guard against DNS rebinding: only accept requests addressed to localhost.
  const host = (req.headers.host || "").split(":")[0];
  if (host !== "127.0.0.1" && host !== "localhost") {
    return json(res, 403, { ok: false, error: "forbidden host" });
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    const handler = api[`${req.method} ${url.pathname}`];
    if (handler) return await handler(req, res, url);

    if (url.pathname.startsWith("/plugins/")) {
      const [, , origin, name] = url.pathname.split("/");
      const dir = origin === "user" ? USER_PLUGIN_DIR : REPO_PLUGIN_DIR;
      if (name && !name.includes("..") && (await serveStatic(res, path.join(dir, name)))) return;
      return json(res, 404, { ok: false, error: "plugin not found" });
    }

    if (req.method === "GET") {
      if (url.pathname === "/" || url.pathname === "/index.html") {
        if (await serveStatic(res, path.join(WEB_ROOT, "index.html"))) return;
      } else {
        const rel = path.normalize(url.pathname).replace(/^([/\\])+/, "");
        const file = path.join(WEB_ROOT, rel);
        if (file.startsWith(WEB_ROOT) && (await serveStatic(res, file))) return;
      }
    }
    json(res, 404, { ok: false, error: "not found" });
  } catch (e) {
    json(res, 500, { ok: false, error: e.message });
  }
});

trace.init();
server.listen(PORT, HOST, () => {
  console.log(`eddie server v${VERSION} listening on http://${HOST}:${PORT}`);
});
