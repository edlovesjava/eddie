# Eddie for agents

Eddie is deliberately open to agent use. Everything the UI can do goes through
a plain JSON HTTP API on `http://127.0.0.1:4517` (override with `EDDIE_PORT`).
An agent with shell access can also just call the CLI: `eddie <file>` opens the
file in the user's browser.

The server binds to localhost only and refuses requests whose `Host` header is
not localhost.

## Endpoints

All paths are absolute (a leading `~` is expanded). Responses are JSON.

### Health & lifecycle

- `GET /api/health` → `{ok, app, version, pid}`
- `POST /api/shutdown` → stops the server

### Files

- `GET /api/file?path=/abs/file.md` → `{path, exists, content, language, gitRoot}`
  - Opening a missing file returns `exists: false` with empty content; saving creates it.
- `PUT /api/file` with body `{"path": "/abs/file.md", "content": "..."}` → `{ok, path, bytes}`
  - Creates parent directories as needed.
- `GET /api/list?path=/abs/dir` → `{path, parent, entries: [{name, path, dir, language}]}`
- `GET /api/recent` → `{recent: [{path, at}]}` — files the user touched recently.

### Git

- `GET /api/git/info?path=…` → `{root, branch, fileStatus}` (`fileStatus` is `clean` or porcelain codes)
- `GET /api/git/status?path=…` → `{root, status}` (porcelain, whole repo)
- `GET /api/git/diff?path=…` → `{root, diff}` (unstaged diff for that file)
- `GET /api/git/log?path=…` → `{root, log: [{hash, author, when, subject, unpushed}], hasUpstream}`
  (`unpushed` = not on the upstream; everything is unpushed when the branch has no upstream)
- `GET /api/git/info` also reports `ahead`, `behind`, and `hasUpstream`
- `POST /api/git/commit` with `{"path": "…", "message": "…"}` → stages and commits that one file
- `POST /api/git/push` with `{"path": "…"}` → `git push` from that file's repo
  (adds `--set-upstream origin <branch>` when the branch has no upstream)
- `POST /api/git/fetch` with `{"path": "…"}` → `git fetch` (refreshes ahead/behind)
- `POST /api/git/pull` with `{"path": "…"}` → pulls using the configured
  `git.pullStrategy` (default `rebase` + autostash); on conflict the
  rebase/merge is aborted (repo left clean) and an error is returned

### Behavior policy

- `GET /api/config?path=…` → `{config, globalPath, globalExists, projectPath}` —
  the effective eddie config: defaults ← `~/.eddie/config.json` ← nearest
  `.eddie.json` walking up from the file.
- Actions set to `"never"` are enforced server-side: commit/push/pull return
  **403** with an explanatory error. Respect it — don't try to work around it
  with raw git. `"ask"` is a UI confirmation; API calls made by the user's own
  agent are treated as authorized and proceed.

### Linting

- `GET /api/lint/config?path=…&names=.markdownlint.json,.markdownlint.jsonc&fallback=markdownlint.json`
  → `{configPath, content, source}` where `source` is `project` (found walking
  up from the file, stopping at `$HOME`), `user` (`~/.eddie/<fallback>`), or
  `none` (`configPath` then names where the fallback would go).
  Linting itself runs in the browser; an agent changes behavior by writing the
  config file with `PUT /api/file` — the editor picks it up on tab refocus.

### Remote sources

- `GET /api/fetch?url=https://…` → `{ok, status, content}` — read-only fetch,
  e.g. a raw GitHub URL. Save the content locally with `PUT /api/file`.

### Trace log & recommendations (ADR-0010)

Eddie records everything notable in an append-only trace
(`~/.eddie/trace/*.jsonl`): records with `{id, ts, actor, thread, cause,
context, kind, body}` where kind is `event | message | action | proposal |
decision | run | outcome | lesson`. As an agent, **write to the trace** so
your work is auditable — every record's `cause` should point at what
prompted it.

- `GET /api/events` → Server-Sent Events stream of new records (the live tail)
- `GET /api/trace?kinds=action,message&thread=…&limit=100` → recent records
- `GET /api/trace/chain?id=…` → the "why?" cause chain for a record
- `POST /api/trace` with `{kind, actor?, thread?, cause?, context?, body}` →
  append a record (use `actor: {kind: "agent", id: "<your name>"}`)
