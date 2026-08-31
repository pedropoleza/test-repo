import test from "node:test";
import assert from "node:assert/strict";
import { keyBetween, keysBetween, firstKey } from "../src/workspace/shared/fracdex.js";

test("first key on an empty list", () => {
  const k = firstKey();
  assert.ok(k.length > 0);
});

test("appending keeps ascending order", () => {
  let prev = null;
  const keys = [];
  for (let i = 0; i < 200; i += 1) {
    prev = keyBetween(prev, null);
    keys.push(prev);
  }
  assert.deepEqual(keys, [...keys].sort());
});

test("prepending keeps ascending order", () => {
  let next = null;
  const keys = [];
  for (let i = 0; i < 200; i += 1) {
    next = keyBetween(null, next);
    keys.unshift(next);
  }
  assert.deepEqual(keys, [...keys].sort());
});

test("repeated insertion between two neighbours stays strictly between", () => {
  let lo = keyBetween(null, null);
  let hi = keyBetween(lo, null);
  for (let i = 0; i < 500; i += 1) {
    const mid = keyBetween(lo, hi);
    assert.ok(lo < mid, `${lo} < ${mid}`);
    assert.ok(mid < hi, `${mid} < ${hi}`);
    // alterna o lado para exercitar os dois caminhos do algoritmo
    if (i % 2 === 0) lo = mid;
    else hi = mid;
  }
});

test("keysBetween produces `count` ordered keys inside the bounds", () => {
  const lo = keyBetween(null, null);
  const hi = keyBetween(lo, null);
  const keys = keysBetween(lo, hi, 10);
  assert.equal(keys.length, 10);
  assert.deepEqual(keys, [...keys].sort());
  assert.ok(lo < keys[0]);
  assert.ok(keys[9] < hi);
});

test("rejects out-of-order bounds", () => {
  assert.throws(() => keyBetween("b", "a"));
  assert.throws(() => keyBetween("a", "a"));
});

test("rejects keys outside the alphabet", () => {
  assert.throws(() => keyBetween("!!", null));
});
