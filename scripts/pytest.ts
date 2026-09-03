/**
 * Runs the Python suite through the same interpreter resolution the render
 * checks use.
 *
 * The package script named python3 outright. On Windows that name is an App
 * Execution Alias that prints a Microsoft Store advert and exits 49, so the
 * suite never ran there and said nothing about why.
 *
 *   node --experimental-strip-types scripts/pytest.ts [python]
 */

import { spawnSync } from "node:child_process";
import { resolvePython } from "./python.ts";

const python = process.argv[2] ?? resolvePython();
if (!python) {
  console.log("no Python interpreter found; set PYTHON or pass one as the first argument");
  process.exit(1);
}

const result = spawnSync(python, ["-m", "pytest", "python/tests", "-q"], { stdio: "inherit" });
process.exitCode = result.status ?? 1;
