import { execFileSync } from "node:child_process";

/**
 * The interpreter that runs generated scripts, or undefined when there is none.
 *
 * macOS has shipped without a bare `python` for years, so hardcoding that name
 * made the render checks fail and the syntax tests skip on a machine that had a
 * working Python all along.
 */
export function resolvePython(): string | undefined {
  const candidates = process.env.PYTHON ? [process.env.PYTHON] : ["python3", "python"];
  for (const candidate of candidates) {
    try {
      execFileSync(candidate, ["--version"], { stdio: "ignore" });
      return candidate;
    } catch {
      continue;
    }
  }
  return undefined;
}

/**
 * An interpreter that can actually run a generated script, or undefined.
 *
 * resolvePython only proves a binary answers to --version. A CI runner with
 * system python but no scientific stack passes that and then fails every
 * generated script with ModuleNotFoundError, which is a red build about the
 * runner rather than about the code.
 */
export function resolvePlottingPython(): string | undefined {
  const python = resolvePython();
  if (!python) return undefined;
  try {
    execFileSync(python, ["-c", "import matplotlib, numpy, pandas"], { stdio: "ignore" });
    return python;
  } catch {
    return undefined;
  }
}
