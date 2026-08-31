# ADR-0012: Mutations offered by rules/AI are proposals — patch, decision, applied action

- **Status:** accepted
- **Date:** 2026-08-31

## Context

The first AI-adjacent mutation surface (design doc §5): lint issues should
carry an eddie glyph that proposes a fix. Some markdownlint rules provide
deterministic `fixInfo`; others need AI. Either way the mutation must be
reviewable, policy-governed, and fully traceable.

## Decision

A proposal is a card with a **patch**: the same content-anchored shape as
doc anchors (`{path, quote, prefix, suffix, offset}`) plus a `replacement`.
Proposals are trace records of kind `proposal`, coalesced/settled through
the recommendation machinery, rendered as a red/green diff in the popover
and panel with an **Apply** button. Every lint diagnostic gets an action:
**✦ fix** (built from `fixInfo`, no AI) or **✦ ask eddie** (`POST
/api/ai/fix` runs the local CLI on the snippet with strict
replace-only-the-snippet prompting plus prefix/suffix leak guards; the run
is a `run` record, the proposal's cause). Applying locates the quote in the
live buffer, applies the change, and writes the full chain: `proposal →
decision (applied/dismissed) → action patch.applied`. Governed by
`ai.edit`: `ask` (default — review the diff), `auto` (apply on arrival),
`never` (creation refused server-side, 403).

## Consequences

- The proposal machinery exists before `/ai` does, proven on deterministic
  fixes first; `/ai` and future agents reuse the same patch shape, card,
  policy, and causality.
- Content-anchored patches apply correctly even after unrelated edits, and
  refuse (rather than misapply) when the target text changed.
- One-line patches render well; rich multi-hunk diffs are future work when
  a producer needs them.
