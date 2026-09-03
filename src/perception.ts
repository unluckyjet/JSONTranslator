import type { FigureSpec } from "./schema.ts";

/**
 * How accurately a reader can decode each visual channel, and what that costs.
 *
 * Cleveland and McGill ranked the elementary perceptual tasks by accuracy:
 * position on a common scale, then position on non-aligned scales, length,
 * direction, angle, slope, area, volume, shading, and saturation. Position
 * measured 1.4 to 2.5 times more accurate than length and 1.96 times more
 * accurate than angle.
 *
 * That ranking is why a grouped bar beats a stacked one for comparison, and why
 * a heatmap is a poor way to compare two specific cells. Encoding it here means
 * the tool can say what a different choice would buy, with a number attached,
 * instead of asserting a preference.
 */

export type Channel =
  | "position_common"
  | "position_nonaligned"
  | "length"
  | "direction"
  | "angle"
  | "slope"
  | "area"
  | "volume"
  | "shading"
  | "saturation";

/** Rank 1 is the most accurately decoded. */
export const CHANNEL_RANK: Record<Channel, number> = {
  position_common: 1,
  position_nonaligned: 2,
  length: 3,
  direction: 4,
  angle: 5,
  slope: 6,
  area: 7,
  volume: 8,
  shading: 9,
  saturation: 10,
};

export const CHANNEL_NAME: Record<Channel, string> = {
  position_common: "position on a common scale",
  position_nonaligned: "position on separate scales",
  length: "length",
  direction: "direction",
  angle: "angle",
  slope: "slope",
  area: "area",
  volume: "volume",
  shading: "shading",
  saturation: "colour saturation",
};

/**
 * Measured accuracy ratios from the original study, used so a suggestion can
 * quantify what it is offering rather than asserting that one is better.
 */
export const ACCURACY_AGAINST_POSITION: Partial<Record<Channel, string>> = {
  length: "1.4 to 2.5 times",
  angle: "about 1.96 times",
};

/** Which channel carries the quantity a reader is meant to compare. */
export function primaryChannel(spec: FigureSpec): Channel {
  switch (spec.kind) {
    case "line":
    case "scatter":
      return "position_common";
    case "bar":
      // A grouped bar shares a baseline, so length and position agree. Stacked
      // segments above the first float, and only length is left to read.
      return spec.stacked ? "length" : "position_common";
    case "box":
    case "violin":
    case "raincloud":
      return "position_common";
    case "ecdf":
      // Both axes are position, and the cumulative axis needs no bin choice,
      // so nothing about the encoding is left to an author's discretion.
      return "position_common";
    case "ridgeline":
      // Rows share a baseline only with their own neighbour, so a reader
      // compares along an unaligned scale.
      return "position_nonaligned";
    case "heatmap":
      return "shading";
    case "table":
      // A printed number is exact rather than estimated, so it sits above every
      // graphical channel for reading one value.
      return "position_common";
  }
}

export type Suggestion = {
  code: string;
  message: string;
  /** A JSON patch an agent can apply without re-deriving the fix. */
  patch?: Record<string, unknown>;
};

/**
 * What a different encoding would buy, where the literature supports a number.
 *
 * These are suggestions rather than errors. A stacked bar is the right answer
 * when the question is about the total, and the point here is to make sure the
 * choice was made rather than defaulted into.
 */
