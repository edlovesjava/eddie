# ADR-0010: The trace log is the substrate; the event bus is its tail

- **Status:** accepted
- **Date:** 2026-08-30

## Context

Full AI integration (docs/design/ai-integration.md) needs events, push to
the browser, recommendations, threads, and auditability — "what I thought,
what I did, why I did it," plus outcomes for learning. Building these as
separate systems would duplicate state and lose causality.

## Decision

One append-only trace log (`server/trace.js`, JSONL segments under
`~/.eddie/trace/`) with a single record envelope: id, ts, actor
(human/agent/automation/rule/system), thread, cause edges, context-at-time,
kind (`event | message | action | proposal | decision | run | outcome |
lesson`), body. One write path: append → publish. The event bus is the
log's live tail, streamed to the browser over SSE (`GET /api/events`).
Recommendations are message records coalesced by producer+anchor with
auto-resolve on named events; feedback is outcome records; "why?" is a walk
of cause edges (`GET /api/trace/chain`). In-memory index (capped) over the
recent segments; dependency-free.

## Consequences

- Auditability and learning capture are structural, not features: every
  subsequent capability (proposals, automations, agents) writes records
  and inherits causality, threads, and outcomes for free.
- Recording granularity is save/command/decision level — never keystrokes —
  with retention as config.
- The in-memory index bounds "why?" chains to recent segments; a real index
  (e.g. SQLite) is a superseding ADR if personal scale ever hurts.
