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
