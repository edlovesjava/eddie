# ADR-0003: The localhost JSON API is the single interface

- **Status:** accepted
- **Date:** 2026-08-28

## Context

Eddie must be "completely open to agent use": Claude (or any agent with shell
access) should be able to do anything the UI can. That fails if features are
implemented UI-side with private channels.

## Decision

Every capability is an endpoint on the localhost JSON API. The UI, plugins,
and agents are peers consuming the same API, documented for agents in
`docs/AGENTS.md`. Security posture: bind `127.0.0.1` only, reject
non-localhost `Host` headers (DNS-rebinding guard), no auth token — the
threat model is "other people on the network," not "other processes owned by
the same user."

## Consequences

- Agents get full capability for free with every feature; the API docs are a
  first-class deliverable.
- Anything reachable by the user's local processes is reachable by the API —
  which is why state-mutating endpoints are governed by policy (ADR-0006).
- No remote/multi-user story without revisiting auth; explicitly out of
  scope for a personal tool.
