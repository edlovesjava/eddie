# ADR-0014: Local version history is content-addressed save snapshots; git stays the VCS

- **Status:** accepted
- **Date:** 2026-09-06

## Context

Git only sees committed states: the churn between commits, and every file
outside a repo, had a timeline in the trace (when/who/why) but no bytes —
"you saved 14 times" was answerable, "show me version 9" was not. Options:
rely on git alone (fails non-git files and between-commit history); a
shadow/auto-init git repo (litters the filesystem, surprises other tools);
or editor-style local history.

## Decision

On every save eddie snapshots the full content, gzipped, into
`~/.eddie/history/objects/<hash>.gz`, keyed by the **same 16-hex sha256
prefix the trace already stamps on save records** (`context.doc.hash`) —
so a History row and its snapshot join on the hash with no new linkage.
An append-only JSONL index records `{ts, path, hash, bytes, origin}`;
identical consecutive contents are deduped. Before overwriting a file whose
on-disk content eddie never saw, that content is snapshotted too (origin
`disk`), so external edits can't be silently lost. Retention is
`history.days` in the config (default 30, `0` disables), pruned at server
startup. `GET /api/history?path=` lists versions; `GET
/api/history/content?hash=` returns one. In the History panel, save rows
carry ⇄: a diff of that version against the buffer and a **Load this
version** that fills the buffer without saving — restoring is an ordinary
edit you review and Cmd+S. Eddie never writes to git on its own.

## Consequences

- History exists for every file, git or not; git remains the only real
  versioning and is never auto-committed to.
- Observed-outcome detection (applied-then-reverted) and queued tasks get
  document-at-that-moment states for free via the hash join.
- Disk cost is bounded by retention and dedup; personal scale assumptions
  (whole-index reads) are explicit in `server/history.js` and revisit-able.
- Snapshots are plaintext-at-rest in `~/.eddie` like the trace; nothing
  leaves the machine.
