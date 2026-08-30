# ADR-0007: Features compose as panels

- **Status:** accepted
- **Date:** 2026-08-30

## Context

The git feature grew as a hard-wired subsystem: static markup in
`index.html`, a dedicated toolbar button, bespoke toggle code. Each new
feature of that shape (AI chat, outline, todo) would repeat the pattern and
bloat core.

## Decision

A panel framework: `eddie.registerPanel(id, {title, button, render, onShow,
onHide})` gives a feature a toolbar toggle and a slot in the right-side dock
(lazy render, one active at a time). The git panel was refactored onto it,
and AI chat ships as a plugin-implemented panel (`plugins/chat.js`) to prove
core and plugins use the identical mechanism.

## Consequences

- "New sidebar feature" is now a plugin-sized task; the dogfooding rule
  (built-ins use the public API) keeps the framework honest.
- One-at-a-time dock display is a simplicity trade; side-by-side panels
  would need a layout manager we don't yet want.
