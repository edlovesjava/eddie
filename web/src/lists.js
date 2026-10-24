// Pure list toggling for the /list command. Kinds: "-" bullet, "1" numbered,
// "[]" checklist. Operates on a block of lines; blank lines are left alone.

// Leading indent, an optional existing list marker, and the rest of the line.
const LINE = /^(\s*)(?:([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?)?(.*)$/;

export function listKind(args) {
  const a = (args || "").trim().toLowerCase();
  if (/^(1\.?|n|num|number|numbered|ol)$/.test(a)) return "1";
  if (/^(\[\s?\]|check|checklist|todo|task)$/.test(a)) return "[]";
  return "-";
}

function parse(line) {
  const [, indent, marker, box, rest] = LINE.exec(line);
  const kind = !marker ? null : box ? "[]" : /^\d/.test(marker) ? "1" : "-";
  return { indent, kind, checked: /x/i.test(box || ""), rest };
}

export function toggleList(text, kind) {
  const lines = text.split("\n").map(parse);
  const live = lines.filter((l) => l.rest.trim() !== "");
  const remove = live.length > 0 && live.every((l) => l.kind === kind);
  // A block with no content (e.g. /list on an empty line) starts a list.
  const skipBlank = live.length > 0;
  let n = 0;
  return lines
    .map((l) => {
      if (skipBlank && l.rest.trim() === "") return l.indent + l.rest;
      if (remove) return l.indent + l.rest;
      if (kind === "1") return `${l.indent}${++n}. ${l.rest}`;
      if (kind === "[]") return `${l.indent}- [${l.checked ? "x" : " "}] ${l.rest}`;
      return `${l.indent}- ${l.rest}`;
    })
    .join("\n");
}
