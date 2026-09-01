# CLAUDE.md — working on eddie

Eddie is Ed's personal browser-based markup editor. Most code here is written
by agents under human direction; this file is the default posture for any
Claude session working in this repo.

## What we're optimizing for, in order

1. **Ease human burden.** Eddie exists to reduce cognitive load in everyday
   editing tasks. Every feature should remove a step, a decision, or a
   context switch — if it adds ceremony, it's wrong for this project.
2. **Architectural consistency.** The codebase must stay easy to understand
   and easy to extend with new features. Prefer the existing extension
   points over new mechanisms; prefer boring over clever.
3. **Agentic development, human intent.** Code is mostly agent-written. The
   human expresses intent and guidance (and occasionally hand-codes);
   documents in this repo — this file, the architecture guide, the ADRs —
   are how that intent stays legible across sessions.

## Before you build

- Read `docs/ARCHITECTURE.md` for the system map, extension points, and
  invariants. New features almost always land as a **panel, command,
  linter, formatter, save hook, or API endpoint** — check the "adding a
  feature" checklist there before inventing a new mechanism.
- Check `docs/adr/` for decisions already made. Don't silently relitigate
  one; if a decision needs to change, write a superseding ADR and say so.
- **When you make a significant choice** (new dependency, new subsystem, new
  protocol/format, changed default behavior), add an ADR — short, numbered,
  from `docs/adr/template.md`.

## Workflow

- **Feature branches, always** (ADR-0009). Branch from `main`, named
  `<type>/<topic>` with type one of `feat | fix | docs | chore | refactor`
  (e.g. `feat/outline-panel`). Push the branch; `main` is merged to after
  review. Never commit directly to `main` except trivial doc typo fixes.
- Commits: imperative subject line; body explains what and why. No model
  identifiers in commits.
- Version: bump minor in `package.json` when a user-visible capability
  ships; patch for fixes. Docs-only changes don't bump. After any bump run
  `npm install --package-lock-only` and commit the lockfile too — its
  version fields mirror `package.json`, and a stale lock makes every
  `npm install`/`eddie upgrade` on the user's machine dirty the checkout.

## Quality gates (before every push)

- `node --check server/server.js` and `npm run build` must pass.
- Exercise what you changed for real: `curl` new/changed API endpoints, and
  drive UI changes in headless Chromium (Playwright is the established
  pattern — see the smoke tests in past sessions). Verify the failure path,
  not just the happy path.
- Update the docs the change touches: `README.md` (user-facing),
  `docs/AGENTS.md` (API), `plugins/README.md` (plugin API), and the config
  defaults listed in `/settings` docs.

## Invariants — do not break

- Server binds `127.0.0.1` only and rejects non-localhost `Host` headers.
- `server/server.js` stays dependency-free (plain `node:` modules).
- Policy (`auto | ask | never`) is enforced **server-side** for `never`;
  a new capability that mutates state gets a policy entry.
- The `window.eddie` plugin API is stable: additive changes only.
- Plugins are plain `.js` files — no build step, no manifest.

## Style

- Plain modern JS (Node 18+, `type: commonjs` server, ESM frontend bundled
  by esbuild). No frameworks, no TypeScript, no new runtime dependencies
  without an ADR.
- Match the file you're in: comment density is low and comments state
  constraints, not narration.
