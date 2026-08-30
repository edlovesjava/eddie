# Design: full AI integration

- **Status:** draft for review — this is the reference we build the phases
  against; each phase turns parts of it into ADRs as decisions firm up.
- **Date:** 2026-08-30

## Intent (the human's words)

Full AI integration means: AI can catch actions and interpret intent,
potentially warn or assist; be run inline during edit (`/ai …`); a recommend
panel; external chat and command invocation. Commands can update the target
doc or workspace, but can also ask AI to build a panel or capability, or set
up an automation — *"please warn me if someone pushes something to this
branch"* is an example of what a **user** might add, not a feature we
pre-build. So there must be background agents reacting to events. Threads
must be auditable: when, who (agent/human), the context at the time with
traceable history — what I thought, what I did, why I did it.

## The unifying insight

Those asks are a small set of primitives viewed from different angles:

| Ask | Primitive it requires |
|---|---|
| Catch actions, interpret intent, warn/assist | trace log (events) + budgeted observers |
| Inline `/ai` | one AI gateway reachable from the command registry |
| Recommend panel, in-context recommendations | recommendation records + the anchor model |
| External chat & command invocation | gateway + command registry over the existing API |
| AI updates doc / builds capability | gateway tools + proposals |
| User-authored automations, background agents | automation records + one-shot agent runs |
| Auditability | the trace log again — it is the substrate, not a feature |

Eddie already has three of the needed pieces: the command registry, the open
localhost API (ADR-0003), and the policy system (ADR-0006). This design adds
four: the **trace log** (with the event bus as its live tail), the **AI
gateway** with tools, **proposals** with an approval queue, and
**automations**. Recommendations and threads are record types on top.

---

## 1. The trace log — auditability as the substrate

An append-only log of records. The event bus is not a separate system: one
write path (`append → publish`), the browser's push channel (SSE) tails it,
and threads/recommendations/history views are queries over it.

### Record envelope

Every record answers when / who / in-what-context / caused-by-what / what:

```jsonc
{
  "id": "r_01J…",                       // unique, ordered
  "ts": "2026-08-30T17:04:11Z",         // WHEN
  "actor": {                             // WHO
    "kind": "human | agent | automation | rule | system",
    "id": "ed | chat-panel | watch-main | unpushed-reminder | policy",
    "session": "s_…"
  },
  "thread": "t_…",                      // conversation it belongs to
  "cause": ["r_…", "r_…"],              // WHY — causality edges
  "context": {                           // WHAT WAS TRUE at the time
    "doc": { "path": "/…/notes.md", "hash": "sha256:…" },
    "config": "sha256:…"
  },
  "kind": "event | message | action | proposal | decision | run",
  "body": { }                            // kind-specific
}
```

### Record kinds — "what I thought, what I did, why I did it"

- **event** — something happened: `file.saved`, `doc.idle`, `command.ran`,
  `git.committed`, `git.remote-moved`, `automation.fired`, timer ticks.
- **message** — what was *said/thought*: chat turns, agent reasoning
  summaries, recommendation text. Agent runs store a summary inline and a
  ref to the full transcript.
- **action** — what was *done*: patch applied, command executed, push,
  plugin installed, automation created.
- **proposal** — what was *offered* and awaits judgment: an AI edit, a
  suggested automation, a generated plugin.
- **decision** — what was *chosen*, first-class: Apply/Dismiss by a human
  (actor `human`, cause → proposal), or an auto-apply by policy (actor
  `system`, with the config hash recorded). "Why was this allowed?" always
  has a literal stored answer.
- **run** — an agent execution: instruction, model/CLI used, context refs,
  outcome, duration, cost (cost feeds future budgets).

### Causality is the product

Every record's `cause` points at what produced it. Any change walks back to
human intent:

```
action: patch-applied
 ← decision: human accepted            (what you did)
 ← proposal: agent's edit              (what was offered)
 ← message: agent reasoning summary    (what it thought)
 ← run: agent fired                    (who, with what instruction)
 ← event: git.remote-moved             (what triggered it)
 ← action: automation created ← decision ← message:
     "warn me if someone pushes to this branch"   (what YOU said, weeks ago)
```

Invariant: **every chain terminates at a human utterance or a
human-set config.** Nothing the system does is unexplainable.

