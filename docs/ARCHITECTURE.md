# Eddie architecture guide

The one-paragraph version: a **CLI** (`bin/eddie.js`) that opens files fast, a
**dependency-free local server** (`server/server.js`) that owns every
side-effect through a JSON API on `127.0.0.1:4517`, and a **browser frontend**
(`web/src/main.js`, CodeMirror 6, bundled by esbuild) that is a client of that
API — the same API agents and plugins use. Features compose through a small
set of extension points; nothing talks to the filesystem, git, or an AI except
through the server.

```text
 terminal            Finder (Eddie.app)
    │                     │
    └──── bin/eddie.js ───┘         ~/.eddie/plugins/*.js   plugins/*.js
              │ start/health              │  (user)            │ (built-in)
              ▼                           └───────┬────────────┘
      server/server.js  ◄──── JSON/HTTP ──── web (editor tab)
      127.0.0.1:4517                          CodeMirror 6 + panels
        │        │        │                   window.eddie plugin API
        ▼        ▼        ▼
      files     git      AI CLI (claude -p)        ◄── agents use the same
      (fs)   (execFile)  (spawn, stdin prompt)         HTTP API (AGENTS.md)
```

## Components

| Piece | File | Role |
|---|---|---|
| CLI | `bin/eddie.js` | health-check → auto-start server → open browser; `upgrade/restart/status/stop` |
| Server | `server/server.js` | all side effects: file I/O, dir listing, recent files, git, config/policy, AI chat, remote fetch, plugin serving. Plain `node:` modules only |
| Frontend | `web/src/main.js` (+ `index.html`, `style.css`) | editor, preview, lint, commands, palette, panels, plugin loader |
| Plugins | `plugins/*.js` (built-in), `~/.eddie/plugins/*.js` (user) | plain scripts loaded into the page; use `window.eddie` |
| Docs | `README.md` (user), `docs/AGENTS.md` (API), `plugins/README.md` (plugin API), `docs/adr/` (decisions) | keep in sync with changes |

## Extension points — new features land here

In order of preference. If a feature doesn't fit any of these, that's a
signal to discuss an ADR, not to bolt on a one-off.

1. **Panel** — `eddie.registerPanel(id, {title, button, render, onShow, onHide})`.
   A self-contained UI unit in the right dock with an auto-created toolbar
   button. Git is a panel; AI chat is a panel *implemented as a plugin*
   (`plugins/chat.js` is the reference).
2. **Slash command** — `eddie.registerCommand(name, {title, hint, run})`.
   Runs inline (`/name args` + Enter) and from the Cmd+K palette.
3. **Linter** — `eddie.registerLinter(language, name, fn, opts)` with
   config-file resolution handled by the framework.
4. **Formatter** — `eddie.registerFormatter(language, name, fn)` behind the
   Format button.
5. **Save hook** — `eddie.onSave(fn)` to transform content on save.
6. **API endpoint** — a handler in `server/server.js`'s `api` table, when a
   capability needs server-side execution. Document it in `docs/AGENTS.md`.

## Cross-cutting systems

- **Config & policy** (`~/.eddie/config.json` ← nearest `.eddie.json`
  walking up from the edited file; defaults in `CONFIG_DEFAULTS`). Every
  state-mutating capability declares a policy: `auto | ask | never`. `ask`
  is a UI confirmation describing the consequence; `never` is enforced in
  the server (403) so agents are bound by it too. Same walk-up pattern
  serves linter configs (`/api/lint/config`).
- **The HTTP API is the only interface.** UI, plugins, and agents are
  peers: anything the UI can do must be reachable over the API, and
  vice versa. New endpoints go in `docs/AGENTS.md`.
- **AI access** goes through `/api/ai/chat`, which pipes a composed prompt
  to a local CLI (default `claude -p`) — no API keys in this codebase.

## Invariants

- Server binds `127.0.0.1` only; requests with a non-localhost `Host`
  header are rejected (DNS-rebinding guard).
- `server/server.js` has zero npm dependencies.
- `window.eddie` is additive-only; plugins written yesterday keep working.
- Plugins: single `.js` file, no build step, loaded with a page reload.
- Frontend bundle is generated (`npm run build`, auto via `prepare`) and
  never committed.

## Adding a feature — checklist

1. Feature branch: `<type>/<topic>` (ADR-0009).
2. Pick the extension point (above). Prototype as a plugin when possible —
   if it works as a plugin, it proves the architecture; promote to built-in
   only if it needs server support or should ship by default.
3. Server capability that mutates state? Add a `CONFIG_DEFAULTS` policy
   entry and enforce `never` in the handler.
4. Test for real: `curl` the endpoints, drive the UI headless (Playwright),
   check the failure path.
5. Update docs: README / AGENTS.md / plugins/README.md as applicable;
   ADR if a significant decision was made; minor version bump if a
   user-visible capability shipped.
6. Push the branch; merge to `main` after review.
