# ADR-0002: CodeMirror 6 for editing, esbuild for bundling

- **Status:** accepted
- **Date:** 2026-08-28

## Context

The editor needs solid Markdown/JSON/shell editing, linting hooks, and
keyboard-driven UX in the browser. Options: textarea + libraries, Monaco
(VS Code's editor), CodeMirror 6.

## Decision

CodeMirror 6 (modular, small, first-class lint/keymap/extension model) with
`@codemirror/legacy-modes` for the long-tail languages. esbuild bundles
`web/src/main.js` to `web/dist/app.js`; the `prepare` npm script builds on
install so a fresh clone works with `npm install` alone. The bundle is never
committed.

## Consequences

- Lint, keymaps, themes, and language modes ride on CM6's extension system —
  our lint framework is a thin adapter over `@codemirror/lint`.
- Monaco-grade IDE features (LSP, minimap) would be more work; acceptable —
  Eddie is a markup editor, not an IDE.
- One build step exists, but it's sub-second and automated; plugins remain
  build-free (ADR-0004).
