// Eddie editor frontend. Bundled with esbuild to /dist/app.js.

import { EditorView, keymap } from "@codemirror/view";
import { EditorState, Compartment, StateEffect } from "@codemirror/state";
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
};

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
    el.textContent = `${info.branch}${info.fileStatus === "clean" ? "" : " *"}`;
    if (!$("git-panel").hidden) refreshGitPanel();
  } catch {
    /* non-fatal */
  }
}

async function refreshGitPanel() {
  if (!state.gitRoot) {
    $("git-detail").textContent = "not in a git repository";
    $("git-diff").textContent = "";
    $("git-log").innerHTML = "";
    return;
  }
  const [info, diff, log] = await Promise.all([
    api("GET", `/api/git/info?path=${encodeURIComponent(state.path)}`),
    api("GET", `/api/git/diff?path=${encodeURIComponent(state.path)}`),
    api("GET", `/api/git/log?path=${encodeURIComponent(state.path)}`),
  ]);
  $("git-detail").textContent = `${info.root} @ ${info.branch} — file: ${info.fileStatus}`;
  $("git-diff").textContent = diff.diff || "(no unstaged changes)";
  $("git-log").innerHTML = "";
  for (const e of log.log) {
    const div = document.createElement("div");
    div.className = "entry";
    const hash = document.createElement("span");
    hash.className = "hash";
    hash.textContent = e.hash;
    const subject = document.createElement("span");
    subject.textContent = e.subject;
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = `${e.author}, ${e.when}`;
    div.append(hash, subject, meta);
    $("git-log").appendChild(div);
  }
}

async function commitFile() {
  const message = $("commit-msg").value.trim();
  if (!message) return setStatus("enter a commit message");
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
$("btn-git").onclick = () => {
  const p = $("git-panel");
  p.hidden = !p.hidden;
  if (!p.hidden) refreshGitPanel();
};
$("btn-commit").onclick = commitFile;

window.addEventListener("beforeunload", (e) => {
  if (state.dirty) e.preventDefault();
});

const fileParam = new URLSearchParams(location.search).get("file");
if (fileParam) {
  openFile(fileParam).catch((e) => setStatus(`open failed: ${e.message}`, true));
} else {
  showHome();
}
loadPlugins();
