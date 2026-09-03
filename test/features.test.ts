import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RECIPES } from "../src/recipes.ts";
import { FigureSpec } from "../src/schema.ts";
import { translate } from "../src/translate.ts";
import { verify } from "../src/verify.ts";
import { resolvePython } from "../scripts/python.ts";

const line = {
  kind: "line",
  x: { field: "epoch", label: "Training epoch" },
  y: { field: "accuracy", label: "Test accuracy", unit: "%" },
  group: "model",
};

function translated(spec: unknown) {
  const result = translate(spec);
  assert.equal(result.status, "translated", JSON.stringify((result as { issues?: unknown }).issues));
  return result;
}

function codes(spec: unknown): string[] {
  return verify(FigureSpec.parse(spec)).map((f) => f.code);
}

// --- the agent's blind spots ---------------------------------------------

test("every recipe parses, verifies clean, and emits a script", () => {
  for (const recipe of RECIPES) {
    const result = translate(recipe.spec);
    assert.equal(result.status, "translated", `${recipe.name} was rejected`);
    const errors = result.findings.filter((f) => f.severity === "error");
    assert.deepEqual(errors, [], `${recipe.name} has errors`);
    assert.ok(result.code.includes("def main()"), `${recipe.name} emitted no main`);
  }
});

test("an unknown field names the column the author probably meant", () => {
  const result = verify(
    FigureSpec.parse({ ...line, y: { field: "acuracy", label: "A" }, data: { columns: ["epoch", "accuracy", "model"] } }),
  );
  const finding = result.find((f) => f.code === "unknown_field");
  assert.ok(finding);
  assert.match(finding.message, /Did you mean "accuracy"\?/);
});

test("an abbreviated field finds the column it is short for", () => {
  const result = verify(
    FigureSpec.parse({
      ...line,
      y: { field: "acc", label: "A" },
      data: { columns: ["epoch", "accuracy", "model"] },
    }),
  );
  const finding = result.find((f) => f.code === "unknown_field");
  assert.ok(finding);
  assert.match(finding.message, /Did you mean "accuracy"\?/);
});

test("a wildly wrong field gets no misleading suggestion", () => {
  const result = verify(
    FigureSpec.parse({ ...line, y: { field: "zzzz", label: "A" }, data: { columns: ["epoch", "accuracy"] } }),
  );
  const finding = result.find((f) => f.code === "unknown_field");
  assert.ok(finding);
  assert.ok(!finding.message.includes("Did you mean"));
});

// --- uncertainty ----------------------------------------------------------

test("a confidence interval emits a seeded bootstrap, not a normal approximation", () => {
  const result = translated({
    ...line,
    aggregation: "mean",
    uncertainty: { kind: "ci", level: 0.9, over: "seed" },
  });
  assert.match(result.code, /def bootstrap_interval/);
  assert.match(result.code, /BOOTSTRAP_SEED = \d+/);
  assert.match(result.code, /CI_LEVEL = 0\.9/);
  assert.match(result.code, /np\.mean\(draws, axis=1\)/);
  assert.match(result.code, /fill_between/);
});

test("a median with a bootstrap resamples the median", () => {
  const result = translated({
    ...line,
    aggregation: "median",
    uncertainty: { kind: "ci" },
  });
  assert.match(result.code, /np\.median\(draws, axis=1\)/);
});

test("uncertainty without aggregation is an error", () => {
  assert.ok(codes({ ...line, uncertainty: { kind: "std" } }).includes("uncertainty_without_aggregation"));
});

test("an interquartile range around a mean is flagged", () => {
  const found = codes({ ...line, aggregation: "mean", uncertainty: { kind: "iqr" } });
  assert.ok(found.includes("iqr_around_a_mean"));
});

test("a band across bar categories is flagged", () => {
  const found = codes({
    ...line,
    kind: "bar",
    aggregation: "mean",
    uncertainty: { kind: "sem", display: "band" },
  });
  assert.ok(found.includes("band_on_categories"));
});

// --- faceting -------------------------------------------------------------

test("faceting emits panels, letters, and one legend", () => {
  const result = translated({ ...line, facet: { by: "dataset", columns: 3 } });
  assert.match(result.code, /FACET_BY = "dataset"/);
  assert.match(result.code, /def panels\(df\)/);
  assert.match(result.code, /if index == 0:/);
  assert.match(result.code, /show_y = \(index % columns\) == 0/);
});

