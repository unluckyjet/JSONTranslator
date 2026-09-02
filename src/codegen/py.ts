/** Emitting Python literals from TypeScript values. */

/** JSON string escaping is a subset of Python's, so this is safe for labels. */
export function pyStr(value: string): string {
  return JSON.stringify(value);
}

export function pyOptStr(value: string | undefined): string {
  return value === undefined ? "None" : pyStr(value);
}

export function pyBool(value: boolean): string {
  return value ? "True" : "False";
}

export function pyNum(value: number): string {
  return Number.isFinite(value) ? String(value) : "float('nan')";
}

export function pyValue(value: unknown): string {
  if (value === null || value === undefined) return "None";
  if (typeof value === "string") return pyStr(value);
  if (typeof value === "boolean") return pyBool(value);
  if (typeof value === "number") return pyNum(value);
  if (Array.isArray(value)) return `[${value.map(pyValue).join(", ")}]`;
  return pyStr(JSON.stringify(value));
}

export function pyList(values: readonly unknown[]): string {
  return `[${values.map(pyValue).join(", ")}]`;
}

/** A block of Python indented to sit inside a function body. */
export function indent(lines: string[], level = 1): string[] {
  const pad = "    ".repeat(level);
  return lines.map((line) => (line.length ? pad + line : line));
}
