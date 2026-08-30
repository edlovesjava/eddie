# ADR-0004: Plugins are single plain-JS files against a stable `window.eddie` API

- **Status:** accepted
- **Date:** 2026-08-28

## Context

Eddie must be easily extensible by its owner (and by agents writing
extensions on the owner's behalf). Options: npm-package plugins with a build
step and manifest, iframe-sandboxed plugins, or plain scripts.

## Decision

A plugin is one `.js` file dropped in `~/.eddie/plugins/` (user) or
`plugins/` (built-in), loaded as a script tag on page load. Plugins program
against the global `window.eddie` API, which changes additively only.
No manifest, no build, no sandbox — plugins are trusted code chosen by the
owner. Reload the tab to pick up changes.

## Consequences

- The write-a-plugin loop is minutes, for humans and agents alike; an agent
  can extend the editor by writing one file over the file API.
- No isolation: a broken plugin can break the page (acceptable — personal
  tool, trusted sources).
- The additive-only rule constrains refactors of `window.eddie`.