### Context-at-time

Doc-touching records carry content hashes (before/after) with snapshots in a
content-addressed store (`~/.eddie/objects/<hash>`), deduplicated; where the
file is in a git repo, commits serve as snapshots and are referenced instead.
"Show me exactly what the agent saw" stays answerable after the doc moves on.

### Mechanics and boundaries

- Storage: append-only JSONL segments under `~/.eddie/trace/`; in-memory
  index rebuilt on start. Dependency-free (per ADR-0001); if scale ever
  demands SQLite, that's a superseding ADR.
- Immutable: corrections and redactions are new records (tombstones), never
  rewrites.
- **Granularity is a dial, not a dragnet**: record at save / idle-burst /
  command / decision level — never keystrokes. Retention windows in config.
  Local-only and owner-owned, but a personal panopticon would violate
  priority #1 (ease of mind is part of ease of burden).
- Surfaces: a History panel (filter by thread/actor/doc); a **"why?"
  affordance on everything** — recommendations, applied changes, automations
  — rendering the cause chain; `eddie why <file>` in the CLI.

## 2. Threads

A thread is a *view over the trace*: the records sharing a `thread` id, in
order. Chat renders its message records; the audit view renders everything.
Forking = a new thread whose first record's cause points into the parent.
Each agent run gets its own thread; cross-thread `cause` edges link
collaborations. This is the minimal commitment that keeps multi-agent
context management open: the trace is the context store, and future
context-assembly strategies are queries over it.

## 3. Recommendations and the anchor model

A recommendation is an **annotation on something**; "general" is the
degenerate anchor. It is a record (kind `message`, subtype recommendation)
with:

```jsonc
{
  "anchor":
    { "type": "general" } |
    { "type": "doc", "path": "…", "quote": "…", "prefix": "…",
      "suffix": "…", "offset": 1234 } |
    { "type": "ui", "target": "panel:git | command:table | config:git.pull | element:btn-format" },
  "severity": "passive | notice | warn",
  "actions": [ { "label": "Apply", "command": "…" } ],   // registry commands or proposals
  "resolveOn": "git.pushed"                               // optional auto-resolve event
}
```

### Doc anchors — the hard part

- **In-session:** CodeMirror 6 RangeSets remap positions through every edit;
  anchors stay glued while the doc is open.
- **Across sessions / external edits / stale agent snapshots:** anchors are
  stored as *content* (quote + prefix/suffix + approximate offset — the W3C
  Web Annotation approach). Re-anchor by fuzzy text search on open; on
  failure, **degrade gracefully to general** with a "text has changed" note
  rather than pointing at the wrong line. This also lets an agent that
  analyzed doc version N anchor safely into version N+k.

### UI anchors

Targets are symbolic ids from existing registries (panels, commands, config
keys, toolbar elements) — never DOM nodes. Examples: `/table` hint pinned to
the palette button; "3 unpushed commits" pinned to the Git panel button;
a config suggestion pinned to the settings entry.

### Presentation — the eddie icon

- **passive**: a small eddie glyph appears (gutter marker at doc anchors,
  corner badge on UI targets, count on the status-bar icon). No motion.
- **notice**: glyph animates once.
- **warn**: toast + persistent pulse until acknowledged.

