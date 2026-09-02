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
