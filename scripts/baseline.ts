/**
 * Builds the committed baseline gallery from the emitter in this working tree.
 *
 * Every spec in examples/specs is translated, the script is written to
 * examples/generated, and it is run to produce examples/baseline. Both the code
 * and the images are committed, so a change to the emitter shows up as a
 * reviewable diff instead of a surprise.
 *
 * Translating locally rather than through a deployment is what keeps the two in
 * step. The gallery once drifted a whole version behind because it recorded
 * whatever happened to be deployed.
 *
 *   node --experimental-strip-types scripts/baseline.ts           # write and render
 *   node --experimental-strip-types scripts/baseline.ts --check   # emitter drift only
 *   PYTHON=/path/to/python node --experimental-strip-types scripts/baseline.ts
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FigureSpec } from "../src/schema.ts";
import { translate } from "../src/translate.ts";

const check = process.argv.includes("--check");
const python = process.env.PYTHON ?? "python3";

const root = join(import.meta.dirname, "..");
const specDir = join(root, "examples", "specs");
const codeDir = join(root, "examples", "generated");
const imageDir = join(root, "examples", "baseline");
const workDir = join(root, "examples");

type Entry = { name: string; kind: string; code: string; notes: string };

function emit(): { entries: Entry[]; failures: number } {
  const entries: Entry[] = [];
  let failures = 0;

  for (const file of readdirSync(specDir).filter((f) => f.endsWith(".json")).sort()) {
    const name = file.replace(/\.json$/, "");
    const raw: unknown = JSON.parse(readFileSync(join(specDir, file), "utf8"));

    const parsed = FigureSpec.safeParse(raw);
    if (!parsed.success) {
      const where = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
      console.log(`FAIL  ${name}  spec rejected: ${where.join("; ")}`);
      failures += 1;
      continue;
    }

    const result = translate(parsed.data);
    if (result.status !== "translated") {
      console.log(`FAIL  ${name}  spec rejected after parse`);
      failures += 1;
      continue;
    }

    const notes = result.findings.length
      ? result.findings.map((f) => `${f.severity}:${f.code}`).join(" ")
      : "clean";
    entries.push({ name, kind: parsed.data.kind, code: result.code, notes });
  }

  return { entries, failures };
}

const { entries, failures: rejected } = emit();
let failures = rejected;

if (check) {
  for (const entry of entries) {
    const path = join(codeDir, `${entry.name}.py`);
    let committed: string;
    try {
      committed = readFileSync(path, "utf8");
    } catch {
      console.log(`FAIL  ${entry.name}  no committed script at examples/generated/${entry.name}.py`);
      failures += 1;
      continue;
    }
    if (committed === entry.code) {
      console.log(`PASS  ${entry.name}`);
    } else {
      console.log(`FAIL  ${entry.name}  emitter output differs from the committed script`);
      failures += 1;
    }
  }
  console.log(
    failures === 0
      ? `\nall ${entries.length} committed scripts match the emitter`
      : `\n${failures} of ${entries.length} drifted, rerun without --check to refresh`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
} else {
  mkdirSync(codeDir, { recursive: true });
  mkdirSync(imageDir, { recursive: true });

  const summary: string[] = [];
  for (const entry of entries) {
    writeFileSync(join(codeDir, `${entry.name}.py`), entry.code);

    try {
      execFileSync(python, [join(codeDir, `${entry.name}.py`)], {
        cwd: workDir,
        stdio: "pipe",
        encoding: "utf8",
      });
    } catch (error) {
      const detail = error instanceof Error && "stderr" in error ? String(error.stderr) : String(error);
      console.log(`FAIL  ${entry.name}  ${detail.trim().split("\n").slice(-2).join(" | ")}`);
      failures += 1;
      continue;
    }

    console.log(`PASS  ${entry.name}  ${entry.notes}`);
    summary.push(`| \`${entry.name}\` | ${entry.kind} | ${entry.notes} |`);
  }

  // The scripts write beside the data they read, so collect the images afterwards.
  const rendered = readdirSync(workDir).filter(
    (f) => f.endsWith(".png") || f.endsWith(".svg") || f.endsWith(".pdf") || f.endsWith(".gif"),
  );
  for (const file of rendered) {
    const from = join(workDir, file);
    writeFileSync(join(imageDir, file), readFileSync(from));
    rmSync(from);
  }

  writeFileSync(
    join(imageDir, "README.md"),
    [
      "# Baseline gallery",
      "",
      "Rendered from `examples/specs` by the emitter in this working tree.",
      "Regenerate with `npm run baseline`, then look at the image diff.",
      "`npm run baseline -- --check` reports emitter drift without needing Python.",
      "",
      "| Spec | Kind | Findings |",
      "| --- | --- | --- |",
      ...summary,
      "",
    ].join("\n"),
  );

  console.log(
    failures === 0
      ? `\nall ${entries.length} baselines built`
      : `\n${failures} of ${entries.length} failed`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}
