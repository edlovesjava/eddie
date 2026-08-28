# eddie

A fast, personal, browser-based text editor for the Mac — built for markup
files (Markdown first, plus JSON, bash, YAML and friends), opened straight
from the terminal or Finder, with git built in and every feature reachable by
an AI agent over a local HTTP API.

Eddie is intentionally small: a dependency-free Node server, a CodeMirror 6
frontend, and a plugin folder. It's *my* editor — it does the things I do.

## Install (macOS)

Requires Node 18+ (`brew install node`).

```bash
git clone https://github.com/edlovesjava/eddie.git
cd eddie
npm install          # also builds the frontend bundle
npm link             # puts `eddie` on your PATH
```

Optional Finder integration (creates `~/Applications/Eddie.app` so you can
right-click → Open With → Eddie):

```bash
bash scripts/install-finder-app.sh
```

## Use

```bash
eddie notes.md            # open a file — starts the server on first use
eddie a.md b.json         # several files, one browser tab each
eddie                     # home screen: recent files + file browser
eddie status              # is the server running?
eddie restart             # restart the server (picks up new code)
eddie stop                # stop the server
```

## Upgrade

```bash
eddie upgrade
```

That's `git pull` + `npm install` (which rebuilds the frontend) + a server
restart, in one go. Reload any open editor tabs afterward. (Commands also work
as flags — `eddie --upgrade` — and a file literally named `upgrade` still
opens as a file.)

The server listens on `http://127.0.0.1:4517` (change with `EDDIE_PORT` or
`--port`). Opening a file that doesn't exist yet works — it's created on save.

In the editor:

- **Cmd+S** saves (save hooks from plugins run first)
- **Cmd+Shift+P** or the **Preview** button toggles live Markdown preview
  (opens automatically for `.md` files)
- **Format** pretty-prints the document (JSON built in; add formatters for
  other languages via plugins)
- **Lint** runs as you type: [markdownlint](https://github.com/DavidAnson/markdownlint)
  for Markdown and syntax checking for JSON, with squiggles, gutter markers, a
  ⚠ count in the status bar, and a diagnostics panel (**Lint** button). Other
  languages plug in via `eddie.registerLinter`.
- **Lint ⚙** opens the linter config. Markdown uses standard
  `.markdownlint.json` files — the nearest one walking up from your file wins
  (so per-project configs just work), else `~/.eddie/markdownlint.json`, which
  Eddie creates with sensible defaults on first use. Edit, save, refocus your
  document's tab — the new rules apply immediately.
- **Git** opens a panel with the file's diff, one-box commit, history, and
  **Push**. Commits that haven't reached the upstream are tagged `unpushed`,
  the panel says how many commits you're ahead/behind, and the top-bar badge
  shows the branch plus `↑n` when there's something to push (`git push` runs
  with your normal local credentials; a branch with no upstream gets
  `--set-upstream origin <branch>` automatically). The panel shows which
  identity and remote a push will use — for juggling work/personal/school
  GitHub accounts per repo, see [docs/GIT-ACCOUNTS.md](docs/GIT-ACCOUNTS.md)
- **Slash commands**, inline or from the palette. Type `/table 3x4` (or
  `/link`, `/date`, `/hr`) in the document and hit Enter — the command text is
  replaced by its output. Or press **Cmd+K** (or the `/` toolbar button) for a
  filterable command palette that works the same way. `/link` opens a
  Finder-style file picker and inserts a relative markdown link to the chosen
  doc. Plugins add their own commands via `eddie.registerCommand`

## Languages

Markdown, JSON, shell/bash, YAML, JavaScript/TypeScript, CSS, HTML — picked by
file extension. Anything else opens as plain text.

## Plugins

Drop a `.js` file in `~/.eddie/plugins/` and reload the tab. Plugins get a
small, stable `window.eddie` API: read/replace the document, add toolbar
buttons and status items, register formatters, hook saves. See
[plugins/README.md](plugins/README.md). A word-count plugin ships as the
example.

## Agents welcome

Everything Eddie's UI does goes through a documented localhost JSON API —
files, directory listing, git status/diff/log/commit, remote fetch, plugin
discovery — so Claude (or any agent with shell access) can open files for you,
edit them, commit them, or extend the editor by writing a plugin. See
[docs/AGENTS.md](docs/AGENTS.md).

## Remote sources

`GET /api/fetch?url=https://…` pulls read-only content from remote sources
(e.g. raw GitHub files); save it anywhere with the file API. Deeper remote
integration (open-from-URL in the UI, gists) is on the roadmap.

## Layout

```
bin/eddie.js        CLI: health-check, start server, open browser
server/server.js    localhost HTTP server + JSON API (no dependencies)
web/                frontend: CodeMirror 6 app (esbuild-bundled)
plugins/            built-in plugins + plugin docs
scripts/            Finder app installer
docs/AGENTS.md      the API, written for agents
```

## Roadmap ideas

- Live-reload when a file changes on disk (agent edits appear instantly)
- Push/pull and branch switching in the git panel
- Formatter plugins: prettier for Markdown, shfmt for bash
- Open-from-URL and gist support in the UI
