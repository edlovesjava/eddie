// Eddie editor frontend. Bundled with esbuild to /dist/app.js.

import { EditorView, keymap } from "@codemirror/view";
import { EditorState, Compartment, StateEffect, Prec } from "@codemirror/state";
import { indentWithTab } from "@codemirror/commands";
import { basicSetup } from "codemirror";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { json as jsonLang } from "@codemirror/lang-json";
import { StreamLanguage } from "@codemirror/language";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { yaml } from "@codemirror/legacy-modes/mode/yaml";
import { javascript } from "@codemirror/legacy-modes/mode/javascript";
import { css as cssMode } from "@codemirror/legacy-modes/mode/css";
import { html as htmlMode } from "@codemirror/legacy-modes/mode/xml";
import { oneDark } from "@codemirror/theme-one-dark";
import { linter, lintGutter, openLintPanel, closeLintPanel, forceLinting, diagnosticCount } from "@codemirror/lint";
import { jsonParseLinter } from "@codemirror/lang-json";
import { lint as markdownlint } from "markdownlint/sync";
import { marked } from "marked";

const $ = (id) => document.getElementById(id);

const state = {
  path: null,
  language: "text",
  dirty: false,
  gitRoot: null,
  view: null,
  previewOn: false,
  formatters: {}, // language -> {name, format}
  saveHooks: [],
  linters: {}, // language -> [{name, fn, configNames, fallback, defaultConfig}]
  lintPanelOpen: false,
  config: null, // effective eddie config for the open file
  gitInfo: null, // last /api/git/info result
};

function policy(action) {
  return state.config?.git?.[action] || { pull: "ask", pullStrategy: "rebase" }[action] || "auto";
}

async function loadConfig() {
  try {
    const q = state.path ? `?path=${encodeURIComponent(state.path)}` : "";
    state.config = (await api("GET", `/api/config${q}`)).config;
  } catch {
    state.config = null;
  }
}

const langCompartment = new Compartment();
const themeCompartment = new Compartment();

function languageExtension(language) {
  switch (language) {
    case "markdown": return markdown({ base: markdownLanguage });
    case "json": return jsonLang();
    case "shell": return StreamLanguage.define(shell);
    case "yaml": return StreamLanguage.define(yaml);
    case "javascript": return StreamLanguage.define(javascript);
    case "css": return StreamLanguage.define(cssMode);
    case "html": return StreamLanguage.define(htmlMode);
    default: return [];
  }
}

function isDark() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

// ---------- API ----------

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `${method} ${url} failed`);
  return data;
}

// ---------- status bar ----------

let statusTimer = null;
function setStatus(msg, sticky = false) {
  $("status-msg").textContent = msg;
  clearTimeout(statusTimer);
  if (!sticky) statusTimer = setTimeout(() => ($("status-msg").textContent = "ready"), 4000);
}

function setDirty(d) {
  state.dirty = d;
  $("dirty").hidden = !d;
  document.title = (d ? "● " : "") + (state.path ? basename(state.path) : "eddie");
}

function basename(p) {
  return p.split("/").pop();
}

// ---------- editor ----------

function createView(content) {
  if (state.view) state.view.destroy();
  const updateListener = EditorView.updateListener.of((u) => {
    if (u.docChanged) {
      setDirty(true);
      if (state.previewOn && state.language === "markdown") schedulePreview();
    }
    if (u.selectionSet || u.docChanged) {
      const pos = u.state.selection.main.head;
      const line = u.state.doc.lineAt(pos);
      $("status-pos").textContent = `Ln ${line.number}, Col ${pos - line.from + 1}`;
    }
  });
  state.view = new EditorView({
    state: EditorState.create({
      doc: content,
      extensions: [
        Prec.high(keymap.of([{ key: "Enter", run: maybeRunInlineCommand }])),
        basicSetup,
        keymap.of([
          { key: "Mod-s", preventDefault: true, run: () => (save(), true) },
          { key: "Mod-Shift-p", preventDefault: true, run: () => (togglePreview(), true) },
          indentWithTab,
        ]),
        langCompartment.of(languageExtension(state.language)),
        themeCompartment.of(isDark() ? oneDark : []),
        EditorView.lineWrapping,
        lintGutter(),
        linter(lintSource, {
          delay: 400,
          needsRefresh: (u) => u.transactions.some((tr) => tr.effects.some((e) => e.is(relintEffect))),
        }),
        EditorView.updateListener.of((u) => updateLintStatus(u.state)),
        updateListener,
      ],
    }),
    parent: $("editor"),
  });
  state.lintPanelOpen = false;
  state.view.focus();
  forceLinting(state.view);
}

window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (state.view) {
    state.view.dispatch({ effects: themeCompartment.reconfigure(isDark() ? oneDark : []) });
  }
});

function getText() {
  return state.view ? state.view.state.doc.toString() : "";
}

function setText(text) {
  const v = state.view;
  v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: text } });
}

// ---------- file open/save ----------

async function openFile(path) {
  const data = await api("GET", `/api/file?path=${encodeURIComponent(path)}`);
  state.path = data.path;
  state.language = data.language;
  state.gitRoot = data.gitRoot;
  $("home").hidden = true;
  $("main").style.display = "flex";
  $("filename").textContent = data.path;
  $("filename").title = data.path;
  $("status-lang").textContent = data.language;
  createView(data.content);
  setDirty(false);
  if (!data.exists) setStatus("new file — will be created on save");
  loadConfig();
  refreshGitInfo();
  if (data.language === "markdown" && !state.previewOn) togglePreview();
  const url = new URL(location);
  url.searchParams.set("file", data.path);
  history.replaceState(null, "", url);
}

