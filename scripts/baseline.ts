/**
 * Builds the committed baseline gallery by going through the deployed API.
 *
 * Every spec in examples/specs is POSTed to a running GraphUnslopify, the
 * script that comes back is written to examples/generated, and it is run to
 * produce examples/baseline. Both the code and the images are committed, so a
 * change to the emitter shows up as a reviewable diff instead of a surprise.
 *
 *   node scripts/baseline.ts                          # against production
 *   node scripts/baseline.ts http://localhost:3999    # against a local server
 *   PYTHON=/path/to/python node scripts/baseline.ts   # pick the interpreter
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const base = (process.argv[2] ?? "https://json-translator-three.vercel.app").replace(/\/$/, "");
const python = process.env.PYTHON ?? "python";

const root = join(import.meta.dirname, "..");
const specDir = join(root, "examples", "specs");
const codeDir = join(root, "examples", "generated");
const imageDir = join(root, "examples", "baseline");
const workDir = join(root, "examples");

mkdirSync(codeDir, { recursive: true });
mkdirSync(imageDir, { recursive: true });

const names = readdirSync(specDir)
  .filter((f) => f.endsWith(".json"))
  .sort();

let failures = 0;
const summary: string[] = [];

console.log(`api:    ${base}`);
console.log(`python: ${python}\n`);

for (const file of names) {
  const name = file.replace(/\.json$/, "");
  const spec = JSON.parse(readFileSync(join(specDir, file), "utf8"));

  const response = await fetch(`${base}/api/convert`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(spec),
  });
  const result = await response.json();

  if (result.status !== "translated") {
    console.log(`FAIL  ${name}  spec rejected: ${JSON.stringify(result.issues)}`);
    failures += 1;
    continue;
  }

  writeFileSync(join(codeDir, `${name}.py`), result.code);

  try {
    execFileSync(python, [join(codeDir, `${name}.py`)], {
      cwd: workDir,
      stdio: "pipe",
      encoding: "utf8",
    });
  } catch (error) {
    const detail = (error as { stderr?: string }).stderr ?? String(error);
    console.log(`FAIL  ${name}  ${detail.trim().split("\n").slice(-2).join(" | ")}`);
    failures += 1;
    continue;
  }

  const notes = result.findings.length
    ? result.findings.map((f: { severity: string; code: string }) => `${f.severity}:${f.code}`).join(" ")
    : "clean";
  console.log(`PASS  ${name}  ${notes}`);
  summary.push(`| \`${name}\` | ${spec.kind} | ${notes} |`);
}

// The scripts write beside the data they read, so collect the images afterwards.
for (const file of readdirSync(workDir).filter((f) => f.endsWith(".png") || f.endsWith(".svg") || f.endsWith(".pdf"))) {
  const from = join(workDir, file);
  writeFileSync(join(imageDir, file), readFileSync(from));
  execFileSync(process.execPath, ["-e", `require("node:fs").unlinkSync(${JSON.stringify(from)})`]);
}

writeFileSync(
  join(imageDir, "README.md"),
  [
    "# Baseline gallery",
    "",
    `Rendered from \`examples/specs\` through ${base}.`,
    "Regenerate with `node scripts/baseline.ts`, then look at the image diff.",
    "",
    "| Spec | Kind | Findings |",
    "| --- | --- | --- |",
    ...summary,
    "",
  ].join("\n"),
);

console.log(
  failures === 0
    ? `\nall ${names.length} baselines built`
    : `\n${failures} of ${names.length} failed`,
);
process.exitCode = failures === 0 ? 0 : 1;
