/**
 * The tail of a failed subprocess, for the check scripts that run generated
 * Python. execFileSync attaches stderr to the thrown error, but only sometimes,
 * so reading it is a question rather than an assertion.
 */
export function failureDetail(error: unknown, lines: number): string {
  const stderr =
    error instanceof Error && "stderr" in error && typeof error.stderr === "string"
      ? error.stderr
      : String(error);
  return stderr.trim().split("\n").slice(-lines).join(" | ");
}
