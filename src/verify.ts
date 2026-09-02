import { hasCategoricalX, type FigureSpec } from "./schema.ts";

/**
 * Checks that need only the spec, no rendering.
 *
 * An error means the script will fail or the figure will misrepresent the data.
 * A warning means it will run and be wrong for a reviewer rather than wrong for
 * the maths. Anything needing pixels, such as overlapping tick labels or a
 * clipped legend, belongs to the render-time checker in python/graphunslopify.
 */

export type Severity = "error" | "warning";

export type Finding = {
  severity: Severity;
  code: string;
  message: string;
};

const MAX_LEGIBLE_SERIES = 8;
const MAX_STACK_SEGMENTS = 6;
const MIN_PUBLICATION_DPI = 300;
const MAX_FACET_PANELS_PER_ROW = 4;

/** Levenshtein, so an unknown field can suggest the column the author meant. */
function editDistance(a: string, b: string): number {
  const rows = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j += 1) rows[0]![j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      rows[i]![j] = Math.min(rows[i - 1]![j]! + 1, rows[i]![j - 1]! + 1, rows[i - 1]![j - 1]! + cost);
    }
  }
  return rows[a.length]![b.length]!;
}

function nearest(field: string, columns: string[]): string | undefined {
  let best: { name: string; score: number } | undefined;
  for (const column of columns) {
    const score = editDistance(field.toLowerCase(), column.toLowerCase());
    if (!best || score < best.score) best = { name: column, score };
  }
  if (!best) return undefined;
  return best.score <= Math.max(2, Math.floor(field.length / 3)) ? best.name : undefined;
}

