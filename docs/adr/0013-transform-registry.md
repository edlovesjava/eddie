# ADR-0013: Deterministic transforms are a registered capability; AI-created ones join the registry with provenance

- **Status:** accepted
- **Date:** 2026-09-01

## Context

Mechanical edits (list renumbering, trailing-space cleanup) were paying for
LLM round trips, or costing one click per issue via `fixInfo`. And when the
AI solved something mechanical, the solution evaporated — the next
occurrence paid the full round trip again. Options: keep everything behind
`✦ fix`/`✦ ask eddie` as-is; hard-code a few bulk fixes; or make
deterministic transforms a first-class, growable registry that AI output
can be promoted into. Full design: [docs/design/transforms.md](../design/transforms.md).

## Decision

A **transform** is a pure, deterministic function `(text, ctx) => newText |
null` with metadata (title, languages, optional lint `rules` it remedies,
`origin: builtin | user | ai`, provenance). It is the fourth member of the
`register*` family: `eddie.registerTransform(name, fn, meta)`; built-ins
ship with eddie, user and AI-created ones are single plain-JS files in
`~/.eddie/transforms/` loaded like plugins (ADR-0004).

Invocation: `/fixall` (markdownlint `applyFixes` over current diagnostics,
one proposal diff), `/apply <name>` (selection → paragraph → document
targeting), ✦ actions on diagnostics matching a transform's `rules`, and
`POST /api/transform` for agents. Human-invoked transforms edit directly
(traced as `action`); machine-proposed ones land as proposals (ADR-0012).

AI-created transforms are **promoted**, not just saved: the generated
function must reproduce the original accepted edit (self-test gate) before
it is written, carries its provenance (the run that birthed it) in file and
registry, and is governed by a new `ai.createTransform` policy key (`ask`
default, `never` server-enforced per ADR-0006). Every run is a traced
`action`; outcomes attach — the registry is a learning-loop surface and the
remedy vocabulary for repetition analysis (design doc §9, phase 4.5).

## Consequences

- Mechanical fixes become free and instant; the LLM is reserved for edits
  that need judgment, and each promoted transform permanently converts one
  class of AI work into script work.
- One more `register*` seam plugins already understand; the registry is
  browsable as files, auditable via the trace, and safe to grow — a bad
  transform is a file you delete.
- The determinism contract is convention plus the self-test gate, not a
  sandbox — acceptable at personal scale (same trust model as plugins),
  revisit if transforms are ever shared.
- Commits us to keeping the patch/proposal machinery the single mutation
  path for machine-initiated edits.
