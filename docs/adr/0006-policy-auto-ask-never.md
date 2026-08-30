# ADR-0006: Behavior policy per action — auto / ask / never, `never` enforced server-side

- **Status:** accepted
- **Date:** 2026-08-30

## Context

A Pull button that silently rebased local commits raised the question: which
actions may run without asking? The answer differs per person, per repo, and
per action — and Eddie's API is open to agents, so a UI-only guard is not a
guard.

## Decision

Every state-mutating capability declares a policy in eddie config
(ADR-0005): `auto` (just do it), `ask` (the UI confirms first, describing
the concrete consequence), or `never` (blocked). `never` is enforced in the
server with a 403, binding API callers and agents too. `ask` is a UI
concern; API calls from the owner's own agents are treated as authorized.
Defaults encode the danger gradient: destructive-to-history actions default
to `ask` (pull/rebase), explicit button-press actions to `auto`
(commit, push).

## Consequences

- One legible mechanism answers "should this be automatic?" for every
  future feature; new capabilities add a config key, not a new system.
- Server-side enforcement makes per-repo restrictions real (e.g.
  `{"git": {"push": "never"}}` in a repo that must never be pushed from
  Eddie).
- An approval-queue for agent-initiated `ask` actions is future work; today
  `ask` gates only UI-initiated actions.
