// Path helpers for the frontend. The server reports paths in the host OS's
// native form (backslashes on Windows), so everything here accepts either
// separator. Markdown links always use forward slashes.

const SEP = /[\\/]/;

export function toPosix(p) {
  return p.replace(/\\/g, "/");
}

// Parent directory, preserving the input's separator style so the result can
// be handed straight back to the server. Root-level files return the root
// itself ("/" or "C:\").
export function dirname(p) {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  if (i < 0) return p;
  const head = p.slice(0, i);
  return /^[A-Za-z]:$/.test(head) || head === "" ? p.slice(0, i + 1) : head;
}

export function basename(p) {
  return p.split(SEP).pop();
}

// Drive letter ("c") for a Windows path, "" for posix.
function drive(p) {
  const m = /^([A-Za-z]):/.exec(p);
  return m ? m[1].toLowerCase() : "";
}

function segments(p) {
  return toPosix(p).replace(/^[A-Za-z]:/, "").split("/").filter(Boolean);
}

// href for a markdown link from `fromFile` to `target`: relative when both
// live on the same drive, otherwise (or with no current file) absolute.
export function linkHref(fromFile, target) {
  if (!fromFile || drive(fromFile) !== drive(target)) return toPosix(target);
  const a = segments(dirname(fromFile));
  const b = segments(target);
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return [...Array(a.length - i).fill(".."), ...b.slice(i)].join("/") || ".";
}
