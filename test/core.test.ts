import { test } from "node:test";
import assert from "node:assert/strict";
import { ACK_MESSAGE, ingest } from "../src/core.ts";

const AT = new Date("2026-01-01T00:00:00.000Z");

test("object payload is acknowledged with its keys", () => {
  const result = ingest({ kind: "line", x: [1, 2], y: [3, 4] }, AT);
  assert.equal(result.ok, true);
  assert.equal(result.message, ACK_MESSAGE);
  assert.deepEqual(result.shape, { kind: "object", keys: ["kind", "x", "y"] });
  assert.equal(result.receivedAt, "2026-01-01T00:00:00.000Z");
});

test("array payload reports its length", () => {
  const result = ingest([1, 2, 3], AT);
  assert.equal(result.ok, true);
  assert.deepEqual(result.shape, { kind: "array", length: 3 });
});

test("a JSON-encoded string is parsed rather than rejected", () => {
  const result = ingest('{"a":1}', AT);
  assert.equal(result.ok, true);
  assert.deepEqual(result.shape, { kind: "object", keys: ["a"] });
});

test("a non-JSON string is rejected", () => {
  const result = ingest("not json", AT);
  assert.equal(result.ok, false);
  assert.equal(result.message, "payload is a string but not valid JSON");
});

test("a missing payload is rejected", () => {
  const result = ingest(undefined, AT);
  assert.equal(result.ok, false);
  assert.equal(result.message, "payload is required");
});

test("null is a valid payload", () => {
  const result = ingest(null, AT);
  assert.equal(result.ok, true);
  assert.deepEqual(result.shape, { kind: "null" });
});

test("a circular payload is rejected instead of throwing", () => {
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  const result = ingest(circular, AT);
  assert.equal(result.ok, false);
  assert.equal(result.message, "payload is not JSON-serializable");
});
