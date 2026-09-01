# Architecture Decision Records

Numbered, append-only. A decision is changed by a new ADR that supersedes the
old one, never by editing history. Add one whenever a significant choice is
made (new dependency, subsystem, protocol, changed default). Use
[template.md](template.md).

| # | Decision | Status |
|---|---|---|
| [0001](0001-local-server-plus-browser.md) | Local dependency-free server + browser frontend + thin CLI | accepted |
| [0002](0002-codemirror6-esbuild.md) | CodeMirror 6 for editing, esbuild for bundling | accepted |
| [0003](0003-open-localhost-api.md) | The localhost JSON API is the single interface — UI, plugins, agents are peers | accepted |
| [0004](0004-plugins-plain-js.md) | Plugins are single plain-JS files against a stable `window.eddie` API | accepted |
| [0005](0005-walk-up-config-resolution.md) | Configs resolve by walking up from the edited file, with a `~/.eddie` global fallback | accepted |
| [0006](0006-policy-auto-ask-never.md) | Behavior policy per action: auto / ask / never, `never` enforced server-side | accepted |
| [0007](0007-panels-as-composition-unit.md) | Features compose as panels | accepted |
| [0008](0008-ai-via-local-cli.md) | AI features shell out to a local CLI (`claude -p`), no API keys | accepted |
| [0009](0009-feature-branch-workflow.md) | Feature-branch workflow; `main` is merged to after review | accepted |
| [0010](0010-trace-log-substrate.md) | The trace log is the substrate; the event bus is its tail | accepted |
| [0011](0011-anchored-recommendations.md) | Recommendations are annotations — anchored by content, not coordinates | accepted |
| [0012](0012-proposals-and-decisions.md) | Mutations offered by rules/AI are proposals — patch, decision, applied action | accepted |
| [0013](0013-transform-registry.md) | Deterministic transforms are a registered capability; AI-created ones join the registry with provenance | accepted |
