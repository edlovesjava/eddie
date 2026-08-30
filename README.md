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

## Upgrade

```bash
eddie upgrade
```

That's `git pull` + `npm install` (which rebuilds the frontend) + a server
restart, in one go. Reload any open editor tabs afterward. (Commands also work
as flags — `eddie --upgrade` — and a file literally named `upgrade` still
opens as a file.)

## Use

```bash
eddie notes.md            # open a file — starts the server on first use
eddie a.md b.json         # several files, one browser tab each
eddie                     # home screen: recent files + file browser
eddie status              # is the server running?
eddie restart             # restart the server (picks up new code)
eddie stop                # stop the server
```

## Editor

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
- **Git** opens a panel with the file's diff, one-box commit, history,
  **Push**, and **Pull**. Opening the panel fetches, so the ahead/behind
  counts reflect the real remote; Pull is `git pull --rebase --autostash`
  (conflicts abort cleanly with a message), and if the open file isn't dirty
  it reloads after a pull. Commits that haven't reached the upstream are
  tagged `unpushed`, and the top-bar badge
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

## Slash command examples

### here is a link using `/link`

[package](package.json)

### here is a table example using `/table 2 3`

| Col 1 | Col 2 | Col 3 |
| --- | --- | --- |
| D11 | D12 | D13 |
| D21 | D22 | D23 |

## Panels

Features compose as **panels** — self-contained units in the right-side dock,
each with an auto-created toolbar button. The git panel is one; **AI chat**
is another, and it's implemented entirely as a plugin (`plugins/chat.js`) to
keep the architecture honest: if chat can be built without touching core,
anything can. Register your own with `eddie.registerPanel` (see
[plugins/README.md](plugins/README.md)).

**AI chat** talks to your local `claude` CLI (Claude Code) — no API key to
manage; it uses whatever auth your CLI already has. Open **Chat**, ask about
the current document ("include document" sends the live buffer as context),
Cmd+Enter to send. Swap the backend with `ai.command`/`ai.args` in
`/settings`, or disable it entirely with `"ai": {"chat": "never"}`.

## The trace, recommendations, and the ✦ icon

Eddie keeps an append-only **trace** of everything notable — saves, commits,
pushes, commands, chat turns, recommendations, your decisions on them — each
record carrying who did it, when, in what context, and *why* (causality
links). The **History** panel shows it; every entry answers "why?" by
walking its cause chain. It's the substrate for the AI integration roadmap
(`docs/design/ai-integration.md`), and it's local, in
`~/.eddie/trace/*.jsonl`.

**Recommendations** ride on it: rule producers (e.g. unpushed commits, a
lint pile-up) surface cards anchored to the relevant UI — a badge appears on
the feature, the **✦** icon in the status bar shows the count (click it for
the panel), and `warn`-level items toast. Cards offer actions, dismiss, and
**👍/👎 feedback** — judgments are recorded as outcomes so Eddie can learn
what's welcome (the learning loop in the design doc). Recommendations
auto-resolve when their condition clears (push your commits and the
reminder silently disappears).

## Configuration

Eddie has a behavior policy system: each action is `"auto"` (just do it),
`"ask"` (confirm first), or `"never"` (blocked — enforced by the server, so
API callers and agents are refused too). Run `/settings` (Cmd+K → settings)
to open the global config, `~/.eddie/config.json`, created with defaults on
first use:

```json
{
  "git": {
    "commit": "auto",
    "push": "auto",
    "pull": "ask",
    "autofetch": "auto",
    "pullStrategy": "rebase"
  }
}
```

- `pull` defaults to `"ask"` because pulling can rebase your local commits —
  the confirmation says exactly what will happen ("Rebase 2 local commits
  onto 1 remote commit?"). `commit`/`push` default to `"auto"` since clicking
  the button is already explicit.
- `pullStrategy`: `rebase` (linear history, with autostash), `merge`, or
  `ff-only` (refuse to pull when histories diverge).
- A `.eddie.json` in a repo (found walking up from the file, like lint
  configs) overrides the global config per project — e.g. put
  `{"git": {"push": "never"}}` in a repo you never want pushed from Eddie.

Config edits apply when you refocus an editor tab.

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

```text
bin/eddie.js          CLI: health-check, start server, open browser
server/server.js      localhost HTTP server + JSON API (no dependencies)
web/                  frontend: CodeMirror 6 app (esbuild-bundled)
plugins/              built-in plugins + plugin docs
scripts/              Finder app installer
CLAUDE.md             working posture for agent sessions in this repo
docs/ARCHITECTURE.md  system map, extension points, invariants
docs/adr/             architecture decision records
docs/AGENTS.md        the API, written for agents
```

## Contributing (mostly by agents)

Development is agentic-first: the human expresses intent, agents write most
of the code, hand-coded contributions welcome. Start with
[CLAUDE.md](CLAUDE.md) for the working posture,
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) before building, and
[docs/adr/](docs/adr/README.md) for decisions already made. Changes land on
feature branches (`feat/… fix/… docs/…`) and merge to `main` after review.

## Roadmap ideas

- Live-reload when a file changes on disk (agent edits appear instantly)
- Push/pull and branch switching in the git panel
- Formatter plugins: prettier for Markdown, shfmt for bash
- Open-from-URL and gist support in the UI
