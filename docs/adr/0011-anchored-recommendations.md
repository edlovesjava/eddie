# ADR-0011: Recommendations are annotations — anchored by content, not coordinates

- **Status:** accepted
- **Date:** 2026-08-30

## Context

Recommendations need context: general, pinned to a place in a document, or
pinned to a UI feature (design doc §3). Doc positions rot as text is edited,
and agents may anchor from a stale snapshot of the document.

## Decision

An anchor is one of `{type: general}`, `{type: ui, target}` (symbolic
registry ids like `panel:git`), or `{type: doc, path, quote, prefix,
suffix, offset}`. Doc anchors are **identified by content**: located by the
nearest quote match to the stored offset, disambiguated by prefix/suffix
(the W3C Web Annotation approach). In-session, the located range lives in
CodeMirror RangeSets, which remap through every edit; anchors re-locate on
save; an unfindable quote **degrades gracefully** to the panel with an
"anchored text has changed" note, never pointing at the wrong line.
Coalescing identity for doc anchors is `path+quote` (offsets shift and must
not fork cards). Presentation: gutter ✦ + subtle text highlight; mousedown
is hit-tested by editor position (CodeMirror swallows click events for
in-text gestures); a contextual popover carries the same card as the panel
(actions, 👍/👎, dismiss, why?).

## Consequences

- Agents can safely annotate version N+k of a doc they read at version N —
  content-addressing absorbs drift; producers and consumers never exchange
  line numbers.
- Duplicate quotes resolve to the nearest-to-offset match — ambiguity is
  bounded by prefix/suffix, not eliminated; acceptable for prose.
- Cross-session re-anchoring (persisted anchors re-located on open) is
  Phase 4; today anchors re-locate live while the recommendation is live.
