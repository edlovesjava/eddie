# Eddie plugins

A plugin is a single `.js` file loaded into the editor page after the app
starts. Eddie loads plugins from two places:

- `~/.eddie/plugins/*.js` — your personal plugins
- `plugins/*.js` in this repo — built-ins shipped with Eddie

No build step, no manifest — drop a file in, reload the tab.

## The `eddie` API

Plugins use the global `window.eddie` object:

| Call | What it does |
|---|---|
| `eddie.getText()` / `eddie.setText(s)` | read / replace the document |
| `eddie.getPath()` / `eddie.getLanguage()` | current file path / language id |
| `eddie.save()` | save the current file |
| `eddie.openFile(path)` | open another file in this tab |
| `eddie.setStatus(msg)` | flash a message in the status bar |
| `eddie.registerFormatter(lang, name, fn)` | make the Format button work for a language; `fn(text, {path})` returns the formatted text (may be async) |
| `eddie.onSave(fn)` | run `fn(text, {path, language})` before every save; return a string to rewrite the content being saved |
| `eddie.addToolbarButton(label, title, onClick)` | add a button to the top bar |
| `eddie.addStatusItem(text)` | add a status-bar item; returns the element |
| `eddie.api(method, url, body)` | call the Eddie server API (see docs/AGENTS.md) |

Language ids: `markdown`, `json`, `shell`, `yaml`, `javascript`, `css`, `html`, `text`.

## Examples

Trim trailing whitespace on every save of a markdown file:

```js
eddie.onSave((text, { language }) =>
  language === "markdown" ? text.replace(/[ \t]+$/gm, "") : undefined
);
```

A shell formatter that just normalizes line endings:

```js
eddie.registerFormatter("shell", "crlf-fix", (text) => text.replace(/\r\n/g, "\n"));
```

Insert a date-stamped heading from a toolbar button:

```js
eddie.addToolbarButton("Today", "Insert today's heading", () => {
  eddie.setText(`# ${new Date().toISOString().slice(0, 10)}\n\n` + eddie.getText());
});
```
