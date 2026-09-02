import type { FigureSpec } from "./schema.ts";

/**
 * Checks that need only the spec, no rendering.
 *
 * An error means the script will fail or the figure will misrepresent the data.
 * A warning means it will run and be wrong for a reviewer rather than wrong for
 * the maths. Anything that needs pixels, such as overlapping tick labels or a
 * clipped legend, is out of scope here and belongs to a render-time checker.
 */

export type Severity = "error" | "warning";

export type Finding = {
  severity: Severity;
  code: string;
  message: string;
};

const MAX_LEGIBLE_SERIES = 8;
const MIN_PUBLICATION_DPI = 300;

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

  const columns = spec.data.columns;
  if (columns) {
    const known = new Set(columns);
    const refs: [string, string][] = [
      ["x.field", spec.x.field],
      ["y.field", spec.y.field],
    ];
    if (spec.group) refs.push(["group", spec.group]);

    for (const [where, field] of refs) {
      if (!known.has(field)) {
        add("error", "unknown_field", `${where} refers to "${field}", which is not in data.columns.`);
      }
    }
  }

  if (spec.emphasis && !spec.group) {
    add(
      "error",
      "emphasis_without_group",
      "emphasis names a series, but there is no group column, so there is only one series to emphasise.",
    );
  }

  if (spec.emphasis && spec.series_order && !spec.series_order.includes(spec.emphasis.series)) {
    add(
      "error",
      "emphasis_series_unknown",
      `emphasis.series is "${spec.emphasis.series}", which does not appear in series_order.`,
    );
  }

  if (spec.legend.show && !spec.group) {
    add(
      "warning",
      "legend_without_group",
      "legend.show is true but there is no group column, so the legend would have nothing to list.",
    );
  }

  if (spec.series_order && !spec.group) {
    add("warning", "series_order_without_group", "series_order has no effect without a group column.");
  }

  if (spec.series_order && spec.series_order.length > MAX_LEGIBLE_SERIES) {
    add(
      "warning",
      "too_many_series",
      `${spec.series_order.length} series will not stay distinguishable at column width. Consider faceting or cutting to ${MAX_LEGIBLE_SERIES}.`,
    );
  }

  if (spec.output.formats.includes("png") && spec.output.dpi < MIN_PUBLICATION_DPI) {
    add(
      "warning",
      "low_dpi_raster",
      `dpi is ${spec.output.dpi}. Most venues want at least ${MIN_PUBLICATION_DPI} for raster figures.`,
    );
  }

  if (spec.kind === "bar") {
    if (spec.aggregation === "none") {
      add(
        "warning",
        "unaggregated_bar",
        "aggregation is \"none\", so repeated x values will draw overlapping bars instead of a summary. Set mean or median if the data has repeats.",
      );
    }
    // The y field always carries the measured value; orientation only moves it.
    if (spec.baseline_zero && spec.y.scale === "log") {
      add(
        "error",
        "log_bar_baseline",
        "baseline_zero is true on a log value axis. A log axis cannot include zero, so pick one or the other.",
      );
    }
  }

  if (spec.kind === "scatter" && spec.trendline === "linear") {
    if (spec.x.scale === "log" || spec.y.scale === "log") {
      add(
        "warning",
        "trendline_on_log_axis",
        "A linear trendline is fitted in linear space but at least one axis is logarithmic, so the drawn line will not be the fit a reader expects.",
      );
    }
  }

  return findings;
}

export function hasErrors(findings: Finding[]): boolean {
  return findings.some((f) => f.severity === "error");
}
