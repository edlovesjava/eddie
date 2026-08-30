# Eddie plugins

A plugin is a single `.js` file loaded into the editor page after the app
starts. Eddie loads plugins from two places:

- `~/.eddie/plugins/*.js` — your personal plugins
- `plugins/*.js` in this repo — built-ins shipped with Eddie

No build step, no manifest — drop a file in, reload the tab.

## The `eddie` API

Plugins use the global `window.eddie` object:

| Call | What it does |
|---|---|
| `eddie.getText()` / `eddie.setText(s)` | read / replace the document |
| `eddie.getPath()` / `eddie.getLanguage()` | current file path / language id |
| `eddie.save()` | save the current file |
| `eddie.openFile(path)` | open another file in this tab |
| `eddie.setStatus(msg)` | flash a message in the status bar |
| `eddie.registerFormatter(lang, name, fn)` | make the Format button work for a language; `fn(text, {path})` returns the formatted text (may be async) |
| `eddie.registerLinter(lang, name, fn, opts?)` | add a linter for a language (see below) |
| `eddie.registerCommand(name, {title, hint, run})` | add a slash command (see below) |
| `eddie.runCommand(name, args)` | invoke any command programmatically |
| `eddie.pickFile(startDir?)` | show the file-picker dialog; resolves to a path or null |
| `eddie.registerPanel(id, {title, button?, render, onShow?, onHide?})` | add a dock panel with its own toolbar button (see below) |
| `eddie.togglePanel(id)` / `eddie.isPanelOpen(id)` | open/close or query a panel |
| `eddie.markdown(text)` | render markdown to HTML (same renderer as the preview) |
| `eddie.recommend({producer, text, anchor?, severity?, actions?, resolveOn?})` | surface a recommendation (see lint-advisor.js for a producer example) |
| `eddie.resolveRecommendation(producer, anchor)` | resolve your own recommendation when its condition clears |
| `eddie.onRecord(fn)` | subscribe to the live trace stream — `fn(record)` for every new record |
| `eddie.trace(record)` | append a record to the trace (`{kind, body, cause?, thread?}`) |
| `eddie.relint()` | re-run all linters on the current document |
| `eddie.openLintConfig()` | open the current language's linter config (what the Lint ⚙ button does) |
| `eddie.onSave(fn)` | run `fn(text, {path, language})` before every save; return a string to rewrite the content being saved |
| `eddie.addToolbarButton(label, title, onClick)` | add a button to the top bar |
| `eddie.addStatusItem(text)` | add a status-bar item; returns the element |
| `eddie.api(method, url, body)` | call the Eddie server API (see docs/AGENTS.md) |

Language ids: `markdown`, `json`, `shell`, `yaml`, `javascript`, `css`, `html`, `text`.

## Panels

Eddie composes features as panels: self-contained units that render into the
right-side dock, get a toolbar button automatically, and show one at a time.
The built-in **git panel uses this same API**, and the **AI chat panel is
itself a plugin** ([chat.js](chat.js)) — read it as the reference example.

```js
eddie.registerPanel("outline", {
  title: "Document outline",
  button: "Outline",
  render(el) {           // called once, lazily, on first open
    el.innerHTML = "<h3>outline</h3><div id='outline-body'></div>";
  },
  onShow(el) {           // called every time the panel becomes visible
    const heads = eddie.getText().match(/^#+ .+$/gm) || [];
    el.querySelector("#outline-body").innerHTML = eddie.markdown(heads.join("\n\n"));
  },
});
```

## Slash commands

Commands run inline (`/name args` + Enter in the document — the typed command
is replaced by whatever the command inserts) and from the Cmd+K palette.
`run(args, ctx)` may be async; `args` is the raw argument string, and `ctx`
has `insert(text)` (at the cursor, replacing any selection), `view`, `path`,
`language`, `pickFile`, `api`, and `setStatus`.

```js
eddie.registerCommand("sig", {
  title: "Insert my signature",
  run: (args, ctx) => ctx.insert("— Ed\n"),
});

eddie.registerCommand("embed", {
  title: "Embed another file as a code block",
  hint: "opens a file picker",
  run: async (args, ctx) => {
    const p = await ctx.pickFile();
    if (!p) return;
    const { content } = await ctx.api("GET", `/api/file?path=${encodeURIComponent(p)}`);
    ctx.insert("```\n" + content + "```\n");
  },
});
```

## Linters

`eddie.registerLinter(language, name, fn, opts)` plugs into the same machinery
as the built-in markdownlint. `fn(text, ctx)` may be async and returns an array
of diagnostics, each either 1-based `{line, column?, length?, message,
severity?, rule?}` (`severity`: `"error" | "warning" | "info"`, default
warning) or a raw CodeMirror `{from, to, message, severity}` object
(`ctx.view` is the EditorView if you need to compute offsets).

Config files are handled for you: pass `opts = {configNames, fallback,
defaultConfig}` and `ctx.config` arrives as `{configPath, content, source}` —
resolved by walking up from the edited file's directory through `configNames`,
falling back to `~/.eddie/<fallback>`. The **Lint ⚙** button opens that file
(creating the fallback from `defaultConfig` if nothing exists), and edits
apply as soon as you refocus the editor tab.

A minimal shell linter:

```js
eddie.registerLinter("shell", "no-naked-cd", (text) =>
  text.split("\n").flatMap((l, i) =>
    /^\s*cd\s/.test(l) && !l.includes("||")
      ? [{ line: i + 1, message: "cd without '|| exit' — script continues in the wrong directory on failure", rule: "no-naked-cd" }]
      : []
  )
);
```

## Examples

Trim trailing whitespace on every save of a markdown file:

```js
eddie.onSave((text, { language }) =>
  language === "markdown" ? text.replace(/[ \t]+$/gm, "") : undefined
);
```

A shell formatter that just normalizes line endings:

```js
eddie.registerFormatter("shell", "crlf-fix", (text) => text.replace(/\r\n/g, "\n"));
```

Insert a date-stamped heading from a toolbar button:

```js
eddie.addToolbarButton("Today", "Insert today's heading", () => {
  eddie.setText(`# ${new Date().toISOString().slice(0, 10)}\n\n` + eddie.getText());
});
```
