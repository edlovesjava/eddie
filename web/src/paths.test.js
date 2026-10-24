import test from "node:test";
import assert from "node:assert/strict";
import { dirname, basename, linkHref } from "./paths.js";

test("dirname handles posix paths", () => {
  assert.equal(dirname("/Users/ed/notes/todo.md"), "/Users/ed/notes");
  assert.equal(dirname("/todo.md"), "/");
});

test("dirname handles windows backslash paths", () => {
  assert.equal(dirname("C:\\Users\\ed\\notes\\todo.md"), "C:\\Users\\ed\\notes");
  assert.equal(dirname("C:\\todo.md"), "C:\\");
});

test("dirname handles windows forward-slash paths", () => {
  assert.equal(dirname("C:/Users/ed/todo.md"), "C:/Users/ed");
});

test("basename takes the last segment with either separator", () => {
  assert.equal(basename("/Users/ed/todo.md"), "todo.md");
  assert.equal(basename("C:\\Users\\ed\\todo.md"), "todo.md");
});

test("linkHref is relative on posix", () => {
  assert.equal(linkHref("/Users/ed/notes/a.md", "/Users/ed/notes/b.md"), "b.md");
  assert.equal(linkHref("/Users/ed/notes/a.md", "/Users/ed/docs/c.md"), "../docs/c.md");
  assert.equal(linkHref("/Users/ed/a.md", "/Users/ed/notes/sub/d.md"), "notes/sub/d.md");
});

test("linkHref is relative with forward slashes on windows", () => {
  assert.equal(linkHref("C:\\Users\\ed\\notes\\a.md", "C:\\Users\\ed\\notes\\b.md"), "b.md");
  assert.equal(linkHref("C:\\Users\\ed\\notes\\a.md", "C:\\Users\\ed\\docs\\c.md"), "../docs/c.md");
});

test("linkHref ignores drive letter case on windows", () => {
  assert.equal(linkHref("c:\\Users\\ed\\a.md", "C:\\Users\\ed\\b.md"), "b.md");
});

test("linkHref falls back to an absolute forward-slash path across drives", () => {
  assert.equal(linkHref("C:\\Users\\ed\\a.md", "D:\\stuff\\x.md"), "D:/stuff/x.md");
});

test("linkHref falls back to an absolute forward-slash path with no current file", () => {
  assert.equal(linkHref(null, "C:\\Users\\ed\\b.md"), "C:/Users/ed/b.md");
  assert.equal(linkHref(null, "/Users/ed/b.md"), "/Users/ed/b.md");
});
