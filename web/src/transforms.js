// Built-in transforms — pure, deterministic text rewrites (ADR-0013).
// Contract: (text, ctx) => newText | null, where `text` is the targeted
// slice (selection, paragraph, or whole document), null means "not
// applicable / nothing to change", and ctx = {path, language, scope,
// params}. No network, no LLM, no randomness. See docs/design/transforms.md.

// Renumber ordered lists sequentially, per indent level. Each (sub)list
// keeps its own starting number, so zero-based and offset lists survive.
// Fenced code blocks are left alone; unindented non-list text ends a list.
function renumberLists(text) {
  const lines = text.split("\n");
  const counters = []; // stack: {indent, n}
  const out = [];
  let changed = false;
  let inFence = false;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      counters.length = 0;
      out.push(line);
      continue;
    }
    const m = !inFence && line.match(/^(\s*)(\d+)([.)])(\s+)(.*)$/);
    if (!m) {
      if (line.trim() !== "" && !/^\s/.test(line)) counters.length = 0;
      out.push(line);
      continue;
    }
    const indent = m[1].length;
    while (counters.length && counters[counters.length - 1].indent > indent) counters.pop();
    let top = counters[counters.length - 1];
    if (!top || top.indent < indent) {
      top = { indent, n: parseInt(m[2], 10) };
      counters.push(top);
    } else {
      top.n += 1;
    }
    const want = String(top.n);
    if (want !== m[2]) changed = true;
    out.push(m[1] + want + m[3] + m[4] + m[5]);
  }
  return changed ? out.join("\n") : null;
}

const ITEM_START = /^([-*+]|\d+[.)])\s+/;

// Sort a run of list items alphabetically by their first-line text; nested
// blocks and continuation lines travel with their parent item. A numbered
// list is renumbered after sorting. params: order=desc reverses.
function sortList(text, ctx) {
  const order = ctx.params && ctx.params.order === "desc" ? -1 : 1;
  const lines = text.split("\n");
  const tail = [];
  while (lines.length && lines[lines.length - 1].trim() === "") tail.unshift(lines.pop());
  const first = lines.findIndex((l) => ITEM_START.test(l.replace(/^\s*/, "")));
  if (first === -1) return null;
  const indent = lines[first].match(/^(\s*)/)[1];
  const isStart = (l) => l.startsWith(indent) && ITEM_START.test(l.slice(indent.length));
  const head = lines.slice(0, first);
  const items = [];
  let cur = null;
  for (const l of lines.slice(first)) {
    if (isStart(l)) {
      cur = [l];
      items.push(cur);
    } else if (cur) {
      cur.push(l);
    }
  }
  const key = (item) => item[0].slice(indent.length).replace(ITEM_START, "").toLowerCase();
  const sorted = [...items].sort((a, b) => order * key(a).localeCompare(key(b)));
  if (/^\d/.test(sorted[0][0].slice(indent.length))) {
    // A sorted numbered list restarts from the run's smallest number (the
    // sort landed an arbitrary number first); renumber does the rest.
    const start = Math.min(...items.map((it) => parseInt(it[0].slice(indent.length), 10)));
    sorted[0] = [sorted[0][0].replace(/^(\s*)\d+/, `$1${start}`), ...sorted[0].slice(1)];
  }
  let result = [...head, ...sorted.flat(), ...tail].join("\n");
  if (/^\d/.test(sorted[0][0].slice(indent.length))) result = renumberLists(result) ?? result;
  return result === text ? null : result;
}

// Rewrap one paragraph block to the given width. Structural blocks
// (headings, tables, HTML, fences) pass through untouched; list items and
// blockquotes keep their marker with a hanging indent.
function reflowBlock(block, width) {
  const firstLine = block[0];
  if (/^\s*(#|```|~~~|\||<)/.test(firstLine)) return block;
  const lm = firstLine.match(/^(\s*)([-*+]\s+|\d+[.)]\s+|>\s?)?/);
  const lead = lm[0];
  const hang = lm[2] && !lm[2].startsWith(">") ? lm[1] + " ".repeat(lm[2].length) : lead;
  const words = block
    .map((l, i) => (i === 0 ? l.slice(lead.length) : l.replace(/^\s*(>\s?)?/, "")))
    .join(" ")
    .split(/\s+/)
    .filter(Boolean);
  const out = [];
  let cur = lead;
  let empty = true;
  for (const w of words) {
    if (!empty && cur.length + 1 + w.length > width) {
      out.push(cur);
      cur = hang + w;
    } else {
      cur += (empty ? "" : " ") + w;
      empty = false;
    }
  }
  out.push(cur);
  return out;
}

// Reflow prose to a column width (params: width=80). Blank lines, fences,
// and structural blocks are preserved verbatim; each list item reflows as
// its own block.
function reflow(text, ctx) {
  const width = Math.max(20, parseInt((ctx.params && ctx.params.width) || "80", 10) || 80);
  const lines = text.split("\n");
  const out = [];
  let block = [];
  let inFence = false;
  const flush = () => {
    if (block.length) out.push(...reflowBlock(block, width));
    block = [];
  };
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      flush();
      inFence = !inFence;
      out.push(line);
      continue;
    }
    if (inFence || line.trim() === "") {
      flush();
      out.push(line);
      continue;
    }
    if (block.length && /^\s*([-*+]\s+|\d+[.)]\s+|#)/.test(line)) flush();
    block.push(line);
  }
  flush();
  const result = out.join("\n");
  return result === text ? null : result;
}

export const builtinTransforms = [
  ["renumber-list", renumberLists, {
    title: "Renumber ordered lists",
    description: "Make ordered-list numbering sequential, per indent level",
    languages: ["markdown"],
    rules: ["MD029"],
    origin: "builtin",
    scope: "doc", // renumbering only makes sense whole-document
  }],
  ["sort-list", sortList, {
    title: "Sort list items",
    description: "Sort a list alphabetically (order=desc to reverse); nested blocks follow their item",
    languages: ["markdown"],
    origin: "builtin",
  }],
  ["reflow", reflow, {
    title: "Reflow paragraphs",
    description: "Rewrap prose to width=80 columns, preserving list markers and quotes",
    languages: ["markdown", "text"],
    origin: "builtin",
  }],
];
