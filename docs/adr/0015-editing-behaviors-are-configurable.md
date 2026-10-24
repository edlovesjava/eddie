# ADR-0015: Editing behaviors ship with a config switch; "/" over a selection opens the palette

- **Status:** accepted
- **Date:** 2026-10-24

## Context

Selection-aware commands (`/list` first; bold, quote, headings later) need
an entry point that does not destroy the selection. Typing `/` over selected
text replaces it with a slash, which is what any editor does and what some
people expect. Options: a dedicated shortcut (one more thing to learn), a
floating toolbar (bigger, visual, still wanted later), or repurposing `/` so
that over a selection it opens the command palette — the same gesture that
already means "do a command here" on an empty line.

Repurposing a keystroke is exactly the kind of change that delights one
person and annoys the next. Eddie is a personal editor, but it is also meant
to be extended by agents over many sessions, and each session will be
tempted to add its own clever default.

## Decision

1. `/` typed over a non-empty selection opens the command palette with the
   selection intact. Commands registered with `selection: true` sort first.
   Escape closes the palette and leaves the document untouched. Typing a
   literal slash over a selection means deleting the selection first.
2. **Every editing behavior is configurable.** Anything that changes what a
   keystroke or gesture does gets a key under `CONFIG_DEFAULTS` whose
   non-default value restores the previous behavior, documented in the
   README's Configuration section. For this change:
   `"commands": {"slashOnSelection": "palette" | "text"}`.

## Consequences

- One gesture (`/`) covers "insert something here" and "do something with
  this"; no new shortcut to learn, and the future floating toolbar can render
  the same `selection: true` commands as buttons.
- Agents adding behavior have a rule to follow instead of a judgment call:
  new behavior is fine, but the old behavior must remain one config line
  away. This costs a config key and a README line per behavior.
- Config stays the single place a human looks to make Eddie feel the way
  they want; `.eddie.json` makes it per project like everything else
  (ADR-0005).
