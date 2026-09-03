import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RECIPES } from "../src/recipes.ts";
import { FigureSpec } from "../src/schema.ts";
import { translate } from "../src/translate.ts";
import { verify } from "../src/verify.ts";
import { resolvePython } from "../scripts/python.ts";

const python = resolvePython();

/** A committed CSV, resolved from this file rather than the caller's cwd. */
function fixture(name: string): URL {
  return new URL(`fixtures/${name}`, import.meta.url);
}

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

// --- a cut axis where the mark's own length is the value -----------------

const BREAK = { axis: "y", from: 30, to: 60 } as const;

const categorical = {
  x: { field: "model", label: "Model" },
  y: { field: "accuracy", label: "Final accuracy", unit: "%" },
  data: { path: "results.csv" },
};

test("a cut axis is refused on the kinds whose mark length is the value", () => {
  for (const kind of ["bar", "box", "violin"]) {
    const found = verify(FigureSpec.parse({ ...categorical, kind, axis_break: BREAK }));
    const finding = found.find((f) => f.code === "axis_break_on_length_marks");
    assert.ok(finding, `${kind} accepted a cut axis`);
    assert.equal(finding.severity, "error");
    assert.match(finding.message, new RegExp(kind));
  }
});

test("a cut axis stays legal where position carries the value", () => {
  const positional = [
    { ...line, kind: "line", data: { path: "results.csv" } },
    { ...line, kind: "scatter", data: { path: "results.csv" } },
    {
      kind: "heatmap",
      x: { field: "learning_rate", label: "Learning rate" },
      y: { field: "batch_size", label: "Batch size" },
      value: "accuracy",
      value_label: "Accuracy",
      data: { path: "results.csv" },
    },
  ];
  for (const spec of positional) {
    assert.ok(
      !codes({ ...spec, axis_break: BREAK }).includes("axis_break_on_length_marks"),
      `${spec.kind} was refused a cut axis it should keep`,
    );
  }
});

test("the cut-axis finding carries no patch", () => {
  // Deleting a field through apply_fixes is untested, and an over-eager patch
  // has shipped a bug here before.
  const found = verify(FigureSpec.parse({ ...categorical, kind: "bar", axis_break: BREAK }));
  const finding = found.find((f) => f.code === "axis_break_on_length_marks");
  assert.ok(finding);
  assert.ok(!("fix" in finding), "the finding offers a patch");
});

// --- a band is not drawn where no spread could be measured ---------------

const solo = {
  kind: "line",
  x: { field: "epoch", label: "Training epoch" },
  y: { field: "accuracy", label: "Test accuracy", unit: "%" },
  group: "model",
  aggregation: "mean",
  uncertainty: { kind: "ci", over: "seed" },
  data: { path: "single-seed.csv" },
};

test("the centre is never substituted for an interval that could not be measured", () => {
  const code = translated(solo).code;
  assert.ok(!code.includes("np.where(np.isfinite(low), low, centre)"));
  assert.ok(code.includes('summary["_low"] = low'));
});

function runSolo(spec: unknown, driver?: string, csv = "single-seed.csv"): string {
  const dir = mkdtempSync(join(tmpdir(), "gu-solo-"));
  writeFileSync(join(dir, csv), readFileSync(fixture(csv)));
  writeFileSync(join(dir, "figure.py"), translated(spec).code);
  if (driver) writeFileSync(join(dir, "driver.py"), driver);
  return execFileSync(python!, [driver ? "driver.py" : "figure.py"], {
    cwd: dir,
    encoding: "utf8",
    stdio: "pipe",
  });
}

function disclosures(out: string): string[] {
  return out.split(/\r?\n/).filter((line) => line.startsWith("uncertainty:"));
}

test("a series with one observation per x is reported once, and the script still exits 0", { skip: !python }, () => {
  // Once. summarise() runs per panel and again in main for the alt text, so
  // reporting from inside it said the same thing twice.
  const out = runSolo({ ...solo, output: { stem: "solo", formats: ["png"], dpi: 100 } });
  assert.deepEqual(disclosures(out), [
    "uncertainty: 5 of 10 points have fewer than 2 observations, so no interval is drawn for them (series: solo)",
  ]);
});

