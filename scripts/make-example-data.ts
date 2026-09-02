/**
 * Writes the CSVs the baseline gallery plots.
 *
 * Deterministic on purpose. The baseline images are committed and compared by
 * eye across changes, so the data behind them must not move. Noise comes from a
 * fixed linear congruential generator rather than Math.random.
 *
 *   node scripts/make-example-data.ts
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT = join(import.meta.dirname, "..", "examples", "data");

let state = 20260902;
function next(): number {
  state = (state * 1103515245 + 12345) % 2147483648;
  return state / 2147483648;
}

/** Centred noise, so a series wobbles without drifting. */
function jitter(scale: number): number {
  return (next() - 0.5) * 2 * scale;
}

const MODELS = ["baseline", "+augment", "+distill", "ours"] as const;
const CEILING: Record<string, number> = {
  baseline: 71.4,
  "+augment": 75.2,
  "+distill": 78.1,
  ours: 82.6,
};
const SEEDS = [0, 1, 2];
const EPOCHS = 30;

const training = ["model,seed,epoch,accuracy,loss"];
for (const model of MODELS) {
  for (const seed of SEEDS) {
    const offset = jitter(0.9);
    for (let epoch = 1; epoch <= EPOCHS; epoch += 1) {
      const progress = 1 - Math.exp(-epoch / 7.5);
      const accuracy = CEILING[model]! * progress + offset + jitter(0.55);
      const loss = 2.35 * Math.exp(-epoch / 8.5) + 0.21 + jitter(0.035);
      training.push(
        `${model},${seed},${epoch},${accuracy.toFixed(3)},${Math.max(loss, 0.05).toFixed(4)}`,
      );
    }
  }
}

const DATASETS = ["CIFAR-10", "CIFAR-100", "ImageNet"] as const;
const DIFFICULTY: Record<string, number> = { "CIFAR-10": 1.0, "CIFAR-100": 0.78, ImageNet: 0.62 };
const COST: Record<string, { latency: number; params: number }> = {
  baseline: { latency: 12.4, params: 11.2 },
  "+augment": { latency: 12.9, params: 11.2 },
  "+distill": { latency: 18.7, params: 23.5 },
  ours: { latency: 21.3, params: 25.8 },
};

const benchmarks = ["model,dataset,accuracy,latency_ms,params_m"];
for (const model of MODELS) {
  for (const dataset of DATASETS) {
    const accuracy = CEILING[model]! * DIFFICULTY[dataset]! + jitter(0.7);
    const latency = COST[model]!.latency * (dataset === "ImageNet" ? 3.1 : 1) + jitter(0.4);
    benchmarks.push(
      `${model},${dataset},${accuracy.toFixed(2)},${latency.toFixed(2)},${COST[model]!.params}`,
    );
  }
}

const LEARNING_RATES = [0.0001, 0.0003, 0.001, 0.003];
const BATCH_SIZES = [16, 32, 64, 128];

const sweep = ["learning_rate,batch_size,accuracy"];
for (const rate of LEARNING_RATES) {
  for (const batch of BATCH_SIZES) {
    // A ridge with a best setting in the middle, which is what a sweep looks like.
    const distance = Math.abs(Math.log10(rate) + 3) + Math.abs(Math.log2(batch) - 5) / 2;
    sweep.push(`${rate},${batch},${(82 - distance * 4.5 + jitter(0.5)).toFixed(2)}`);
  }
}

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "sweep.csv"), sweep.join("\n") + "\n");
writeFileSync(join(OUT, "training.csv"), training.join("\n") + "\n");
writeFileSync(join(OUT, "benchmarks.csv"), benchmarks.join("\n") + "\n");

console.log(`training.csv   ${training.length - 1} rows`);
console.log(`benchmarks.csv ${benchmarks.length - 1} rows`);
console.log(`sweep.csv      ${sweep.length - 1} rows`);
console.log(`written to ${OUT}`);