export function encodingSuggestions(spec: FigureSpec): Suggestion[] {
  const out: Suggestion[] = [];

  if (spec.kind === "bar" && spec.stacked) {
    out.push({
      code: "stacked_costs_a_baseline",
      message:
        "Only the bottom segment of a stacked bar sits on a shared baseline. Every segment above " +
        "it is read by length alone, which measures 1.4 to 2.5 times less accurate than position. " +
        "Keep stacking if the question is about the total, and set stacked false if it is about " +
        "comparing the parts.",
      patch: { stacked: false },
    });
  }

  if (spec.kind === "heatmap" && !spec.annotate_cells) {
    out.push({
      code: "shading_is_the_weakest_channel",
      message:
        "A heatmap encodes value as shading, which sits near the bottom of the accuracy ranking. " +
        "Setting annotate_cells true prints the number in each cell, so a reader who needs an " +
        "exact value is not estimating it from colour.",
      patch: { annotate_cells: true },
    });
  }

  if (spec.kind === "line" && !spec.group && spec.aggregation === "none") {
    out.push({
      code: "line_implies_continuity",
      message:
        "A line asserts that the space between two x values means something. If x is a set of " +
        "unordered categories, a bar chart makes the same comparison without that claim. " +
        "Only the author can tell, so this one carries no automatic fix.",
      // Deliberately no patch. The spec carries column names, not column types,
      // so nothing here can tell an ordered x from an unordered one. Patching
      // kind to "bar" on that guess turns a year of daily prices into 252 bars.
    });
  }

  // Faceting already answers this, so the suggestion must not survive its own fix.
  if (spec.kind === "bar" && spec.group && !spec.stacked && !spec.facet) {
    const series = spec.series_order?.length ?? 0;
    if (series > 4) {
      out.push({
        code: "too_many_bars_per_group",
        message:
          `${series} bars per category makes each one narrow and pushes neighbouring groups ` +
          "together. Faceting gives every series its own panel and keeps the shared baseline.",
        patch: { facet: { by: spec.x.field } },
      });
    }
  }

  return out;
}

/**
 * A cost for a whole spec, so two candidate designs can be ranked.
 *
 * This is the shape Draco uses: hard constraints reject, soft constraints carry
 * weights, and the design with the lowest total is preferred. The weights here
 * are hand-set from the perception ranking rather than learned, which is the
 * obvious next step once there is a corpus of accepted figures to learn from.
 */
export const SOFT_WEIGHTS = {
  weak_primary_channel: 6,
  stacked_comparison: 5,
  many_series: 3,
  many_stack_segments: 4,
  unaggregated_repeats: 4,
  no_uncertainty_over_repeats: 5,
  missing_units: 2,
  no_emphasis_with_many_series: 1,
  dense_categories: 2,
} as const;

export function designCost(spec: FigureSpec): { total: number; reasons: string[] } {
  const reasons: string[] = [];
  let total = 0;
  const charge = (weight: number, why: string) => {
    total += weight;
    reasons.push(`${weight} ${why}`);
  };

  const channel = primaryChannel(spec);
  if (CHANNEL_RANK[channel] > 3) {
    charge(SOFT_WEIGHTS.weak_primary_channel, `the quantity is read by ${CHANNEL_NAME[channel]}`);
  }

  if (spec.kind === "bar" && spec.stacked) {
    charge(SOFT_WEIGHTS.stacked_comparison, "stacked segments do not share a baseline");
    const segments = spec.series_order?.length ?? 0;
    if (segments > 4) charge(SOFT_WEIGHTS.many_stack_segments, `${segments} stacked segments`);
  }

  const series = spec.series_order?.length ?? 0;
  if (series > 6) charge(SOFT_WEIGHTS.many_series, `${series} series on one axes`);
  if (series > 4 && !spec.emphasis) {
    charge(SOFT_WEIGHTS.no_emphasis_with_many_series, "many series and none foregrounded");
  }

  if ("aggregation" in spec && spec.aggregation === "none") {
    charge(SOFT_WEIGHTS.unaggregated_repeats, "repeated x values are not summarised");
  }

  if ("uncertainty" in spec && "aggregation" in spec) {
    if (spec.aggregation !== "none" && !spec.uncertainty) {
      charge(SOFT_WEIGHTS.no_uncertainty_over_repeats, "a summary is shown with no spread");
    }
  }

  if (!spec.y.unit && spec.kind !== "heatmap") {
    charge(SOFT_WEIGHTS.missing_units, "the y axis carries no unit");
  }

  return { total, reasons };
}
