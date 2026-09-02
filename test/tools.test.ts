import { test } from "node:test";
import assert from "node:assert/strict";
import { encodingSentence } from "../src/alttext.ts";
import { CLAIM_WORDING } from "../src/claims.ts";
import { CHANNEL_RANK, designCost, encodingSuggestions, primaryChannel } from "../src/perception.ts";
import { FigureSpec } from "../src/schema.ts";
import { applyFix, repair, suggestFigures } from "../src/suggest.ts";
import { translate } from "../src/translate.ts";
import { verify } from "../src/verify.ts";

const line = {
  kind: "line",
  x: { field: "epoch", label: "Training epoch" },
  y: { field: "accuracy", label: "Test accuracy", unit: "%" },
  group: "model",
  series_order: ["baseline", "ours"],
};

function codes(spec: unknown): string[] {
  return verify(FigureSpec.parse(spec)).map((f) => f.code);
}

function translated(spec: unknown) {
  const result = translate(spec);
  assert.equal(result.status, "translated", JSON.stringify((result as { issues?: unknown }).issues));
  return result;
}

// --- claims ---------------------------------------------------------------

test("every claim kind has wording and a test in the emitted script", () => {
  const spec = {
    ...line,
    claims: Object.keys(CLAIM_WORDING).map((kind) => ({
      kind,
      subject: "ours",
      reference: "baseline",
      tolerance: 1,
    })),
  };
  const result = translated(spec);
  for (const kind of Object.keys(CLAIM_WORDING)) {
    assert.ok(result.code.includes(`"${kind}"`), `${kind} is not tested`);
  }
});

test("a comparative claim without a reference is an error", () => {
  const found = codes({ ...line, claims: [{ kind: "beats_everywhere", subject: "ours" }] });
  assert.ok(found.includes("claim_without_reference"));
});

test("a tolerance claim without a tolerance is an error", () => {
  const found = codes({
    ...line,
    claims: [{ kind: "within_tolerance", subject: "ours", reference: "baseline" }],
  });
  assert.ok(found.includes("claim_without_tolerance"));
});

test("a claim naming a series outside series_order is an error", () => {
  const found = codes({
    ...line,
    claims: [{ kind: "beats_on_average", subject: "ours", reference: "nope" }],
  });
  assert.ok(found.includes("claim_series_unknown"));
});

test("a series cannot be claimed to beat itself", () => {
  const found = codes({
    ...line,
    claims: [{ kind: "beats_on_average", subject: "ours", reference: "ours" }],
  });
  assert.ok(found.includes("claim_compares_a_series_to_itself"));
});

test("a heatmap cannot carry claims", () => {
  const found = codes({
    kind: "heatmap",
    x: { field: "a", label: "A" },
    y: { field: "b", label: "B" },
    value: "v",
    value_label: "V",
    group: "g",
    claims: [{ kind: "beats_on_average", subject: "x", reference: "y" }],
  });
  assert.ok(found.includes("claims_need_series"));
});

test("a script with no claims still defines the claim machinery", () => {
  const result = translated(line);
  assert.match(result.code, /def verify_claims\(frame\)/);
  assert.match(result.code, /CLAIMS = \[\]/);
});

// --- alt text -------------------------------------------------------------

test("the encoding sentence names the marks, the axes and the units", () => {
  const sentence = encodingSentence(FigureSpec.parse(line));
  assert.match(sentence, /^Line chart of Test accuracy in %/);
  assert.match(sentence, /Training epoch/);
  assert.match(sentence, /one series per model/i);
});

test("alt text never opens with the phrase the guidance forbids", () => {
  for (const kind of ["line", "scatter", "bar", "box", "violin"]) {
    const sentence = encodingSentence(FigureSpec.parse({ ...line, kind, aggregation: undefined }));
    assert.ok(!/^this figure shows/i.test(sentence), `${kind} opens badly`);
    assert.ok(!/^an image of/i.test(sentence), `${kind} opens badly`);
  }
});

test("the encoding sentence records uncertainty and reference lines", () => {
  const sentence = encodingSentence(
    FigureSpec.parse({
      ...line,
      aggregation: "mean",
      uncertainty: { kind: "ci", level: 0.9, display: "band" },
      reference_lines: [{ axis: "y", value: 25, meaning: "chance", label: "chance" }],
    }),
  );
  assert.match(sentence, /90 percent confidence intervals/);
  assert.match(sentence, /chance line at 25/);
});

test("author context is not invented when it is absent", () => {
  const result = translated(line);
  assert.match(result.code, /AUTHOR_CONTEXT = None/);
});

// --- perception -----------------------------------------------------------

test("a stacked bar reads by length and a grouped one by position", () => {
  const grouped = FigureSpec.parse({ ...line, kind: "bar", aggregation: "mean" });
  const stacked = FigureSpec.parse({ ...line, kind: "bar", aggregation: "mean", stacked: true });
  assert.equal(primaryChannel(grouped), "position_common");
  assert.equal(primaryChannel(stacked), "length");
  assert.ok(CHANNEL_RANK[primaryChannel(stacked)] > CHANNEL_RANK[primaryChannel(grouped)]);
});

test("a stacked bar is suggested against, with the measured ratio", () => {
  const suggestions = encodingSuggestions(
    FigureSpec.parse({ ...line, kind: "bar", aggregation: "mean", stacked: true }),
  );
  const found = suggestions.find((s) => s.code === "stacked_costs_a_baseline");
  assert.ok(found);
  assert.match(found.message, /1\.4 to 2\.5 times/);
  assert.deepEqual(found.patch, { stacked: false });
});

