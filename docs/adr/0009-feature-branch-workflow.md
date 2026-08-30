# ADR-0009: Feature-branch workflow

- **Status:** accepted
- **Date:** 2026-08-30

## Context

Early development pushed straight to `main`, which was fine for a two-file
scaffold but caused non-fast-forward collisions once human and agent were
committing concurrently, and gives changes no review point as they grow more
complicated.

## Decision

All changes land on feature branches named `<type>/<topic>` with type in
`feat | fix | docs | chore | refactor`, branched from `main`. The branch is
pushed for review; `main` is merged to after the human has looked (a GitHub
PR when line-comment review is wanted, a plain merge when a read-through is
enough). Direct commits to `main` are reserved for trivial doc typo fixes.

## Consequences

- Human and agent stop colliding on `main`; every change gets a natural
  review point matching the "human expresses intent, agent writes code"
  development model.
- Slightly more ceremony per change; accepted as the cost of scale.
- Long-lived branches are discouraged — branch, land, delete.
