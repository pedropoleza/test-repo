import test from "node:test";
import assert from "node:assert/strict";
import { splitRich } from "../src/workspace/editor/richtext.js";

test("splitting at a span boundary keeps both sides intact", () => {
  const [before, after] = splitRich([{ s: "abc" }, { s: "def", m: ["b"] }], 3);
  assert.deepEqual(before, [{ s: "abc" }]);
  assert.deepEqual(after, [{ s: "def", m: ["b"] }]);
});

test("splitting inside a span preserves its formatting on both halves", () => {
  const [before, after] = splitRich([{ s: "hello world", m: ["i"] }], 5);
  assert.deepEqual(before, [{ s: "hello", m: ["i"] }]);
  assert.deepEqual(after, [{ s: " world", m: ["i"] }]);
});

test("splitting at the start leaves an empty first half", () => {
  const [before, after] = splitRich([{ s: "abc" }], 0);
  assert.deepEqual(before, []);
  assert.deepEqual(after, [{ s: "abc" }]);
});

test("splitting past the end leaves an empty second half", () => {
  const [before, after] = splitRich([{ s: "abc" }], 99);
  assert.deepEqual(before, [{ s: "abc" }]);
  assert.deepEqual(after, []);
});

test("links survive a split", () => {
  const [before, after] = splitRich(
    [{ s: "spark", href: "https://example.com" }],
    2,
  );
  assert.equal(before[0].href, "https://example.com");
  assert.equal(after[0].href, "https://example.com");
});
