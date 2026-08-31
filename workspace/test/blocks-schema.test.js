import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeRich,
  richToPlainText,
  normalizeBlockContent,
  normalizeBlockProps,
  safeUrl,
  isBlockType,
  blockSpec,
} from "../src/shared/blocks.js";

test("normalizeRich drops unknown marks and empty spans", () => {
  const rich = normalizeRich([
    { s: "hello ", m: ["b", "evil"] },
    { s: "" },
    { s: "world", m: ["i"] },
  ]);
  assert.deepEqual(rich, [{ s: "hello ", m: ["b"] }, { s: "world", m: ["i"] }]);
});

test("normalizeRich merges adjacent spans with identical formatting", () => {
  const rich = normalizeRich([{ s: "a", m: ["b"] }, { s: "b", m: ["b"] }, { s: "c" }]);
  assert.deepEqual(rich, [{ s: "ab", m: ["b"] }, { s: "c" }]);
});

test("normalizeRich accepts a bare string", () => {
  assert.deepEqual(normalizeRich("plain"), [{ s: "plain" }]);
});

test("javascript: and data: links are rejected", () => {
  assert.equal(safeUrl("javascript:alert(1)"), null);
  assert.equal(safeUrl("data:text/html;base64,PHN2Zz4="), null);
  assert.equal(safeUrl("https://example.com/x"), "https://example.com/x");
  const rich = normalizeRich([{ s: "click", href: "javascript:alert(1)" }]);
  assert.equal(rich[0].href, undefined);
});

test("richToPlainText mirrors the searchable text", () => {
  assert.equal(richToPlainText([{ s: "abc" }, { s: "def", m: ["b"] }]), "abcdef");
});

test("normalizeBlockContent strips fields the client should not control", () => {
  const { content } = normalizeBlockContent("paragraph", {
    rich: [{ s: "hi" }],
    workspace_id: "spoofed",
    isAdmin: true,
  });
  assert.deepEqual(content, { rich: [{ s: "hi" }] });
});

test("checklist and toggle keep their state flags", () => {
  assert.equal(normalizeBlockContent("checklist", { checked: true }).content.checked, true);
  assert.equal(normalizeBlockContent("toggle", { expanded: false }).content.expanded, false);
  assert.equal(normalizeBlockContent("toggle", {}).content.expanded, true);
});

test("code block plain text is the code itself", () => {
  const { content, plainText } = normalizeBlockContent("code", {
    text: "const a = 1;",
    language: "js",
  });
  assert.equal(content.language, "js");
  assert.equal(plainText, "const a = 1;");
});

test("unsupported block preserves the original payload", () => {
  const { content } = normalizeBlockContent("unsupported", {
    originalType: "notion:synced_block",
    originalPayload: { foo: 1 },
    externalUrl: "https://notion.so/abc",
  });
  assert.equal(content.originalType, "notion:synced_block");
  assert.deepEqual(content.originalPayload, { foo: 1 });
  assert.equal(content.externalUrl, "https://notion.so/abc");
});

test("unknown block types fall back to the unsupported spec", () => {
  assert.equal(isBlockType("nope"), false);
  assert.equal(blockSpec("nope").group, "system");
});

test("normalizeBlockProps only keeps known visual props", () => {
  assert.deepEqual(
    normalizeBlockProps({ color: "blue", align: "middle", onclick: "x", background: "nope" }),
    { color: "blue" },
  );
});