async function save() {
  if (!state.path) return;
  let text = getText();
  for (const hook of state.saveHooks) {
    try {
      const out = await hook(text, { path: state.path, language: state.language });
      if (typeof out === "string" && out !== text) {
        text = out;
        setText(text);
      }
    } catch (e) {
      console.warn("save hook failed:", e);
    }
  }
  try {
    const r = await api("PUT", "/api/file", { path: state.path, content: text });
    if (r.record) state.lastSave = { id: r.record, thread: r.thread, path: state.path };
    setDirty(false);
    setStatus(`saved ${r.bytes} bytes`);
    refreshGitInfo();
  } catch (e) {
    setStatus(`save failed: ${e.message}`, true);
  }
}

// ---------- markdown preview ----------

let previewTimer = null;
function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(renderPreview, 200);
}

function renderPreview() {
  $("preview").innerHTML = marked.parse(getText());
}

function togglePreview() {
  state.previewOn = !state.previewOn;
  $("preview").hidden = !state.previewOn;
  if (state.previewOn) renderPreview();
}

// ---------- formatting ----------

function registerFormatter(language, name, format) {
  state.formatters[language] = { name, format };
}

registerFormatter("json", "json-pretty", (text) => JSON.stringify(JSON.parse(text), null, 2) + "\n");

async function formatDocument() {
  const f = state.formatters[state.language];
  if (!f) return setStatus(`no formatter for ${state.language}`);
  try {
    const out = await f.format(getText(), { path: state.path });
    if (typeof out === "string") {
      setText(out);
      setStatus(`formatted with ${f.name}`);
    }
  } catch (e) {
    setStatus(`format failed: ${e.message}`, true);
  }
}

// ---------- slash commands ----------
//
// Commands run from two places: typed inline ("/table 3x4" + Enter — the
// command text is replaced by its output) or from the Cmd+K palette.
// Plugins add their own with eddie.registerCommand(name, {title, hint, run}).

const commands = new Map();