Click → contextual popover at the anchor: message, provenance ("from
automation *watch-main*"), actions (Apply/Dismiss/Snooze), a **why?** link
(cause chain), and **Continue in chat** — which opens the chat panel
*attached to the recommendation's thread*, so the conversation starts with
full context instead of cold.

Attention economics: coalesce per anchor (new info updates the card, never
stacks), per-producer rate limits. If the icon animates, it must be worth
clicking.

Lifecycle: `created → visible → (applied | dismissed | snoozed) → resolved`,
persisted; auto-resolve via `resolveOn` events so stale advice disappears
silently.

## 4. The AI gateway

Today `/api/ai/chat` is text-in/text-out to a local CLI (ADR-0008). The
gateway upgrade gives AI sessions structured tools — Eddie exposes its own
API as an **MCP server**, and launches `claude` with that MCP config. Tools
(governed by policy, below): read/write files, run registry commands, query
git, post recommendations, create proposals, create automations. Then the
chat panel, background agents, and *external* Claude sessions (your
terminal) are all first-class operators of the editor, keeping ADR-0008's
no-API-keys stance.

Self-extension falls out: "build me a panel that does X" = the agent writes
a plugin file into `~/.eddie/plugins/` through the file tool, delivered as a
proposal ("plugin ready — enable?"); a reload activates it. The architecture
already supports this (ADR-0004); the gateway hands AI the pen.

## 5. Proposals and the approval queue

Any AI-initiated mutation is a `proposal` record:
`{anchor, description, kind: patch | command | plugin | automation, payload}`.
Policy verdict decides its path: `auto` → applied (with a `decision` record,
actor `system`); `ask` → approval queue, rendered in-context via its anchor
(diff preview for patches) with Apply/Dismiss; `never` → refused
server-side. This closes the gap ADR-0006 left open: agent-initiated `ask`
actions now have a way to ask.

## 6. Automations and background agents

An automation is a stored record:

```jsonc
{ "id": "watch-main", "trigger": { "event": "git.remote-moved", "filter": {…} }
              /* or { "schedule": "…" } */,
  "instruction": "warn me if someone pushes to this branch",
  "scope": { "repo": "…" }, "policy": {…} }
```

The user *says* the sentence — in chat, inline, wherever — and the AI's
`create_automation` tool writes the record **as a proposal**, so the user
confirms what was understood. Triggers are dumb and cheap (event patterns,
timers, poll-diffs feeding events like `git.remote-moved`);
**interpretation happens at fire time**: the trigger starts a one-shot agent
run (local CLI + tools + the event + the instruction), which decides what to
do — post a warning recommendation, propose a fix, or nothing. No pre-built
watcher taxonomy.

## 7. Surfaces

- **`/ai <ask>`** — registry command; sends selection/doc + ask to the
  gateway; result returns as an anchored proposal.
- **Recommend panel** — the recommendation/approval queue view; History
  panel for the trace.
- **Chat panel** — becomes a thread viewer/attacher rather than the only
  conversation.
- **CLI** — `eddie ask "…"`, `eddie do "/toc"`, `eddie why <file>`.
- **Ambient intent** — deliberately last: a debounced observer on
  `doc.idle`/`file.saved` (never keystrokes), off by default
  (`ai.ambient: never`), hard budget (max calls/hour), and
  **recommendations-only** — it never mutates.

## 8. Policy additions (same mechanism, new keys)

`ai.tools.*` (what the gateway may touch), `ai.edit` (propose-only vs
auto-apply), `ai.ambient`, `automations.create`, `automations.run`, plus
per-automation overrides and budgets. `never` stays server-enforced; `ask`
now has teeth everywhere via the approval queue.

## Phasing (each phase ships something usable)

1. **Trace log + SSE + recommend panel** — the log with envelope/kinds, the
   bus as its tail, SSE push, toasts, status-bar eddie icon, general + UI
   anchors, rule-based producers (unpushed reminder, lint summary), History
   panel with "why?". No AI changes.
   1.5 — in-session doc anchors (CM RangeSet) + the gutter eddie icon +
   contextual popover.
2. **Proposals + `/ai` inline** — anchored patches with diff preview under
   `ask`; decision records; threads + Continue-in-chat.
3. **Automations + background agents** — automation records, pollers
   emitting external events, one-shot agent runs, the
   "warn me if someone pushes" sentence works end-to-end.
4. **MCP gateway** — full tool access; chat panel and external sessions
   become operators; capability-builder flow; quote-based re-anchoring for
   persistence.
5. **Ambient intent** — budgeted, recommendations-only, off by default.

## ADR candidates (written as each phase lands)

- Trace log as substrate; event bus = its tail (extends 0001/0003)
- Anchored recommendations (annotation model)
- Proposals + decisions + approval queue (extends 0006)
- Automations as records, interpreted by agents at fire time
- Eddie as MCP server (extends 0008)
- Ambient observation budget (extends 0006)

## Deliberately deferred

- Multi-agent context assembly strategies (the trace makes them possible;
  we choose one when we need it)
- Streaming AI responses (revisit trigger named in ADR-0008)
- SQLite or similar for the trace index (only if JSONL at personal scale
  actually hurts)
- Remote/multi-user anything (out of scope per ADR-0003)