test("faceting by the grouping column is an error", () => {
  assert.ok(codes({ ...line, facet: { by: "model" } }).includes("facet_by_the_group"));
});

// --- reference lines and annotations --------------------------------------

test("a reference line is drawn the way its meaning implies", () => {
  const result = translated({
    ...line,
    reference_lines: [{ axis: "y", value: 50, meaning: "chance", label: "chance" }],
  });
  assert.match(result.code, /ax\.axhline\(/);
  assert.match(result.code, /50,/);
});

test("a reference line off a log axis is an error", () => {
  const found = codes({
    ...line,
    y: { field: "accuracy", label: "A", scale: "log" },
    reference_lines: [{ axis: "y", value: 0 }],
  });
  assert.ok(found.includes("reference_line_off_log_axis"));
});

test("an annotation resolves its position at runtime, not in the spec", () => {
  const result = translated({
    ...line,
    annotate: [{ at: "max", series: "ours", text: "SOTA" }],
  });
  assert.match(result.code, /def locate\(frame, where, series\)/);
  assert.match(result.code, /"at": "max"/);
  assert.ok(!result.code.includes("xytext=(3.2"));
});

test("a crossover annotation needs two series", () => {
  const { group, ...ungrouped } = line;
  const found = codes({ ...ungrouped, annotate: [{ at: "crossover", text: "overtakes" }] });
  assert.ok(found.includes("crossover_needs_two_series"));
});

// --- the guards -----------------------------------------------------------

test("a dual axis always warns and carries its justification", () => {
  const { group, ...single } = line;
  const spec = {
    ...single,
    y2: { field: "loss", label: "Loss", justification: "Accuracy and loss share the epoch axis only." },
  };
  const found = verify(FigureSpec.parse(spec));
  const warning = found.find((f) => f.code === "dual_axis_in_use");
  assert.ok(warning);
  assert.match(warning.message, /Accuracy and loss share/);
  assert.match(translated(spec).code, /Y2_JUSTIFICATION/);
});

test("a dual axis alongside a group is refused", () => {
  const found = codes({
    ...line,
    y2: { field: "loss", label: "Loss", justification: "Two scales are needed for this comparison." },
  });
  assert.ok(found.includes("dual_axis_with_group"));
});

test("significance runs a test rather than drawing a star", () => {
  const result = translated({
    ...line,
    kind: "bar",
    aggregation: "mean",
    uncertainty: { kind: "sem", display: "bar" },
    significance: { method: "bootstrap", pairs: [["a", "b"]] },
  });
  assert.match(result.code, /def compare\(left, right\)/);
  assert.match(result.code, /rng\.permutation/);
  assert.match(result.code, /p = compare\(/);
});

test("stacking signed values is an error", () => {
  const found = codes({
    ...line,
    kind: "bar",
    stacked: true,
    aggregation: "mean",
    transform: { kind: "delta_vs_baseline", baseline: "baseline" },
  });
  assert.ok(found.includes("stacking_signed_values"));
});

test("a baseline transform needs a baseline and a group", () => {
  const { group, ...ungrouped } = line;
  const found = codes({ ...ungrouped, transform: { kind: "percent_of_baseline" } });
  assert.ok(found.includes("transform_needs_baseline"));
  assert.ok(found.includes("transform_needs_group"));
});

// --- venue presets --------------------------------------------------------

test("a venue sets the column width and font floor the checker measures against", () => {
  const plain = translated(line);
  const neurips = translated({ ...line, style: { venue: "neurips" } });
  assert.match(plain.code, /TARGET_WIDTH_IN = 3\.4/);
  assert.match(plain.code, /MIN_TEXT_PT = 5/);
  assert.match(neurips.code, /TARGET_WIDTH_IN = 3\.25/);
  assert.match(neurips.code, /MIN_TEXT_PT = 6/);
});

// --- animation ------------------------------------------------------------

test("animation emits manim's rate functions by name", () => {
  const result = translated({ ...line, animate: { style: "draw", easing: "rush_into" } });
  assert.match(result.code, /def smooth_rate\(t, inflection=10\.0\)/);
  assert.match(result.code, /def rush_into\(t\)/);
  assert.match(result.code, /ANIMATE_EASING = "rush_into"/);
  assert.match(result.code, /FuncAnimation/);
});

test("no animation means no animation code", () => {
  const result = translated(line);
  assert.ok(!result.code.includes("FuncAnimation"));
  assert.ok(!result.code.includes("smooth_rate"));
});

test("growing bars outside a bar chart is flagged", () => {
  assert.ok(codes({ ...line, animate: { style: "grow" } }).includes("grow_outside_bars"));
});

// --- new kinds ------------------------------------------------------------

test("every chart kind emits a runnable draw_panel", () => {
  const kinds = [
    { ...line, kind: "line" },
    { ...line, kind: "scatter" },
    { ...line, kind: "bar", aggregation: "mean" },
    { ...line, kind: "box" },
    { ...line, kind: "violin" },
    {
      ...line,
      kind: "heatmap",
      value: "score",
      value_label: "Score",
      group: undefined,
    },
  ];
  for (const spec of kinds) {
    const result = translated(spec);
    assert.match(result.code, /def draw_panel\(ax, df\)/, `${spec.kind} has no draw_panel`);
  }
});

test("a heatmap needs a colourbar label so the units survive", () => {
  const result = translate({ ...line, kind: "heatmap", value: "score", group: undefined });
  assert.equal(result.status, "invalid_spec");
  assert.ok(result.issues.some((i) => i.path === "value_label"));
});

test("a diverging scale over counts is an error", () => {
  const found = codes({
    ...line,
    kind: "heatmap",
    value: "n",
    value_label: "Count",
    aggregation: "count",
    diverging: true,
    group: undefined,
  });
  assert.ok(found.includes("diverging_counts"));
});

// --- the whole surface still holds the line -------------------------------

test("no styling knob reaches the schema an agent sees", async () => {
  const { z } = await import("zod");
  const schema = JSON.stringify(z.toJSONSchema(FigureSpec, { io: "input" }));
  for (const banned of ["linewidth", "markersize", "figsize", "fontsize", "hex", "rgba"]) {
    assert.ok(!schema.includes(banned), `${banned} must stay out of the spec`);
  }
});

test("output is deterministic across every recipe", () => {
  for (const recipe of RECIPES) {
    assert.equal(translated(recipe.spec).code, translated(recipe.spec).code, recipe.name);
  }
});

test("every recipe compiles as Python", (t) => {
  const python = resolvePython();
  if (!python) {
    t.skip("no Python interpreter found");
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), "gu-features-"));
  for (const recipe of RECIPES) {
    const file = join(dir, `${recipe.name}.py`);
    writeFileSync(file, translated(recipe.spec).code);
    execFileSync(python, ["-c", `compile(open(r'''${file}''').read(), 'x', 'exec')`], {
      stdio: "pipe",
    });
  }
});