- `GET /api/recommendations` → live (unsettled) recommendations
- `POST /api/recommend` with `{producer, text, anchor?, severity?, actions?,
  resolveOn?}` → surface a recommendation to the user. Anchors:
  `{type: "general"}`, `{type: "ui", target: "panel:git|element:<id>"}`, or
  `{type: "doc", path, quote, prefix?, suffix?, offset?}` — **pinned to a
  place in the text**. Doc anchors are content-addressed (ADR-0011): quote
  the exact text you're commenting on, plus ~16 chars of prefix/suffix
  context and the offset where you saw it; eddie locates it in the live
  document (gutter ✦ + highlight, in-context popover), tracks it through
  edits, and degrades gracefully if the text is gone — so you can safely
  annotate a document that changed since you read it.
  `severity`: `passive | notice | warn`. `resolveOn` names an event
  (e.g. `git.pushed`) that auto-resolves it. Coalesced by producer+anchor
  (doc anchors by path+quote).
- **Proposals** (ADR-0012): add `patch: {path, quote, prefix?, suffix?,
  offset?, replacement}` to `POST /api/recommend` and the card becomes a
  proposal — rendered as a diff with an Apply button, governed by the
  `ai.edit` policy (`ask` default; `never` → 403 on creation). This is how
  an agent offers an edit instead of making one: the human decides, and the
  applied chain (`proposal → decision → patch.applied`) is traced.
- `POST /api/ai/fix` with `{path, quote, prefix?, suffix?, offset?, rule?,
  message}` → runs the local AI CLI on the snippet and creates such a
  proposal (used by the lint "✦ ask eddie" action).
- `POST /api/ai/transform` with `{path, ask, quote, prefix?, suffix?,
  offset?, outline?}` → applies a freeform instruction to the target text
  and creates a proposal (used by the `/ai` command). Both AI edit
  endpoints reply `{ok: false, noFix: true}` when no genuine edit could
  be produced.
- `POST /api/recommend/settle` with `{id, how: applied|dismissed|resolved}`

User feedback (👍/👎) arrives as `outcome` records whose `cause` points at
your recommendation — read them to learn what was welcome.

Notes and commit messages carry the human "why":

- `PUT /api/file` returns `record`/`thread` for the save's trace record;
  a note is a `message` record `{subtype: "note", text}` with `cause`
  pointing at what it explains (the `/note` command and the History 💬
  button do this).
- `GET /api/trace/chain` also returns `effects` — forward links: notes,
  decisions, and outcomes that point at the record.
- Commits made outside eddie are imported as `git.commit.seen` events
  (subject/author/hash) whenever eddie next looks at the repo — read
  commit subjects as intent statements.

### AI chat

- `POST /api/ai/chat` with `{"messages": [{"role": "user"|"assistant", "text": "…"}],
  "path": "…", "context": {"path", "language", "text"}?}` → `{ok, reply}`.
  The server pipes a composed prompt to the configured CLI (`ai.command`,
  default `claude -p`). Governed by `ai.chat` policy (`never` → 403).

### Plugins

- `GET /api/plugins` → `{plugins: [{name, origin, url}], userPluginDir}`
- Plugin scripts are served at `/plugins/user/<name>` and `/plugins/builtin/<name>`.

## Typical agent flows

Open a file for the user and hand them the tab:

```bash
eddie ~/notes/todo.md
```

Edit a file the user has open (the browser does not live-reload yet; tell the
user to reload the tab, or make edits before they open it):

```bash
curl -s "http://127.0.0.1:4517/api/file?path=$HOME/notes/todo.md"
curl -s -X PUT http://127.0.0.1:4517/api/file \
  -H 'Content-Type: application/json' \
  -d '{"path": "/Users/ed/notes/todo.md", "content": "# Todo\n\n- ship eddie\n"}'
```

Commit on the user's behalf:

```bash
curl -s -X POST http://127.0.0.1:4517/api/git/commit \
  -H 'Content-Type: application/json' \
  -d '{"path": "/Users/ed/notes/todo.md", "message": "Update todo"}'
```

Extend the editor itself: write a plugin file into `~/.eddie/plugins/` (see
`plugins/README.md`) and it loads on the next tab reload.