function registerCommand(name, spec) {
  commands.set(name.toLowerCase().replace(/^\//, ""), { name, ...spec });
}

function insertAtCursor(text) {
  const v = state.view;
  if (!v) return setStatus("open a file first");
  const r = v.state.selection.main;
  v.dispatch({
    changes: { from: r.from, to: r.to, insert: text },
    selection: { anchor: r.from + text.length },
  });
  v.focus();
}

function commandCtx() {
  return {
    insert: insertAtCursor,
    view: state.view,
    path: state.path,
    language: state.language,
    pickFile,
    api,
    setStatus,
  };
}

async function runCommand(name, args = "") {
  const cmd = commands.get(name.toLowerCase().replace(/^\//, ""));
  if (!cmd) return setStatus(`unknown command /${name}`);
  api("POST", "/api/trace", {
    kind: "action",
    context: state.path ? { doc: { path: state.path } } : {},
    body: { name: "command.ran", command: cmd.name, args: args.trim() },
  }).catch(() => {});
  try {
    await cmd.run(args.trim(), commandCtx());
  } catch (e) {
    setStatus(`/${name} failed: ${e.message}`, true);
  }
}

function maybeRunInlineCommand(view) {
  const { head, empty } = view.state.selection.main;
  if (!empty) return false;
  const line = view.state.doc.lineAt(head);
  const before = view.state.sliceDoc(line.from, head);
  const m = before.match(/(?:^|\s)\/([a-z][\w-]*)(?:[ \t]+(\S[^\n]*?))?[ \t]*$/i);
  if (!m || !commands.has(m[1].toLowerCase())) return false;
  const start = line.from + m.index + (m[0].startsWith("/") ? 0 : 1);
  view.dispatch({ changes: { from: start, to: head } });
  runCommand(m[1], m[2] || "");
  return true;
}

// --- command palette (Cmd+K) ---

let paletteSel = 0;

function paletteMatches(query) {
  const q = query.toLowerCase().replace(/^\//, "");
  return [...commands.values()].filter((c) => c.name.toLowerCase().includes(q) || (c.title || "").toLowerCase().includes(q));
}

function renderPalette() {
  const [q] = $("palette-input").value.replace(/^\//, "").split(/\s+/, 1);
  const matches = paletteMatches(q || "");
  paletteSel = Math.min(paletteSel, Math.max(0, matches.length - 1));
  const ul = $("palette-list");
  ul.innerHTML = "";
  matches.forEach((c, i) => {
    const li = document.createElement("li");
    if (i === paletteSel) li.className = "sel";
    const cmd = document.createElement("span");
    cmd.className = "cmd";
    cmd.textContent = `/${c.name}`;
    const title = document.createElement("span");
    title.textContent = c.title || "";
    const hint = document.createElement("span");
    hint.className = "hint";
    hint.textContent = c.hint || "";
    li.append(cmd, title, hint);
    li.onclick = () => runPaletteSelection(i);
    ul.appendChild(li);
  });
  return matches;
}

function openPalette() {
  paletteSel = 0;
  $("palette").hidden = false;
  const input = $("palette-input");
  input.value = "/";
  renderPalette();
  input.focus();
}

function closePalette() {
  $("palette").hidden = true;
  if (state.view) state.view.focus();
}

function runPaletteSelection(index) {
  const matches = renderPalette();
  const pick = matches[index ?? paletteSel];
  if (!pick) return;
  const args = $("palette-input").value.replace(/^\//, "").split(/\s+/).slice(1).join(" ");
  closePalette();
  runCommand(pick.name, args);
}

// --- file picker (used by /link; available to plugins as ctx.pickFile) ---

let pickResolve = null;

function pickFile(startDir) {
  $("linkpick").hidden = false;
  pickBrowse(startDir || dirname(state.path || "~"));
  return new Promise((resolve) => (pickResolve = resolve));
}

function closePick(result) {
  $("linkpick").hidden = true;
  if (pickResolve) {
    pickResolve(result || null);
    pickResolve = null;
  }
  if (state.view) state.view.focus();
}

async function pickBrowse(dir) {
  const data = await api("GET", `/api/list?path=${encodeURIComponent(dir)}`);
  $("linkpick-path").textContent = data.path;
  const ul = $("linkpick-list");
  ul.innerHTML = "";
  const up = document.createElement("li");
  up.innerHTML = '<span class="dir">..</span>';
  up.onclick = () => pickBrowse(data.parent);
  ul.appendChild(up);
  for (const e of data.entries) {
    const li = document.createElement("li");
    const name = document.createElement("span");
    name.textContent = e.name + (e.dir ? "/" : "");
    if (e.dir) name.className = "dir";
    li.appendChild(name);
    if (!e.dir && e.language && e.language !== "text") {
      const meta = document.createElement("span");
      meta.className = "meta";
      meta.textContent = e.language;
      li.appendChild(meta);
    }
    li.onclick = () => (e.dir ? pickBrowse(e.path) : closePick(e.path));
    ul.appendChild(li);
  }
}

// --- path helpers ---

function dirname(p) {
  const i = p.lastIndexOf("/");
  return i > 0 ? p.slice(0, i) : "/";
}

function relPath(fromDir, to) {
  const a = fromDir.split("/").filter(Boolean);
  const b = to.split("/").filter(Boolean);
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return [...Array(a.length - i).fill(".."), ...b.slice(i)].join("/") || ".";
}

// --- built-in commands ---

registerCommand("link", {
  title: "Insert a link to another doc",
  hint: "opens a file picker",
  run: async (args, ctx) => {
    const target = await ctx.pickFile();
    if (!target) return;
    const label = target.split("/").pop().replace(/\.[^.]+$/, "");
    const href = state.path ? relPath(dirname(state.path), target) : target;
    ctx.insert(`[${label}](${encodeURI(href)})`);
  },
});

registerCommand("table", {
  title: "Insert a markdown table",
  hint: "/table 3x4 (rows x cols)",
  run: (args, ctx) => {
    const m = args.match(/(\d+)\s*[x×*]\s*(\d+)/i);
    const rows = Math.min(m ? parseInt(m[1], 10) : 3, 100);
    const cols = Math.min(m ? parseInt(m[2], 10) : 3, 20);
    const row = (cells) => `| ${cells.join(" | ")} |`;
    const lines = [
      row(Array.from({ length: cols }, (_, i) => `Col ${i + 1}`)),
      row(Array(cols).fill("---")),
      ...Array.from({ length: Math.max(rows - 1, 1) }, () => row(Array(cols).fill("   "))),
    ];
    ctx.insert(lines.join("\n") + "\n");
  },
});

registerCommand("date", {
  title: "Insert today's date",
  hint: "YYYY-MM-DD",
  run: (args, ctx) => ctx.insert(new Date().toISOString().slice(0, 10)),
});

registerCommand("hr", {
  title: "Insert a horizontal rule",
  run: (args, ctx) => ctx.insert("\n---\n"),
});

registerCommand("lint", {
  title: "Toggle the lint panel",
  run: () => toggleLintPanel(),
});

registerCommand("note", {
  title: "Attach a why-note to your last save",
  hint: "/note reworded intro for clarity",
  run: async (args) => {
    if (!args) return setStatus("usage: /note <why you made the change>");
    const target = state.lastSave && state.lastSave.path === state.path ? state.lastSave : null;
    await api("POST", "/api/trace", {
      kind: "message",
      cause: target ? [target.id] : [],
      thread: target ? target.thread : undefined,
      context: state.path ? { doc: { path: state.path } } : {},
      body: { subtype: "note", text: args },
    });
    setStatus(target ? "note attached to your last save" : "note recorded");
  },
});

registerCommand("settings", {
  title: "Open Eddie settings",
  hint: "~/.eddie/config.json",
  run: async () => {
    const q = state.path ? `?path=${encodeURIComponent(state.path)}` : "";
    const data = await api("GET", `/api/config${q}`);
    if (!data.globalExists) {
      await api("PUT", "/api/file", {
        path: data.globalPath,
        content: JSON.stringify(data.config, null, 2) + "\n",
      });
      setStatus(`created ${data.globalPath}`);
    }
    window.open(`/?file=${encodeURIComponent(data.globalPath)}`, "_blank");
  },
});

// ---------- linting ----------
//
// Linters are per-language and pluggable. A linter fn gets (text, ctx) where
// ctx = {path, language, view, config: {configPath, content, source} | null}
// and returns diagnostics as either
//   {line, column?, length?, message, severity?, rule?}   (1-based positions)
// or CodeMirror-style {from, to, message, severity} objects.

function registerLinter(language, name, fn, opts = {}) {
  (state.linters[language] ||= []).push({ name, fn, ...opts });
}

// forceLinting alone only fast-tracks an already-queued run; to re-lint an
// unchanged document (e.g. after a config change) we dispatch this effect,
// which the linter's needsRefresh hook watches for.
const relintEffect = StateEffect.define();
function relint() {
  if (!state.view) return;
  state.view.dispatch({ effects: relintEffect.of(null) });
  forceLinting(state.view);
}

const lintConfigCache = new Map(); // "<linter>:<file>" -> {at, configPath, content, source}

async function resolveLinterConfig(l, fresh = false) {
  if (!l.configNames || !state.path) return null;
  const key = `${l.name}:${state.path}`;
  const hit = lintConfigCache.get(key);
  if (!fresh && hit && Date.now() - hit.at < 5000) return hit;
  const q = new URLSearchParams({
    path: state.path,
    names: l.configNames.join(","),
    fallback: l.fallback || "",
  });
  const data = await api("GET", `/api/lint/config?${q}`);
  const entry = { at: Date.now(), ...data };
  lintConfigCache.set(key, entry);
  return entry;
}

// Tolerant JSON for config files (.jsonc: // and /* */ comments allowed).
function parseJsonc(text) {
  try {
    return JSON.parse(text);
  } catch {
    return JSON.parse(text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, ""));
  }
}

function toCmDiagnostic(view, d, source) {
  if (typeof d.from === "number") return { severity: "warning", source, ...d };
  const doc = view.state.doc;
  const line = doc.line(Math.max(1, Math.min(d.line || 1, doc.lines)));
  const col = Math.min((d.column || 1) - 1, line.length);
  const from = line.from + col;
  const to = d.length ? Math.min(from + d.length, line.to) : line.to;
  return {
    from,
    to: Math.max(from, to),
    severity: d.severity || "warning",
    message: d.message,
    source: d.rule ? `${source}:${d.rule}` : source,
  };
}

async function lintSource(view) {
  const diagnostics = [];
  for (const l of state.linters[state.language] || []) {
    try {
      const config = await resolveLinterConfig(l);
      const results = await l.fn(view.state.doc.toString(), {
        path: state.path,
        language: state.language,
        view,
        config,
      });
      for (const d of results || []) diagnostics.push(toCmDiagnostic(view, d, l.name));
    } catch (e) {
      console.warn(`linter ${l.name} failed:`, e);
    }
  }
  return diagnostics.sort((a, b) => a.from - b.from);
}

function updateLintStatus(editorState) {
  const n = diagnosticCount(editorState);
  const el = $("status-lint");
  el.textContent = n ? `⚠ ${n}` : "";
  el.title = n ? `${n} lint issue${n === 1 ? "" : "s"} — click to show` : "";
}

function toggleLintPanel() {
  if (!state.view) return;
  state.lintPanelOpen = !state.lintPanelOpen;
  (state.lintPanelOpen ? openLintPanel : closeLintPanel)(state.view);
  state.view.focus();
}

async function openLintConfig() {
  const l = (state.linters[state.language] || []).find((x) => x.configNames);
  if (!l) return setStatus(`no configurable linter for ${state.language}`);
  const cfg = await resolveLinterConfig(l, true);
  if (!cfg || !cfg.configPath) return setStatus(`${l.name} has no config location`);
  if (cfg.content == null) {
    await api("PUT", "/api/file", {
      path: cfg.configPath,
      content: JSON.stringify(l.defaultConfig || {}, null, 2) + "\n",
    });
    setStatus(`created ${cfg.configPath}`);
  }
  window.open(`/?file=${encodeURIComponent(cfg.configPath)}`, "_blank");
}

// Re-lint with a fresh config when the tab regains focus (e.g. after editing
// the config in another tab) and after every save.
window.addEventListener("focus", () => {
  lintConfigCache.clear();
  relint();
  loadConfig();
});

// Built-in: markdownlint with standard .markdownlint.json config resolution.
registerLinter(
  "markdown",
  "markdownlint",
  (text, { config }) => {
    let cfg = { default: true };
    if (config && config.content != null) {
      try {
        cfg = parseJsonc(config.content);
      } catch {
        setStatus(`bad JSON in ${config.configPath}`, true);
      }
    }
    const result = markdownlint({ strings: { doc: text }, config: cfg });
    return result.doc.map((e) => ({
      line: e.lineNumber,
      column: e.errorRange ? e.errorRange[0] : 1,
      length: e.errorRange ? e.errorRange[1] : undefined,
      severity: "warning",
      rule: e.ruleNames[0],
      message:
        `${e.ruleNames.slice(0, 2).join("/")}: ${e.ruleDescription}` +
        (e.errorDetail ? ` [${e.errorDetail}]` : ""),
    }));
  },
  {
    configNames: [".markdownlint.json", ".markdownlint.jsonc"],
    fallback: "markdownlint.json",
    defaultConfig: { default: true, MD013: false, MD033: false, MD041: false },
  }
);

// Built-in: JSON syntax checking.
registerLinter("json", "json-parse", (text, { view }) =>
  text.trim() ? jsonParseLinter()(view).map((d) => ({ ...d, severity: "error" })) : []
);

// ---------- panels ----------
//
// Eddie composes features as panels: self-contained units that render into
// the right-side dock and get a toolbar button for free. The git panel is
// built on this, and plugins register their own (e.g. plugins/chat.js) with
// eddie.registerPanel(id, {title, button?, render(el), onShow?, onHide?}).

const panels = new Map();
let activePanel = null;

function registerPanel(id, spec) {
  panels.set(id, spec);
  const btn = document.createElement("button");
  btn.id = `panel-btn-${id}`;
  btn.textContent = spec.button || spec.title;
  btn.title = spec.title;
  btn.onclick = () => togglePanel(id);
  $("panel-buttons").appendChild(btn);
}

function isPanelOpen(id) {
  return activePanel === id;
}

function hidePanel() {
  if (!activePanel) return;
  panels.get(activePanel).onHide?.();
  activePanel = null;
  $("dock").hidden = true;
  document.querySelectorAll("#panel-buttons button").forEach((b) => b.classList.remove("active"));
}

function togglePanel(id) {
  if (activePanel === id) return hidePanel();
  const spec = panels.get(id);
  if (!spec) return;
  if (activePanel) panels.get(activePanel).onHide?.();
  let el = document.getElementById(`panel-${id}`);
  if (!el) {
    el = document.createElement("div");
    el.id = `panel-${id}`;
    el.className = "panel";
    $("dock").appendChild(el);
    spec.render(el);
  }
  for (const p of $("dock").children) p.classList.toggle("active", p === el);
  $("dock").hidden = false;
  activePanel = id;
  document
    .querySelectorAll("#panel-buttons button")
    .forEach((b) => b.classList.toggle("active", b.id === `panel-btn-${id}`));
  spec.onShow?.(el);
}

// ---------- trace client: SSE tail, recommendations, eddie icon ----------

const recordHandlers = new Set();
let liveRecs = new Map(); // id -> recommendation record

let eventSource = null; // module-level ref: guards against GC and allows reconnect

function connectEvents() {
  if (eventSource) eventSource.close();
  const es = (eventSource = new EventSource("/api/events"));
  es.onmessage = (e) => {
    let rec;
    try {
      rec = JSON.parse(e.data);
    } catch {
      return;
    }
    for (const fn of recordHandlers) {
      try {
        fn(rec);
      } catch (err) {
        console.warn("record handler failed:", err);
      }
    }
    handleRecord(rec);
  };
  // EventSource reconnects automatically on error.
}

function handleRecord(rec) {
  if (rec.kind === "message" && rec.body.subtype === "recommendation") {
    for (const [id, r] of liveRecs) {
      if (r.body.dupeKey === rec.body.dupeKey) liveRecs.delete(id);
    }
    liveRecs.set(rec.id, rec);
    if (rec.body.severity === "warn") toast(rec.body.text);
    if (rec.body.severity !== "passive") pulseEddie();
    renderRecsUI();
  } else if (rec.cause && rec.cause.some((id) => liveRecs.has(id)) && rec.kind !== "outcome") {
    for (const id of rec.cause) liveRecs.delete(id);
    renderRecsUI();
  }
  if (isPanelOpen("history")) renderHistory();
}

async function refreshRecs() {
  try {
    const { recommendations } = await api("GET", "/api/recommendations");
    liveRecs = new Map(recommendations.map((r) => [r.id, r]));
    renderRecsUI();
  } catch {
    /* server may be restarting */
  }
}

function renderRecsUI() {
  const icon = $("eddie-icon");
  icon.textContent = liveRecs.size ? `✦ ${liveRecs.size}` : "✦";
  icon.classList.toggle("has-recs", liveRecs.size > 0);
  renderBadges();
  if (isPanelOpen("recs")) renderRecsPanel();
}

function renderBadges() {
  document.querySelectorAll(".rec-badge").forEach((b) => b.remove());
  document.querySelectorAll(".has-badge").forEach((el) => el.classList.remove("has-badge"));
  const counts = Object.create(null);
  for (const r of liveRecs.values()) {
    const a = r.body.anchor;
    if (a && a.type === "ui") counts[a.target] = (counts[a.target] || 0) + 1;
  }
  for (const [target, n] of Object.entries(counts)) {
    let el = null;
    if (target.startsWith("panel:")) el = document.getElementById(`panel-btn-${target.slice(6)}`);
    else if (target.startsWith("element:")) el = document.getElementById(target.slice(8));
    if (!el) continue;
    const b = document.createElement("span");
    b.className = "rec-badge";
    b.textContent = n;
    el.classList.add("has-badge");
    el.appendChild(b);
  }
}

function toast(text) {
  const div = document.createElement("div");
  div.className = "toast";
  div.textContent = text;
  div.onclick = () => div.remove();
  $("toasts").appendChild(div);
  setTimeout(() => div.remove(), 8000);
}

function pulseEddie() {
  const icon = $("eddie-icon");
  icon.classList.remove("pulse");
  void icon.offsetWidth; // restart the animation
  icon.classList.add("pulse");
}

function recordOutcome(rec, valence) {
  return api("POST", "/api/trace", {
    kind: "outcome",
    cause: [rec.id],
    thread: rec.thread,
    body: { valence, source: "explicit" },
  });
}

function settleRec(rec, how) {
  liveRecs.delete(rec.id);
  renderRecsUI();
  return api("POST", "/api/recommend/settle", { id: rec.id, how }).catch(() => {});
}

function runRecAction(rec, action) {
  if (action.command.startsWith("panel:")) togglePanel(action.command.slice(6));
  else {
    const [name, ...rest] = action.command.split(" ");
    runCommand(name, rest.join(" "));
  }
  settleRec(rec, "applied");
}

// ---- recommendations panel ----

registerPanel("recs", {
  title: "Eddie recommendations",
  button: "✦",
  render(el) {
    el.innerHTML = `<h3>eddie recommends</h3><div id="recs-list"></div>`;
  },
  onShow: () => renderRecsPanel(),
});

function renderRecsPanel() {
  const list = $("recs-list");
  if (!list) return;
  list.innerHTML = liveRecs.size ? "" : "<em>nothing right now</em>";
  for (const rec of [...liveRecs.values()].reverse()) {
    const card = document.createElement("div");
    card.className = `rec-card ${rec.body.severity}`;
    const text = document.createElement("div");
    text.textContent = rec.body.text;
    const prov = document.createElement("div");
    prov.className = "prov";
    prov.textContent = `${rec.actor.kind}:${rec.body.producer}`;
    const actions = document.createElement("div");
    actions.className = "rec-actions";
    for (const a of rec.body.actions || []) {
      const btn = document.createElement("button");
      btn.textContent = a.label;
      btn.onclick = () => runRecAction(rec, a);
      actions.appendChild(btn);
    }
    for (const [glyph, valence] of [["👍", "good"], ["👎", "bad"]]) {
      const fb = document.createElement("button");
      fb.className = "fb";
      fb.textContent = glyph;
      fb.title = `this was a ${valence} recommendation`;
      fb.onclick = () => {
        recordOutcome(rec, valence);
        fb.disabled = true;
        setStatus("feedback recorded");
      };
      actions.appendChild(fb);
    }
    const dismiss = document.createElement("button");
    dismiss.className = "fb";
    dismiss.textContent = "✕";
    dismiss.title = "dismiss";
    dismiss.onclick = () => settleRec(rec, "dismissed");
    actions.appendChild(dismiss);
    const why = document.createElement("button");
    why.className = "why";
    why.textContent = "why?";
    why.onclick = () => showChain(rec.id, list, renderRecsPanel);
    actions.appendChild(why);
    card.append(text, prov, actions);
    list.appendChild(card);
  }
}

// ---- history panel ----

registerPanel("history", {
  title: "Trace history — everything eddie saw and did",
  button: "History",
  render(el) {
    el.innerHTML = `
      <h3>history</h3>
      <select id="hist-filter">
        <option value="">everything</option>
        <option value="action">actions</option>
        <option value="message">messages</option>
        <option value="decision,outcome">decisions & outcomes</option>
        <option value="event">events</option>
      </select>
      <div id="hist-list"></div>`;
    el.querySelector("#hist-filter").onchange = renderHistory;
  },
  onShow: () => renderHistory(),
});

function recordSummary(r) {
  if (r.body.subtype === "note") return `🗒 ${r.body.text.slice(0, 70)}`;
  if (r.body.name === "git.commit.seen") return `commit: "${r.body.subject}" — ${r.body.author}`;
  if (r.body.name === "git.committed") return `commit: "${r.body.message}"`;
  return (
    r.body.name ||
    (r.body.text && r.body.text.slice(0, 70)) ||
    r.body.subtype ||
    r.body.choice ||
    (r.body.valence && `outcome: ${r.body.valence}`) ||
    r.kind
  );
}

async function renderHistory() {
  const list = $("hist-list");
  if (!list) return;
  const kinds = $("hist-filter").value;
  let records;
  try {
    ({ records } = await api("GET", `/api/trace?limit=80${kinds ? `&kinds=${kinds}` : ""}`));
  } catch (e) {
    list.innerHTML = `<em>could not load history: ${e.message}</em>`;
    return;
  }
  list.innerHTML = records.length ? "" : "<em>no records yet</em>";
  for (const r of records) {
    const row = document.createElement("div");
    row.className = "hist-row";
    const kind = document.createElement("span");
    kind.className = "kind";
    kind.textContent = r.kind;
    const summary = document.createElement("span");
    summary.textContent = recordSummary(r);
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = `${new Date(r.ts).toLocaleTimeString()} · ${r.actor.kind}:${r.actor.id}`;
    const note = document.createElement("button");
    note.className = "fb note-btn";
    note.textContent = "💬";
    note.title = "attach a note (the why)";
    note.onclick = async (e) => {
      e.stopPropagation();
      const text = prompt("Note — why?");
      if (!text) return;
      await api("POST", "/api/trace", {
        kind: "message",
        cause: [r.id],
        thread: r.thread,
        body: { subtype: "note", text },
      });
      renderHistory();
    };
    row.append(kind, summary, note, meta);
    row.onclick = () => showChain(r.id, list, renderHistory);
    list.appendChild(row);
  }
}

// Render a cause chain ("why?") into a container, with a back link.
async function showChain(id, container, back) {
  let chain, effects;
  try {
    ({ chain, effects } = await api("GET", `/api/trace/chain?id=${encodeURIComponent(id)}`));
  } catch (e) {
    setStatus(`could not load chain: ${e.message}`);
    return;
  }
  container.innerHTML = "";
  const backBtn = document.createElement("button");
  backBtn.textContent = "← back";
  backBtn.onclick = back;
  container.appendChild(backBtn);
  if (effects && effects.length) {
    const h = document.createElement("div");
    h.className = "chain-arrow";
    h.textContent = "▼ led to / annotated by";
    const div = document.createElement("div");
    div.className = "chain-layer";
    for (const r of effects) {
      const row = document.createElement("div");
      row.className = "hist-row";
      const kind = document.createElement("span");
      kind.className = "kind";
      kind.textContent = r.kind;
      const summary = document.createElement("span");
      summary.textContent = recordSummary(r);
      row.append(kind, summary);
      div.appendChild(row);
    }
    container.append(h, div);
  }
  chain.forEach((layer, i) => {
    if (i > 0) {
      const arrow = document.createElement("div");
      arrow.className = "chain-arrow";
      arrow.textContent = "▲ because";
      container.appendChild(arrow);
    }
    const div = document.createElement("div");
    div.className = "chain-layer";
    for (const r of layer) {
      const row = document.createElement("div");
      row.className = "hist-row";
      if (r.missing) {
        row.textContent = `${r.id} (older than the in-memory window)`;
      } else {
        row.innerHTML = "";
        const kind = document.createElement("span");
        kind.className = "kind";
        kind.textContent = r.kind;
        const summary = document.createElement("span");
        summary.textContent = recordSummary(r);
        const meta = document.createElement("div");
        meta.className = "meta";
        meta.textContent = `${new Date(r.ts).toLocaleTimeString()} · ${r.actor.kind}:${r.actor.id}`;
        row.append(kind, summary, meta);
      }
      div.appendChild(row);
    }
    container.appendChild(div);
  });
}

// ---------- git ----------

async function refreshGitInfo() {
  if (!state.path) return;
  try {
    const info = await api("GET", `/api/git/info?path=${encodeURIComponent(state.path)}`);
    const el = $("git-info");
    if (!info.root) {
      el.hidden = true;
      state.gitRoot = null;
      return;
    }
    state.gitRoot = info.root;
    el.hidden = false;
    el.textContent =
      `${info.branch}${info.fileStatus === "clean" ? "" : " *"}` +
      (info.ahead ? ` ↑${info.ahead}` : "") +
      (info.behind ? ` ↓${info.behind}` : "");
    if (isPanelOpen("git")) refreshGitPanel();
  } catch {
    /* non-fatal */
  }
}

registerPanel("git", {
  title: "Git panel",
  button: "Git",
  render(el) {
    el.innerHTML = `
      <h3>git</h3>
      <div id="git-detail">not in a git repository</div>
      <pre id="git-diff"></pre>
      <input id="commit-msg" type="text" placeholder="commit message">
      <div class="git-actions">
        <button id="btn-commit">Commit file</button>
        <button id="btn-pull">Pull</button>
        <button id="btn-push">Push</button>
      </div>
      <div id="git-sync"></div>
      <h3>history</h3>
      <div id="git-log"></div>`;
    el.querySelector("#btn-commit").onclick = commitFile;
    el.querySelector("#btn-push").onclick = pushChanges;
    el.querySelector("#btn-pull").onclick = pullChanges;
  },
  onShow: () => refreshGitPanel(),
});

async function refreshGitPanel() {
  if (!state.gitRoot) {
    $("git-detail").textContent = "not in a git repository";
    $("git-diff").textContent = "";
    $("git-log").innerHTML = "";
    return;
  }
  // Fetch first so ahead/behind reflects the actual remote, not a stale ref.
  // Best-effort: offline just means counts stay as-is.
  if (policy("autofetch") === "auto") {
    await api("POST", "/api/git/fetch", { path: state.path }).catch(() => {});
  }
  const [info, diff, log] = await Promise.all([
    api("GET", `/api/git/info?path=${encodeURIComponent(state.path)}`),
    api("GET", `/api/git/diff?path=${encodeURIComponent(state.path)}`),
    api("GET", `/api/git/log?path=${encodeURIComponent(state.path)}`),
  ]);
  $("git-detail").innerHTML = "";
  const repoLine = document.createElement("div");
  repoLine.textContent = `${info.root} @ ${info.branch} — file: ${info.fileStatus}`;
  const idLine = document.createElement("div");
  idLine.className = "git-identity";
  idLine.textContent = info.userName
    ? `as ${info.userName} <${info.userEmail || "no email"}>` + (info.remote ? ` → ${info.remote}` : " (no origin remote)")
    : "no git identity configured for this repo";
  $("git-detail").append(repoLine, idLine);
  $("git-diff").textContent = diff.diff || "(no unstaged changes)";
  $("git-sync").textContent = !info.hasUpstream
    ? "no upstream — Push will publish this branch"
    : info.ahead || info.behind
      ? `${info.ahead ? `${info.ahead} commit${info.ahead === 1 ? "" : "s"} to push` : ""}` +
        `${info.ahead && info.behind ? ", " : ""}` +
        `${info.behind ? `${info.behind} behind upstream` : ""}`
      : "in sync with upstream";
  state.gitInfo = info;
  $("btn-push").textContent = info.ahead ? `Push ↑${info.ahead}` : "Push";
  $("btn-pull").textContent = info.behind ? `Pull ↓${info.behind}` : "Pull";
  for (const [btn, action] of [["btn-commit", "commit"], ["btn-push", "push"], ["btn-pull", "pull"]]) {
    const blocked = policy(action) === "never";
    $(btn).disabled = blocked;
    $(btn).title = blocked ? `disabled by eddie config (git.${action}: never)` : "";
  }
  $("git-log").innerHTML = "";
  for (const e of log.log) {
    const div = document.createElement("div");
    div.className = "entry";
    const hash = document.createElement("span");
    hash.className = "hash";
    hash.textContent = e.hash;
    const subject = document.createElement("span");
    subject.textContent = e.subject;
    div.append(hash, subject);
    if (e.unpushed) {
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = "unpushed";
      div.appendChild(badge);
    }
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = `${e.author}, ${e.when}`;
    div.appendChild(meta);
    $("git-log").appendChild(div);
  }
}

async function pushChanges() {
  if (policy("push") === "ask") {
    const i = state.gitInfo;
    const what = i?.ahead ? `${i.ahead} commit${i.ahead === 1 ? "" : "s"}` : "commits";
    if (!confirm(`Push ${what} to ${i?.remote || "the remote"}?`)) return;
  }
  const btn = $("btn-push");
  btn.disabled = true;
  btn.textContent = "Pushing…";
  try {
    const r = await api("POST", "/api/git/push", { path: state.path });
    setStatus(r.output.split("\n").pop() || "pushed");
  } catch (e) {
    if (/fetch first|rejected|non-fast-forward/i.test(e.message)) {
      setStatus("push rejected — the remote has new commits. Pull, then Push again.", true);
    } else {
      setStatus(`push failed: ${e.message}`, true);
    }
  } finally {
    btn.disabled = false;
    refreshGitInfo();
    refreshGitPanel();
  }
}

async function pullChanges() {
  if (policy("pull") === "ask") {
    const i = state.gitInfo;
    const strategy = policy("pullStrategy");
    const msg =
      i && i.ahead && i.behind
        ? `Remote and local have diverged. ${strategy === "merge" ? "Merge" : "Rebase"} ${i.ahead} local commit${i.ahead === 1 ? "" : "s"} ${strategy === "merge" ? "with" : "onto"} ${i.behind} remote commit${i.behind === 1 ? "" : "s"}?`
        : i && i.behind
          ? `Pull ${i.behind} commit${i.behind === 1 ? "" : "s"} from ${i.remote || "the remote"}?`
          : `Pull from ${i?.remote || "the remote"}?`;
    if (!confirm(msg)) return;
  }
  const btn = $("btn-pull");
  btn.disabled = true;
  btn.textContent = "Pulling…";
  try {
    const r = await api("POST", "/api/git/pull", { path: state.path });
    setStatus(r.output.split("\n").pop() || "pulled");
    if (!state.dirty) {
      await openFile(state.path); // reload — the file may have changed on disk
    } else {
      setStatus("pulled — unsaved edits kept; saving will overwrite any pulled changes to this file", true);
    }
  } catch (e) {
    setStatus(`pull failed: ${e.message}`, true);
  } finally {
    btn.disabled = false;
    refreshGitInfo();
    refreshGitPanel();
  }
}

async function commitFile() {
  const message = $("commit-msg").value.trim();
  if (!message) return setStatus("enter a commit message");
  if (policy("commit") === "ask" && !confirm(`Commit "${message}"${state.gitInfo ? ` on ${state.gitInfo.branch}` : ""}?`)) return;
  try {
    const r = await api("POST", "/api/git/commit", { path: state.path, message });
    $("commit-msg").value = "";
    setStatus(r.output || "committed");
    refreshGitInfo();
    refreshGitPanel();
  } catch (e) {
    setStatus(`commit failed: ${e.message}`, true);
  }
}

// ---------- home screen (recent + browser) ----------

async function showHome() {
  $("main").style.display = "none";
  $("home").hidden = false;
  const { recent } = await api("GET", "/api/recent");
  const ul = $("recent-list");
  ul.innerHTML = "";
  if (!recent.length) ul.innerHTML = "<li><em>nothing yet</em></li>";
  for (const r of recent) {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.textContent = r.path;
    a.onclick = () => openFile(r.path);
    li.appendChild(a);
    ul.appendChild(li);
  }
  browse();
}

async function browse(dir) {
  const q = dir ? `?path=${encodeURIComponent(dir)}` : "";
  const data = await api("GET", `/api/list${q}`);
  $("browser-path").textContent = data.path;
  const ul = $("browser-list");
  ul.innerHTML = "";
  const up = document.createElement("li");
  const upA = document.createElement("a");
  upA.className = "dir";
  upA.textContent = "..";
  upA.onclick = () => browse(data.parent);
  up.appendChild(upA);
  ul.appendChild(up);
  for (const e of data.entries) {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.textContent = e.name + (e.dir ? "/" : "");
    if (e.dir) a.className = "dir";
    a.onclick = () => (e.dir ? browse(e.path) : openFile(e.path));
    li.appendChild(a);
    if (!e.dir && e.language !== "text") {
      const meta = document.createElement("span");
      meta.className = "meta";
      meta.textContent = e.language;
      li.appendChild(meta);
    }
    ul.appendChild(li);
  }
}

// ---------- plugin API ----------

const eddie = {
  version: "0.1.0",
  getText,
  setText,
  getPath: () => state.path,
  getLanguage: () => state.language,
  setStatus,
  save,
  openFile,
  api,
  registerFormatter,
  registerLinter,
  registerCommand,
  runCommand,
  pickFile,
  registerPanel,
  togglePanel,
  isPanelOpen,
  markdown: (text) => marked.parse(text),
  recommend: ({ producer, anchor, severity, text, actions, resolveOn }) =>
    api("POST", "/api/recommend", { producer, anchor, severity, text, actions, resolveOn, actor: { kind: "rule", id: producer } }),
  resolveRecommendation: (producer, anchor) =>
    api("POST", "/api/recommend/settle", { producer, anchor, how: "resolved" }),
  onRecord: (fn) => {
    recordHandlers.add(fn);
    return () => recordHandlers.delete(fn);
  },
  trace: (record) => api("POST", "/api/trace", record),
  relint,
  openLintConfig,
  onSave: (fn) => state.saveHooks.push(fn),
  addToolbarButton: (label, title, onClick) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.title = title || label;
    b.onclick = onClick;
    $("toolbar").appendChild(b);
    return b;
  },
  addStatusItem: (text) => {
    const s = document.createElement("span");
    s.textContent = text;
    $("statusbar").insertBefore(s, $("status-lang"));
    return s;
  },
};
window.eddie = eddie;

async function loadPlugins() {
  try {
    const { plugins } = await api("GET", "/api/plugins");
    for (const p of plugins) {
      const s = document.createElement("script");
      s.src = p.url;
      s.onerror = () => console.warn(`plugin failed to load: ${p.name}`);
      document.body.appendChild(s);
    }
  } catch (e) {
    console.warn("plugin load failed:", e);
  }
}

// ---------- wiring ----------

$("btn-save").onclick = save;
$("btn-preview").onclick = togglePreview;
$("btn-format").onclick = formatDocument;
$("btn-lint").onclick = toggleLintPanel;
$("btn-lint-config").onclick = openLintConfig;
$("status-lint").onclick = toggleLintPanel;
$("btn-palette").onclick = openPalette;
$("linkpick-close").onclick = () => closePick(null);

$("palette-input").addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown") (paletteSel++, renderPalette(), e.preventDefault());
  else if (e.key === "ArrowUp") (paletteSel = Math.max(0, paletteSel - 1), renderPalette(), e.preventDefault());
  else if (e.key === "Enter") (runPaletteSelection(), e.preventDefault());
});
$("palette-input").addEventListener("input", () => ((paletteSel = 0), renderPalette()));

document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    $("palette").hidden ? openPalette() : closePalette();
  } else if (e.key === "Escape") {
    if (!$("linkpick").hidden) closePick(null);
    else if (!$("palette").hidden) closePalette();
  }
});

window.addEventListener("beforeunload", (e) => {
  if (state.dirty) e.preventDefault();
});

$("eddie-icon").onclick = () => togglePanel("recs");
connectEvents();
refreshRecs();

const fileParam = new URLSearchParams(location.search).get("file");
if (fileParam) {
  openFile(fileParam).catch((e) => setStatus(`open failed: ${e.message}`, true));
} else {
  showHome();
}
loadPlugins();