test("a weaker design costs more", () => {
  const good = designCost(
    FigureSpec.parse({
      ...line,
      aggregation: "mean",
      uncertainty: { kind: "sem", display: "band" },
    }),
  );
  const worse = designCost(
    FigureSpec.parse({ ...line, kind: "bar", aggregation: "none", stacked: true }),
  );
  assert.ok(worse.total > good.total, `${worse.total} should exceed ${good.total}`);
});

// --- suggestion and repair ------------------------------------------------

const PROFILE = {
  columns: [
    { name: "model", role: "category" as const, distinct: 4 },
    { name: "seed", role: "ordinal" as const, distinct: 3 },
    { name: "epoch", role: "ordinal" as const, distinct: 30 },
    { name: "accuracy", role: "measure" as const, distinct: 200 },
    { name: "latency_ms", role: "measure" as const, distinct: 120 },
  ],
  repeats: [{ x: "epoch", group: "model", repeated_rows: 240 }],
};

test("suggestions are ranked cheapest first and all of them validate", () => {
  const candidates = suggestFigures(PROFILE);
  assert.ok(candidates.length >= 2);
  for (let i = 1; i < candidates.length; i += 1) {
    assert.ok(candidates[i]!.cost >= candidates[i - 1]!.cost, "not sorted by cost");
  }
  for (const candidate of candidates) {
    assert.ok(FigureSpec.safeParse(candidate.spec).success, "a suggestion does not parse");
  }
});

test("a repeated x makes the suggestion aggregate and show spread", () => {
  const curve = suggestFigures(PROFILE).find((c) => c.spec.kind === "line");
  assert.ok(curve);
  assert.equal((curve.spec as { aggregation?: string }).aggregation, "mean");
  assert.ok("uncertainty" in curve.spec);
});

test("the suggestion guesses a unit from the column name", () => {
  const candidates = suggestFigures(PROFILE);
  const scatter = candidates.find((c) => c.spec.kind === "scatter");
  assert.ok(scatter);
  assert.equal((scatter.spec as { x: { unit?: string } }).x.unit, "%");
});

test("a profile with nothing measurable yields no suggestion", () => {
  assert.deepEqual(
    suggestFigures({ columns: [{ name: "note", role: "identifier", distinct: 900 }] }),
    [],
  );
});

test("applyFix merges one level deep without clobbering siblings", () => {
  const merged = applyFix(
    { output: { stem: "a", dpi: 600 }, kind: "line" },
    { output: { dpi: 300 } },
  );
  assert.deepEqual(merged.output, { stem: "a", dpi: 300 });
  assert.equal(merged.kind, "line");
});

test("repair converges and reports nothing left open", () => {
  const result = repair({
    kind: "bar",
    x: { field: "dataset", label: "Dataset" },
    y: { field: "acc", label: "Accuracy" },
    group: "model",
    stacked: true,
    aggregation: "mean",
    series_order: ["a", "b", "c", "d", "e", "f"],
  });
  assert.ok(result.applied.includes("stacked_costs_a_baseline"));
  assert.equal(result.spec.stacked, false);
  assert.deepEqual(result.remaining, []);
});

test("repair stops at its budget rather than looping", () => {
  const result = repair({ ...line, kind: "bar", aggregation: "mean", stacked: true }, 1);
  assert.equal(result.rounds, 1);
});

test("repair reports an unparseable spec instead of throwing", () => {
  const result = repair({ kind: "sankey" });
  assert.ok(result.remaining.some((r) => r.code === "invalid_spec"));
});

test("an emphasised series does not share a channel with series zero", () => {
  const result = translated({
    ...line,
    series_order: ["a", "b", "c", "d"],
    emphasis: { series: "d" },
  });
  // Non-emphasised series skip the plain form, which the emphasised one takes.
  assert.match(result.code, /rest = LINE_STYLES\[1:\]/);
  assert.match(result.code, /channel = rest\[index % len\(rest\)\]/);
});

test("with no emphasis the full cycle is used", () => {
  const result = translated({ ...line, series_order: ["a", "b", "c"] });
  assert.match(result.code, /elif EMPHASIS is None:/);
  assert.match(result.code, /channel = LINE_STYLES\[index % len\(LINE_STYLES\)\]/);
});

test("a horizontal reference label sits away from where the data ends", () => {
  const result = translated({
    ...line,
    reference_lines: [{ axis: "y", value: 50, label: "chance" }],
  });
  assert.match(result.code, /xy=\(0\.01, 50\)/);
});

// --- outputs --------------------------------------------------------------

test("latex output carries the column width the size implies", () => {
  const single = translated({ ...line, output: { latex: true } });
  const double = translated({ ...line, output: { latex: true, size: "double_column" } });
  assert.match(single.code, /columnwidth/);
  assert.match(double.code, /textwidth/);
});

test("the interactive backend is only emitted when asked for", () => {
  assert.ok(!translated(line).code.includes("plotly"));
  assert.match(translated({ ...line, output: { interactive: true } }).code, /import plotly/);
});

test("a palette lock is read when one is given", () => {
  assert.match(translated({ ...line, palette_lock: "paper.lock.json" }).code, /PALETTE_LOCK = "paper/);
  assert.match(translated({ ...line, palette_lock: "paper.lock.json" }).code, /def locked_appearance/);
  assert.match(translated(line).code, /PALETTE_LOCK = None/);
});

test("every script fingerprints its data file", () => {
  assert.match(translated(line).code, /def data_fingerprint/);
  assert.match(translated(line).code, /hashlib\.sha256/);
});