test("a faceted figure counts every panel into one line", { skip: !python }, () => {
  // Not "5 of 10" twice. The denominator is the figure, not a panel.
  const out = runSolo(
    {
      ...solo,
      facet: { by: "dataset", columns: 2 },
      data: { path: "faceted-single-seed.csv" },
      output: { stem: "solo-facet", formats: ["png"], dpi: 100, size: "double_column" },
    },
    undefined,
    "faceted-single-seed.csv",
  );
  assert.deepEqual(disclosures(out), [
    "uncertainty: 10 of 20 points have fewer than 2 observations, so no interval is drawn for them (series: solo)",
  ]);
});

test("the unmeasurable rows keep NaN and the measurable ones do not", { skip: !python }, () => {
  const driver = [
    "import importlib.util, numpy as np, pandas as pd",
    'spec = importlib.util.spec_from_file_location("figure", "figure.py")',
    "mod = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(mod)",
    'frame = mod.prepare(pd.read_csv("single-seed.csv"))',
    "summary = mod.summarise(frame)",
    'lows = summary.set_index("model")["_low"]',
    'assert not np.isfinite(lows.loc["solo"]).any(), "solo invented an interval"',
    'assert np.isfinite(lows.loc["repeated"]).all(), "repeated lost its interval"',
    'print("nan-discipline ok")',
  ].join("\n");
  assert.match(runSolo({ ...solo, output: { stem: "solo", formats: ["png"] } }, driver), /nan-discipline ok/);
});

test("an errorbar display tolerates the missing interval", { skip: !python }, () => {
  const out = runSolo({
    ...solo,
    uncertainty: { kind: "ci", over: "seed", display: "bar" },
    output: { stem: "solo-bar", formats: ["png"], dpi: 100 },
  });
  assert.match(out, /uncertainty: 5 of 10 points/);
});

// The count must follow the data, not the number of axes the figure uses.
// A cut axis draws the frame above and below the break; an inset redraws its
// parent's frame magnified. Both are one set of points.
const ONE_LINE = [
  "uncertainty: 5 of 10 points have fewer than 2 observations, so no interval is drawn for them (series: solo)",
];

test("a cut axis counts its data once, not once per half", { skip: !python }, () => {
  const out = runSolo({
    ...solo,
    axis_break: { axis: "y", from: 74, to: 76 },
    output: { stem: "solo-break", formats: ["png"], dpi: 100 },
  });
  assert.deepEqual(disclosures(out), ONE_LINE);
});

test("an inset counts its data once, not once with its parent", { skip: !python }, () => {
  const out = runSolo({
    ...solo,
    inset: { x: [3, 5], y: [70, 80], corner: "lower_right" },
    output: { stem: "solo-inset", formats: ["png"], dpi: 100 },
  });
  assert.deepEqual(disclosures(out), ONE_LINE);
});

test("the count holds for every uncertainty kind that can go unmeasurable", { skip: !python }, () => {
  // ci, sem and std all reach the same isfinite test. range and iqr do not,
  // because min and max of one observation are finite and equal.
  for (const kind of ["ci", "sem", "std"]) {
    const out = runSolo({
      ...solo,
      uncertainty: { kind, over: "seed" },
      output: { stem: `solo-${kind}`, formats: ["png"], dpi: 100 },
    });
    assert.deepEqual(disclosures(out), ONE_LINE, `${kind} miscounted`);
  }
});

test("a bar chart reports the same way a line does", { skip: !python }, () => {
  const out = runSolo({
    ...solo,
    kind: "bar",
    x: { field: "epoch", label: "Training epoch" },
    output: { stem: "solo-bar-kind", formats: ["png"], dpi: 100 },
  });
  assert.deepEqual(disclosures(out), ONE_LINE);
});

test("repeat counts every metric panel, though they share one frame", { skip: !python }, () => {
  // repeat splits columns rather than rows, so every panel is handed the same
  // DataFrame. Keying on the frame collapsed two panels into one and halved
  // the count.
  const out = runSolo({
    ...solo,
    repeat: { fields: ["accuracy", "loss"], columns: 2 },
    output: { stem: "solo-repeat", formats: ["png"], dpi: 100, size: "double_column" },
  });
  assert.deepEqual(disclosures(out), [
    "uncertainty: 10 of 20 points have fewer than 2 observations, so no interval is drawn for them (series: solo)",
  ]);
});
