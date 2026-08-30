# ADR-0005: Configs resolve by walking up from the edited file

- **Status:** accepted
- **Date:** 2026-08-29

## Context

Linter configs (and later, behavior policy) need to vary per project while
having sensible personal defaults. Editors typically choose: global-only
settings, per-project dotfiles, or both.

## Decision

One resolution pattern for all configs: walk up from the edited file's
directory looking for the project file (`.markdownlint.json`, `.eddie.json`,
…), stopping at `$HOME` or the filesystem root; fall back to a global file
under `~/.eddie/`; defaults below that. Project beats global beats defaults
(deep-merged for eddie config). Config edits apply on tab refocus — the
frontend clears caches and re-fetches on window focus rather than watching
files.

## Consequences

- Per-repo behavior "just works" by dropping a file in the repo, matching
  how markdownlint/editorconfig-style tools already behave.
- Stopping at `$HOME` prevents stray configs above the home directory from
  leaking in.
- Refocus-based reload is a deliberate simplicity trade: no file watchers,
  at the cost of "edits apply when you click back into the tab."