// --- a temporal x axis ----------------------------------------------------

const dated = {
  kind: "line",
  x: { field: "date", label: "Date", temporal: true },
  y: { field: "close", label: "Closing price", unit: "$" },
};

test("a temporal axis parses the column and orders the rows by it", () => {
  const code = translated(dated).code;
  assert.match(code, /df\[X_FIELD\] = pd\.to_datetime\(df\[X_FIELD\]\)/);
  assert.match(code, /df = df\.sort_values\(X_FIELD\)/);
});

test("a temporal axis brings the date locator with it", () => {
  const code = translated(dated).code;
  assert.match(code, /import matplotlib\.dates as mdates/);
  assert.match(code, /ConciseDateFormatter/);
});

test("a figure with no temporal axis carries none of that", () => {
  const code = translated({ ...line, group: undefined }).code;
  assert.doesNotMatch(code, /mdates/);
  assert.doesNotMatch(code, /to_datetime/);
});

test("only the x axis can be temporal", () => {
  const found = codes({ ...dated, y: { field: "close", label: "Close", temporal: true } });
  assert.ok(found.includes("temporal_y_axis"));
});

test("a bar puts categories on x, so it cannot also be temporal", () => {
  assert.ok(codes({ ...dated, kind: "bar" }).includes("temporal_x_on_categories"));
});

test("time is not logarithmic", () => {
  const found = codes({ ...dated, x: { ...dated.x, scale: "log" } });
  assert.ok(found.includes("temporal_log_axis"));
});

test("numeric limits cannot bound a temporal axis", () => {
  const found = codes({ ...dated, x: { ...dated.x, limits: [0, 100] } });
  assert.ok(found.includes("temporal_axis_limits"));
});

test("a scatter may be temporal too", () => {
  const found = codes({ ...dated, kind: "scatter" });
  assert.ok(!found.includes("temporal_x_on_categories"));
});