export function verify(spec: FigureSpec): Finding[] {
  const findings: Finding[] = [];
  const add = (severity: Severity, code: string, message: string) =>
    findings.push({ severity, code, message });

  for (const [name, axis] of [
    ["x", spec.x],
    ["y", spec.y],
  ] as const) {
    if (axis.limits) {
      const [lo, hi] = axis.limits;
      if (lo >= hi) {
        add("error", "axis_limits_inverted", `${name} limits are [${lo}, ${hi}], so lower is not below upper.`);
      }
      if (axis.scale === "log" && lo <= 0) {
        add(
          "error",
          "log_scale_nonpositive_limit",
          `${name} is on a log scale but its lower limit is ${lo}. A log axis cannot reach zero or below.`,
        );
      }
    }
  }

  // --- field references ----------------------------------------------------

  const columns = spec.data.columns;
  if (columns) {
    const known = new Set(columns);
    const refs: [string, string][] = [
      ["x.field", spec.x.field],
      ["y.field", spec.y.field],
    ];
    if (spec.group) refs.push(["group", spec.group]);
    if (spec.facet) refs.push(["facet.by", spec.facet.by]);
    if (spec.kind === "heatmap") refs.push(["value", spec.value]);
    if (spec.kind === "line" && spec.y2) refs.push(["y2.field", spec.y2.field]);
    for (const clause of spec.filter ?? []) refs.push([`filter on ${clause.field}`, clause.field]);
    if ("uncertainty" in spec && spec.uncertainty?.over) {
      refs.push(["uncertainty.over", spec.uncertainty.over]);
    }
    for (const field of spec.series_from_columns?.fields ?? []) {
      refs.push(["series_from_columns", field]);
    }

    for (const [where, field] of refs) {
      if (known.has(field)) continue;
      const guess = nearest(field, columns);
      add(
        "error",
        "unknown_field",
        `${where} refers to "${field}", which is not in data.columns.` +
          (guess ? ` Did you mean "${guess}"?` : ""),
      );
    }
  }

  // --- series and emphasis -------------------------------------------------

  if (spec.emphasis && !spec.group) {
    add(
      "error",
      "emphasis_without_group",
      "emphasis names a series, but there is no group column, so there is only one series.",
    );
  }

  if (spec.emphasis && spec.series_order && !spec.series_order.includes(spec.emphasis.series)) {
    add(
      "error",
      "emphasis_series_unknown",
      `emphasis.series is "${spec.emphasis.series}", which does not appear in series_order.`,
    );
  }

  if (spec.legend.show && !spec.group && spec.kind !== "heatmap") {
    add(
      "warning",
      "legend_without_group",
      "legend.show is true but there is no group column, so the legend has nothing to list.",
    );
  }

  if (spec.series_order && !spec.group) {
    add("warning", "series_order_without_group", "series_order has no effect without a group column.");
  }

  if (spec.series_order && spec.series_order.length > MAX_LEGIBLE_SERIES) {
    add(
      "warning",
      "too_many_series",
      `${spec.series_order.length} series will not stay distinguishable at column width. ` +
        `Consider faceting, or cutting to ${MAX_LEGIBLE_SERIES}.`,
    );
  }

  if (spec.legend.style === "direct" && !spec.group) {
    add("warning", "direct_labels_without_group", "Direct labelling needs a group to label.");
  }

  if (spec.legend.style === "direct" && hasCategoricalX(spec)) {
    add(
      "warning",
      "direct_labels_on_categories",
      "Direct labelling puts a name at the end of each line. On a categorical chart use a legend.",
    );
  }

  // --- output --------------------------------------------------------------

  if (spec.output.formats.includes("png") && spec.output.dpi < MIN_PUBLICATION_DPI) {
    add(
      "warning",
      "low_dpi_raster",
      `dpi is ${spec.output.dpi}. Most venues want at least ${MIN_PUBLICATION_DPI} for raster figures.`,
    );
  }

  // --- transforms and derived values ---------------------------------------

  const transform = spec.transform;
  if (transform && transform.kind !== "none") {
    const needsBaseline = transform.kind === "delta_vs_baseline" || transform.kind === "percent_of_baseline";
    if (needsBaseline && !transform.baseline) {
      add("error", "transform_needs_baseline", `transform ${transform.kind} needs transform.baseline set.`);
    }
    if (needsBaseline && !spec.group) {
      add(
        "error",
        "transform_needs_group",
        `transform ${transform.kind} compares series, so it needs a group column.`,
      );
    }
    if (
      transform.baseline &&
      spec.series_order &&
      !spec.series_order.includes(transform.baseline)
    ) {
      add(
        "error",
        "baseline_series_unknown",
        `transform.baseline is "${transform.baseline}", which does not appear in series_order.`,
      );
    }
  }

  if (spec.series_from_columns && spec.group) {
    add(
      "error",
      "series_from_columns_conflicts_with_group",
      "series_from_columns creates the grouping column, so group must be left unset.",
    );
  }

  // --- uncertainty ---------------------------------------------------------

  if ("uncertainty" in spec && spec.uncertainty) {
    const aggregation = "aggregation" in spec ? spec.aggregation : "none";
    if (aggregation === "none") {
      add(
        "error",
        "uncertainty_without_aggregation",
        "uncertainty describes the spread around a summary, so set aggregation to mean or median.",
      );
    }
    if (spec.uncertainty.kind === "iqr" && aggregation === "mean") {
      add(
        "warning",
        "iqr_around_a_mean",
        "An interquartile range is a spread around the median. Pair it with aggregation median.",
      );
    }
    if (spec.uncertainty.kind === "std" && aggregation === "median") {
      add(
        "warning",
        "std_around_a_median",
        "A standard deviation is a spread around the mean. Pair it with aggregation mean.",
      );
    }
    if (spec.kind === "bar" && spec.uncertainty.display === "band") {
      add(
        "warning",
        "band_on_categories",
        "A shaded band across categories implies continuity between them. Use display bar.",
      );
    }
  }

  // --- faceting ------------------------------------------------------------

  if (spec.facet) {
    if (spec.facet.by === spec.group) {
      add(
        "error",
        "facet_by_the_group",
        `facet.by and group are both "${spec.facet.by}", which would give every panel one series.`,
      );
    }
    if (spec.facet.columns > MAX_FACET_PANELS_PER_ROW && spec.output.size === "single_column") {
      add(
        "warning",
        "too_many_panels_per_row",
        `${spec.facet.columns} panels across a single column leaves each one very narrow.`,
      );
    }
  }

  // --- annotations and reference lines -------------------------------------

  for (const note of spec.annotate ?? []) {
    if (spec.group && !note.series) {
      add(
        "error",
        "annotation_without_series",
        `The annotation "${note.text}" does not say which series to attach to.`,
      );
    }
    if (note.series && spec.series_order && !spec.series_order.includes(note.series)) {
      add(
        "error",
        "annotation_series_unknown",
        `The annotation "${note.text}" targets "${note.series}", which is not in series_order.`,
      );
    }
    if (note.at === "crossover" && !spec.group) {
      add("error", "crossover_needs_two_series", "A crossover annotation needs at least two series.");
    }
  }

  for (const line of spec.reference_lines ?? []) {
    const axis = line.axis === "x" ? spec.x : spec.y;
    if (axis.scale === "log" && line.value <= 0) {
      add(
        "error",
        "reference_line_off_log_axis",
        `A reference line at ${line.value} cannot sit on the logarithmic ${line.axis} axis.`,
      );
    }
    if (axis.limits && (line.value < axis.limits[0] || line.value > axis.limits[1])) {
      add(
        "warning",
        "reference_line_outside_limits",
        `The reference line at ${line.value} falls outside the ${line.axis} limits, so it will not be visible.`,
      );
    }
  }

  // --- per kind ------------------------------------------------------------

  if (spec.kind === "bar") {
    if (spec.aggregation === "none") {
      add(
        "warning",
        "unaggregated_bar",
        'aggregation is "none", so repeated x values draw overlapping bars instead of a summary. ' +
          "Set mean or median if the data has repeats.",
      );
    }
    if (spec.baseline_zero && spec.y.scale === "log") {
      add(
        "error",
        "log_bar_baseline",
        "baseline_zero is true on a log value axis. A log axis cannot include zero, so pick one.",
      );
    }
    if (spec.stacked && !spec.group) {
      add("error", "stacked_without_group", "Stacking needs a group column to supply the segments.");
    }
    if (spec.stacked && spec.series_order && spec.series_order.length > MAX_STACK_SEGMENTS) {
      add(
        "warning",
        "too_many_stack_segments",
        `${spec.series_order.length} stacked segments cannot be compared by eye. ` +
          "Only the bottom segment shares a baseline.",
      );
    }
    if (spec.stacked && spec.transform?.kind === "delta_vs_baseline") {
      add(
        "error",
        "stacking_signed_values",
        "delta_vs_baseline produces negative values, which cannot be stacked meaningfully.",
      );
    }
    if (spec.significance && !spec.uncertainty) {
      add(
        "warning",
        "significance_without_uncertainty",
        "Marking significance without showing spread asks the reader to trust the test blindly.",
      );
    }
    if (spec.sort && spec.category_order) {
      add("warning", "sort_overrides_category_order", "category_order is ignored when sort is set.");
    }
  }

  if (spec.kind === "scatter" && spec.trendline === "linear") {
    if (spec.x.scale !== "linear" || spec.y.scale !== "linear") {
      add(
        "warning",
        "trendline_on_log_axis",
        "A linear trendline is fitted in linear space but an axis is not linear, so the drawn " +
          "line is not the fit a reader expects.",
      );
    }
  }

  if (spec.kind === "line") {
    if (spec.y2) {
      add(
        "warning",
        "dual_axis_in_use",
        "Two independently scaled y axes can make any pair of series look related. " +
          `Stated justification: ${spec.y2.justification}`,
      );
      if (spec.group) {
        add(
          "error",
          "dual_axis_with_group",
          "A second axis plus multiple series makes it impossible to tell which line uses which scale.",
        );
      }
    }
    if (spec.smooth && spec.aggregation === "none" && !spec.group) {
      add(
        "warning",
        "smoothing_raw_repeats",
        "Smoothing before collapsing repeated x values smooths across the repeats too. " +
          "Set aggregation first.",
      );
    }
  }

  if (spec.kind === "heatmap" && spec.diverging && spec.aggregation === "count") {
    add(
      "error",
      "diverging_counts",
      "A diverging scale centres on zero, but counts cannot be negative. Use the default scale.",
    );
  }

  // --- animation -----------------------------------------------------------

  if (spec.animate) {
    if (spec.output.formats.includes("pdf") || spec.output.formats.includes("svg")) {
      add(
        "warning",
        "animation_with_vector_output",
        "An animation is written alongside the stills. The vector exports stay static.",
      );
    }
    if (spec.animate.style === "trace" && hasCategoricalX(spec)) {
      add(
        "warning",
        "trace_on_categories",
        'The "trace" style follows a continuous x. On a categorical chart use "grow" or "reveal".',
      );
    }
    if (spec.animate.style === "grow" && spec.kind !== "bar") {
      add("warning", "grow_outside_bars", 'The "grow" style raises bars. Use "draw" or "reveal" here.');
    }
  }

  return findings;
}

export function hasErrors(findings: Finding[]): boolean {
  return findings.some((f) => f.severity === "error");
}
