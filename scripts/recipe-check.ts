/**
 * Runs every recipe against synthetic data shaped to fit it.
 *
 * A recipe that validates but does not run is worse than no recipe, because an
 * agent will trust it. This renders all of them for real.
 *
 *   node scripts/recipe-check.ts [python]
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RECIPES } from "../src/recipes.ts";
import { translate } from "../src/translate.ts";
import { failureDetail } from "./exec-failure.ts";
import { resolvePython } from "./python.ts";

const python = process.argv[2] ?? resolvePython();
if (!python) {
  console.log("no Python interpreter found; set PYTHON or pass one as the first argument");
  process.exit(1);
}
const dir = mkdtempSync(join(tmpdir(), "gu-recipes-"));

let seed = 7;
function next(): number {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
}

function write(name: string, rows: string[]): void {
  writeFileSync(join(dir, name), rows.join("\n") + "\n");
}

const MODELS = ["baseline", "+augment", "ours"];
const DATASETS = ["CIFAR-10", "CIFAR-100", "ImageNet"];

const results = ["model,seed,epoch,dataset,accuracy,loss"];
for (const model of MODELS) {
  for (const dataset of DATASETS) {
    for (let seedIndex = 0; seedIndex < 3; seedIndex += 1) {
      for (let epoch = 1; epoch <= 20; epoch += 1) {
        const ceiling = model === "ours" ? 82 : model === "+augment" ? 75 : 70;
        const accuracy = ceiling * (1 - Math.exp(-epoch / 6)) + (next() - 0.5) * 2;
        const loss = 2.3 * Math.exp(-epoch / 7) + 0.2 + (next() - 0.5) * 0.05;
        results.push(
          `${model},${seedIndex},${epoch},${dataset},${accuracy.toFixed(3)},${loss.toFixed(4)}`,
        );
      }
    }
  }
}
write("results.csv", results);

const ablation = ["variant,accuracy"];
const ABLATION = { full: 82, "no augment": 78, "no distill": 76, "no both": 70 };
for (const [variant, base] of Object.entries(ABLATION)) {
  for (let run = 0; run < 4; run += 1) {
    ablation.push(`${variant},${(base + (next() - 0.5) * 3).toFixed(2)}`);
  }
}
write("ablation.csv", ablation);

const benchmarks = ["model,dataset,accuracy,latency_ms,params_m"];
for (const model of MODELS) {
  for (const dataset of DATASETS) {
    const base = model === "ours" ? 80 : model === "+augment" ? 74 : 69;
    const scale = dataset === "ImageNet" ? 0.62 : dataset === "CIFAR-100" ? 0.8 : 1;
    benchmarks.push(
      `${model},${dataset},${(base * scale).toFixed(2)},${(12 + MODELS.indexOf(model) * 5).toFixed(2)},${11 + MODELS.indexOf(model) * 7}`,
    );
  }
}
write("benchmarks.csv", benchmarks);

const confusion = ["actual,predicted,count"];
for (const actual of ["cat", "dog", "bird"]) {
  for (const predicted of ["cat", "dog", "bird"]) {
    confusion.push(`${actual},${predicted},${actual === predicted ? 90 + Math.floor(next() * 10) : Math.floor(next() * 12)}`);
  }
}
write("confusion.csv", confusion);

const sweep = ["learning_rate,batch_size,accuracy"];
for (const lr of [0.0001, 0.001, 0.01]) {
  for (const batch of [16, 32, 64, 128]) {
    sweep.push(`${lr},${batch},${(70 + next() * 12).toFixed(2)}`);
  }
}
write("sweep.csv", sweep);

const scaling = ["family,params_m,loss"];
for (const family of ["dense", "sparse"]) {
  for (const params of [1, 3, 10, 30, 100, 300]) {
    scaling.push(`${family},${params},${(2.5 * Math.pow(params, -0.18) + next() * 0.03).toFixed(4)}`);
  }
}
write("scaling.csv", scaling);

// Enough observations per model that a density and an ECDF have something to
// describe, and three spreads so the shapes differ.
const latency = ["model,seed,latency_ms"];
for (const [model, centre, spread] of [
  ["baseline", 40, 9],
  ["ours", 28, 4],
  ["distilled", 33, 14],
] as const) {
  for (let seed = 0; seed < 60; seed += 1) {
    const draw = centre + spread * (next() + next() + next() - 1.5);
    latency.push(`${model},${seed},${Math.max(1, draw).toFixed(3)}`);
  }
}
write("latency.csv", latency);

const effects = ["component,seed,delta_pp"];
for (const [name, effect, spread] of [
  ["+ MixUp", 1.8, 0.5],
  ["+ Distill", 3.1, 0.4],
  ["+ EMA", 0.3, 0.9],
  ["+ Dropout", -0.6, 0.4],
] as const) {
  for (let seed = 0; seed < 6; seed += 1) {
    effects.push(`${name},${seed},${(effect + spread * (next() * 2 - 1)).toFixed(3)}`);
  }
}
write("ablation_effects.csv", effects);

const paired = ["dataset,condition,accuracy"];
for (let index = 0; index < 14; index += 1) {
  const base = 60 + next() * 25;
  paired.push(`d${index},baseline,${base.toFixed(3)}`);
  paired.push(`d${index},ours,${(base + 1.4 + next() * 2).toFixed(3)}`);
}
write("paired.csv", paired);

const stages = ["method,stage,score"];
for (const [name, before, after] of [
  ["alpha", 62, 71],
  ["beta", 70, 68],
  ["gamma", 55, 74],
  ["delta", 66, 67],
] as const) {
  stages.push(`${name},before,${before}`);
  stages.push(`${name},after,${after}`);
}
write("stages.csv", stages);

const calibration = ["model,confidence,correct"];
for (const [model, skew] of [
  ["baseline", 0.18],
  ["calibrated", 0.0],
] as const) {
  for (let index = 0; index < 900; index += 1) {
    const truth = next();
    const shown = Math.min(0.999, Math.max(0.001, truth + skew * (1 - truth)));
    calibration.push(`${model},${shown.toFixed(4)},${next() < truth ? 1 : 0}`);
  }
}
write("calibration.csv", calibration);

// Box-Muller off the same seeded stream, so residuals are normal enough for a
// Q-Q line to be straight.
const residuals = ["residual"];
for (let index = 0; index < 300; index += 1) {
  const draw = Math.sqrt(-2 * Math.log(next() || 1e-9)) * Math.cos(2 * Math.PI * next());
  residuals.push(draw.toFixed(5));
}
write("residuals.csv", residuals);

const survival = ["arm,hours,failed"];
for (const [arm, scale] of [
  ["control", 90],
  ["treated", 160],
] as const) {
  for (let index = 0; index < 70; index += 1) {
    const time = -scale * Math.log(next() || 1e-9);
    const cut = 40 + next() * 280;
    survival.push(`${arm},${Math.min(time, cut).toFixed(2)},${time <= cut ? 1 : 0}`);
  }
}
write("survival.csv", survival);

let failures = 0;
console.log(`python: ${python}\nworkdir: ${dir}\n`);

for (const recipe of RECIPES) {
  const result = translate(recipe.spec);
  if (result.status !== "translated") {
    console.log(`FAIL  ${recipe.name}  rejected: ${JSON.stringify(result.issues)}`);
    failures += 1;
    continue;
  }

  const stem = recipe.name;
  const rerun = translate({
    ...recipe.spec,
    output: { ...recipe.spec.output, stem, formats: ["png"], dpi: 150 },
  });
  if (rerun.status !== "translated") {
    console.log(`FAIL  ${recipe.name}  rejected on rerun`);
    failures += 1;
    continue;
  }

  const file = join(dir, `${stem}.py`);
  writeFileSync(file, rerun.code);

  try {
    const output = execFileSync(python, [file], { cwd: dir, stdio: "pipe", encoding: "utf8" });
    const produced = readdirSync(dir).includes(`${stem}.png`);
    const notes = output
      .split("\n")
      .filter((l) => l.includes("WARNING") || l.includes("ERROR"))
      .length;
    console.log(`${produced ? "PASS" : "FAIL"}  ${stem}${notes ? `  (${notes} finding(s))` : ""}`);
    if (!produced) failures += 1;
  } catch (error) {
    console.log(`FAIL  ${stem}  ${failureDetail(error, 3)}`);
    failures += 1;
  }
}

console.log(failures === 0 ? `\nall ${RECIPES.length} recipes rendered` : `\n${failures} failed`);
process.exitCode = failures === 0 ? 0 : 1;
