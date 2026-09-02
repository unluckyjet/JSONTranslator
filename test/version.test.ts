import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TOOL_VERSION } from "../src/codegen/theme.ts";

/**
 * Three ecosystems each need their own copy of the version, so the only thing
 * that can keep them together is a check. The committed gallery once claimed
 * 0.5.0 while the emitter stamped 0.6.0 into every script it produced.
 */

const root = join(import.meta.dirname, "..");

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

test("package.json agrees with TOOL_VERSION", () => {
  const pkg: unknown = JSON.parse(read("package.json"));
  assert.ok(pkg !== null && typeof pkg === "object" && "version" in pkg);
  assert.equal(pkg.version, TOOL_VERSION);
});

test("the Python package agrees with TOOL_VERSION", () => {
  const found = /__version__ = "([^"]+)"/.exec(read("python/graphunslopify/__init__.py"));
  assert.ok(found, "python/graphunslopify/__init__.py declares no __version__");
  assert.equal(found[1], TOOL_VERSION);
});

test("pyproject takes its version from the package rather than repeating it", () => {
  const pyproject = read("python/pyproject.toml");
  assert.match(pyproject, /dynamic = \["version"\]/);
  assert.doesNotMatch(pyproject, /^version = "/m);
});
