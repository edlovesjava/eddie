import test from "node:test";
import assert from "node:assert/strict";
import { listKind, toggleList } from "./lists.js";

test("listKind maps the /list argument to a marker kind", () => {
  assert.equal(listKind(""), "-");
  assert.equal(listKind("1"), "1");
  assert.equal(listKind("1."), "1");
  assert.equal(listKind("[]"), "[]");
  assert.equal(listKind("[ ]"), "[]");
});

test("toggleList bullets plain lines", () => {
  assert.equal(toggleList("one\ntwo", "-"), "- one\n- two");
});

test("toggleList leaves blank lines alone", () => {
  assert.equal(toggleList("one\n\ntwo", "-"), "- one\n\n- two");
});

test("toggleList starts a list on an empty line", () => {
  assert.equal(toggleList("", "-"), "- ");
  assert.equal(toggleList("", "1"), "1. ");
  assert.equal(toggleList("", "[]"), "- [ ] ");
});

test("toggleList preserves indentation", () => {
  assert.equal(toggleList("  one\n  two", "-"), "  - one\n  - two");
});

test("toggleList removes bullets when every line already has one", () => {
  assert.equal(toggleList("- one\n- two", "-"), "one\ntwo");
  assert.equal(toggleList("* one\n* two", "-"), "one\ntwo");
});

test("toggleList bullets the rest when only some lines are bulleted", () => {
  assert.equal(toggleList("- one\ntwo", "-"), "- one\n- two");
});

test("toggleList numbers lines sequentially", () => {
  assert.equal(toggleList("one\ntwo\nthree", "1"), "1. one\n2. two\n3. three");
});

test("toggleList converts between list kinds instead of stacking markers", () => {
  assert.equal(toggleList("- one\n- two", "1"), "1. one\n2. two");
  assert.equal(toggleList("1. one\n2. two", "-"), "- one\n- two");
  assert.equal(toggleList("- one", "[]"), "- [ ] one");
});

test("toggleList removes numbering when every line is numbered", () => {
  assert.equal(toggleList("1. one\n2. two", "1"), "one\ntwo");
});

test("toggleList makes a checklist and keeps checked state when converting", () => {
  assert.equal(toggleList("one\ntwo", "[]"), "- [ ] one\n- [ ] two");
  assert.equal(toggleList("- [x] one\n- [ ] two", "-"), "- one\n- two");
});

test("toggleList removes checklist markers when every line is a checklist item", () => {
  assert.equal(toggleList("- [ ] one\n- [x] two", "[]"), "one\ntwo");
});
