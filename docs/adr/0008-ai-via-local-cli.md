# ADR-0008: AI features shell out to a local CLI, not API keys

- **Status:** accepted
- **Date:** 2026-08-30

## Context

The AI chat panel needs an LLM backend. Options: Anthropic SDK with an API
key managed by Eddie, raw HTTP, or spawning the locally installed `claude`
CLI (Claude Code), which is already authenticated on the owner's machine.

## Decision

`/api/ai/chat` composes a prompt (conversation + optional live document) and
pipes it via stdin to a configurable local command — default `claude` with
args `["-p"]`. No API keys are stored, read, or configured by Eddie. The
command is swappable per config (`ai.command`/`ai.args`), and the capability
is governed by policy (`ai.chat: never` → 403, per ADR-0006).

## Consequences

- Zero credential management; AI works wherever the owner's CLI works, on
  the owner's existing plan.
- Latency includes CLI startup, and there's no streaming yet; acceptable for
  a chat panel, revisit (SDK + streaming would be the path) if it hurts.
- The prompt contract is plain text in/out, so any CLI that reads stdin and
  prints a reply can serve as the backend.
