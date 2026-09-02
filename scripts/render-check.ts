/**
 * Runs every emitted script against real matplotlib and checks that files land.
 *
 * The unit tests only compile the generated Python, which catches syntax and
 * nothing else. A wrong keyword argument or a bad reindex survives compilation
 * and dies at runtime, so this is the check that actually proves the emitter.
 *
 *   node scripts/render-check.ts [path-to-python]
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { translate } from "../src/translate.ts";

const python = process.argv[2] ?? "python";

const base = {
  x: { field: "epoch", label: "Training epoch" },
  y: { field: "accuracy", label: "Test accuracy", unit: "%" },
  group: "model",
  data: { path: "results.csv", columns: ["epoch", "accuracy", "model"] },
  output: { formats: ["png"], dpi: 150 },
};

const CASES: [string, Record<string, unknown>][] = [
  ["line_grouped", { ...base, kind: "line" }],
  ["line_mean_over_seeds", { ...base, kind: "line", aggregation: "mean" }],
  ["line_median_over_seeds", { ...base, kind: "line", aggregation: "median" }],
  ["line_plain", { ...base, kind: "line", group: undefined, marker: true }],
  ["line_outside_legend", { ...base, kind: "line", legend: { position: "outside_right" } }],
  ["line_emphasis", { ...base, kind: "line", series_order: ["baseline", "ours"], emphasis: { series: "ours" } }],
  ["line_log", { ...base, kind: "line", y: { ...base.y, scale: "log" } }],
  ["scatter_grouped", { ...base, kind: "scatter" }],
  ["scatter_trendline", { ...base, kind: "scatter", trendline: "linear" }],
  ["scatter_plain", { ...base, kind: "scatter", group: undefined, trendline: "linear" }],
  ["bar_grouped", { ...base, kind: "bar", aggregation: "mean" }],
  ["bar_plain", { ...base, kind: "bar", group: undefined, aggregation: "mean" }],
  ["bar_horizontal", { ...base, kind: "bar", aggregation: "mean", orientation: "horizontal" }],
  ["bar_counts", { ...base, kind: "bar", aggregation: "count" }],
  ["compact_grid", { ...base, kind: "line", style: { preset: "paper_compact", grid: true, despine: false } }],
  ["titled_limits", { ...base, kind: "line", title: "Accuracy over training", y: { ...base.y, limits: [0, 100] } }],
];

const rows = ["epoch,accuracy,model"];
for (const model of ["baseline", "ours"]) {
  for (let epoch = 1; epoch <= 10; epoch += 1) {
    const value = model === "ours" ? 60 + epoch * 3 : 55 + epoch * 2;
    rows.push(`${epoch},${value},${model}`);
    rows.push(`${epoch},${value - 1.5},${model}`);
  }
}

const dir = mkdtempSync(join(tmpdir(), "gu-render-"));
writeFileSync(join(dir, "results.csv"), rows.join("\n") + "\n");

let failures = 0;

for (const [name, spec] of CASES) {
  const result = translate({ ...spec, output: { ...(spec.output as object), stem: name } });

  if (result.status !== "translated") {
    console.log(`FAIL  ${name}  spec rejected: ${JSON.stringify(result.issues)}`);
    failures += 1;
    continue;
  }

  const file = join(dir, `${name}.py`);
  writeFileSync(file, result.code);

  try {
    execFileSync(python, [file], { cwd: dir, stdio: "pipe", encoding: "utf8" });
  } catch (error) {
    const detail = error as { stderr?: string };
    const last = (detail.stderr ?? String(error)).trim().split("\n").slice(-3).join(" | ");
    console.log(`FAIL  ${name}  ${last}`);
    failures += 1;
    continue;
  }

  const produced = readdirSync(dir).includes(`${name}.png`);
  console.log(`${produced ? "PASS" : "FAIL"}  ${name}`);
  if (!produced) failures += 1;
}

console.log(
  failures === 0
    ? `\nall ${CASES.length} figures rendered\noutput: ${dir}`
    : `\n${failures} of ${CASES.length} failed\noutput: ${dir}`,
);
process.exitCode = failures === 0 ? 0 : 1;
