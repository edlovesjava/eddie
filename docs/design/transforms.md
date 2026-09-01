# Transforms — deterministic edits as a named, growable capability

## Intent (the human's words)

> for the standard lint fixes like renumbering, do we have script we can run
> to do the fix if it doesn't require an LLM call? For instance common
> transformation scripts that can be applied. Perhaps we can design, and if
> ai creates a script that can be reused then we should have a registry for
> it

Two asks in one: mechanical edits should not cost an LLM call, and when the
AI *does* solve something mechanical, the solution should be kept — named,
reusable, and instant the next time.

## What already exists

- **✦ fix** (ADR-0012) is deterministic: markdownlint ships machine-readable
  `fixInfo` with many rules — MD029 ordered-list renumbering included — and
  eddie applies it locally, no AI. The gap is granularity: one issue, one
  click. Renumbering a 12-item list is twelve clicks.
- markdownlint also exports `applyFixes(text, errors)` — every deterministic
  fix in the document in one pass. We bundle it already; nothing calls it.
- **Formatters** (`eddie.registerFormatter`) are whole-document transforms
  in all but name. **Commands** like `/table` are generators (they produce
  new text), not transforms (they rewrite existing text).
- **✦ ask eddie** / `/ai` cover everything else — at the cost of a 5–20s
  CLI round trip, per use, forever, even when the answer is mechanical.

## The transform contract

A **transform** is a pure function over text:

```js
(text, ctx) => newText | null   // ctx: {path, language, range?, params?}
```

- **Deterministic**: same input, same output. No network, no LLM, no
  randomness, no clock. This is the contract that makes a transform free to
  run, safe to auto-apply under policy, and honest in the registry.
- `null` means "not applicable here" (e.g. a list renumberer given prose).
- `range` scopes it to a selection/paragraph when the surface provides one;
  a transform that only makes sense whole-document ignores it.

Metadata carried at registration:

```js
eddie.registerTransform("renumber-list", fn, {
  title: "Renumber ordered lists",
  description: "Rewrites ordered-list markers to be sequential",
  languages: ["markdown"],
  rules: ["MD029"],          // lint rules this transform remedies (optional)
  origin: "builtin",         // builtin | user | ai
  provenance: null,          // trace record id that created it (ai origin)
});
```

## Registration and storage

The fourth member of an existing family (`registerCommand`,
`registerLinter`, `registerFormatter`) — same plugin substrate (ADR-0004):

- **Built-ins** ship with eddie (core or `plugins/`).
- **User and AI-created** transforms are single plain-JS files in
  `~/.eddie/transforms/`, loaded like plugins at startup, each calling
  `registerTransform`. A separate directory (not `plugins/`) keeps the
  registry browsable as a thing: `ls ~/.eddie/transforms/` *is* your
  collection.
- AI-created files carry provenance in a comment header (created-by run id,
  date, the original ask) and in the registration metadata — the registry
  can always answer "where did this come from?"

## Invocation — three doors

1. **`/fixall`** — the special case that needs no registry: run
   markdownlint's `applyFixes` over the current diagnostics and present the
   result as **one proposal diff** (ADR-0012 card — red/green, Apply).
   Whole-list renumbering, trailing spaces, heading spacing in one Apply,
   zero LLM calls. Also a button in the Lint panel.
2. **`/apply <name>`** — inline or from the palette (which lists every
   registered transform with its description). Targets the selection, else
   the paragraph at the cursor, else the whole document — same targeting
   ladder as `/ai`.
3. **Lint actions** — a transform declaring `rules: ["MD029"]` appears as a
   ✦ action on matching diagnostics, exactly where ✦ fix sits. The
   deterministic path grows to cover more rules without touching core.
4. **`POST /api/transform {name, path, quote?, params?}`** — agents invoke
   by name. Output goes through the proposal machinery.

**Who invoked decides how it lands** (consistent with ADR-0006's philosophy
that clicking the button is already explicit): a transform the *human*
invokes (`/apply`, `/fixall` Apply, a lint action click) edits directly or
via one reviewed diff, recorded as an `action` in the trace; a transform a
*machine* proposes (agent API call, a rule producer, future automations)
lands as a proposal awaiting decision.

## The promotion path — AI-created transforms

When an AI edit run completes and the change looks mechanical, eddie offers:
*"this looks like a reusable transform — save it?"* Accepting runs the flow:

1. The AI CLI is asked to write a JS function meeting the contract, given
   the before/after pair and the original ask.
2. **Self-test gate**: the generated function is executed against the
   original input; its output must exactly reproduce the accepted
   replacement. No match, no save — a transform that can't reproduce the
   case that birthed it is not deterministic-in-spirit.
3. The file is written to `~/.eddie/transforms/` with provenance, a
   `lesson`-adjacent trace record links run → transform, and the registry
   picks it up on reload.

Governed by a new policy key `ai.createTransform` (`ask` default, `never`
refused server-side per ADR-0006). The generated file is plain JS you can
open *in eddie* and read before it ever runs — the same trust model as
plugins, plus the self-test gate and an audit trail plugins don't have.

## Provenance, usage, and the learning loop

Every transform run is an `action` record (`subtype: transform.applied`)
with a cause chain; 👍/👎 and observed reverts attach as outcomes. That
gives the registry live columns for free: origin, provenance, run count,
last used, acceptance. And it is exactly the substrate **repetition
analysis** (ai-integration §9, phase 4.5) needs: "you've applied
`renumber-list` to this file 9 times this week — want a save-hook
automation?" A transform is a concrete *remedy object* the reflection agent
can propose, alongside commands, automations, and config changes.

## Registry surface

- `GET /api/transforms` → name, metadata, origin, provenance, usage stats.
- The palette lists transforms under `/apply`.
- A small registry panel (ADR-0007) later, if browsing outgrows the palette.

## Sequencing

1. **`/fixall`** — immediate value, no design risk, proves the one-diff UX.
2. **Registry core** — `registerTransform`, `~/.eddie/transforms/` loading,
   `/apply`, `GET /api/transforms`, two or three built-ins (renumber-list,
   reflow-paragraph, sort-list). ADR-0013 lands here.
3. **Rule-mapped lint actions** (`rules:` metadata → ✦ buttons).
4. **AI promotion flow** with the self-test gate and `ai.createTransform`.
5. **Repetition tie-in** — arrives with phase 4.5, not before.

## Deliberately deferred

- Parameterized transforms beyond a simple `params` bag (`/apply sort-list
  order=desc` works; a params UI does not exist yet).
- Multi-file transforms (out of scope until a real need).
- Versioning beyond the file itself (personal scale; git the `~/.eddie`
  directory if history matters).
- Folding formatters into transforms (they are the same shape; unify when
  touching that code anyway, not as a project).
