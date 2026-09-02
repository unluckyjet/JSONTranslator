import { z } from "zod";

/**
 * What an agent is allowed to say about a figure.
 *
 * The rule this schema enforces is that a spec describes what the figure means,
 * never how matplotlib should draw it. There is no line width, no hex colour,
 * no font size, no margin. Those belong to the emitter, which owns every
 * presentation decision so that two figures in the same paper agree.
 */

export const AxisSpec = z.object({
  field: z.string().min(1).describe("Column name in the data file."),
  label: z.string().min(1).describe("Axis label as it should read in the paper."),
  unit: z
    .string()
    .min(1)
    .optional()
    .describe('Unit appended to the label in parentheses, such as "%" or "ms".'),
  scale: z.enum(["linear", "log"]).default("linear"),
  limits: z
    .tuple([z.number(), z.number()])
    .optional()
    .describe("Explicit [lower, upper] bounds. Set these only when the science requires them."),
});
export type AxisSpec = z.infer<typeof AxisSpec>;

export const LegendSpec = z.object({
  show: z.boolean().default(true),
  position: z
    .enum([
      "best",
      "upper_left",
      "upper_right",
      "lower_left",
      "lower_right",
      "outside_right",
      "outside_bottom",
    ])
    .default("best"),
  title: z.string().min(1).optional(),
});

export const OutputSpec = z.object({
  size: z
    .enum(["single_column", "double_column"])
    .default("single_column")
    .describe("Target width in the manuscript. The emitter picks the actual figure size."),
  formats: z.array(z.enum(["png", "svg", "pdf"])).min(1).default(["png", "svg", "pdf"]),
  dpi: z.number().int().min(72).max(1200).default(600).describe("Raster export density."),
  stem: z.string().min(1).default("figure").describe("Output filename without extension."),
});

export const StyleSpec = z.object({
  preset: z.enum(["paper", "paper_compact"]).default("paper"),
  grid: z.boolean().default(false),
  despine: z.boolean().default(true),
});

export const DataSpec = z.object({
  path: z.string().min(1).default("results.csv").describe("Path the generated script reads."),
  format: z.enum(["csv", "parquet", "json"]).default("csv"),
  columns: z
    .array(z.string().min(1))
    .optional()
    .describe(
      "Columns the file is known to contain. Supply this and every field reference gets checked.",
    ),
});

export const EmphasisSpec = z.object({
  series: z.string().min(1).describe("The one series to foreground. Others are muted."),
});

const base = {
  title: z.string().min(1).optional(),
  group: z.string().min(1).optional().describe("Column that splits the data into series."),
  series_order: z
    .array(z.string().min(1))
    .min(1)
    .optional()
    .describe("Explicit series order. Fixes colour assignment across figures in one paper."),
  emphasis: EmphasisSpec.optional(),
  legend: LegendSpec.prefault({}),
  output: OutputSpec.prefault({}),
  style: StyleSpec.prefault({}),
  data: DataSpec.prefault({}),
};

const xy = { ...base, x: AxisSpec, y: AxisSpec };

export const LineSpec = z.object({
  ...xy,
  kind: z.literal("line"),
  marker: z.boolean().default(false),
  sort_x: z.boolean().default(true),
  aggregation: z
    .enum(["none", "mean", "median"])
    .default("none")
    .describe(
      "How to collapse repeated x values within a series. A curve over several seeds wants mean.",
    ),
});

export const ScatterSpec = z.object({
  ...xy,
  kind: z.literal("scatter"),
  trendline: z.enum(["none", "linear"]).default("none"),
});

export const BarSpec = z.object({
  ...xy,
  kind: z.literal("bar"),
  orientation: z.enum(["vertical", "horizontal"]).default("vertical"),
  aggregation: z.enum(["none", "mean", "median", "sum", "count"]).default("none"),
  baseline_zero: z.boolean().default(true),
});

export const FigureSpec = z.discriminatedUnion("kind", [LineSpec, ScatterSpec, BarSpec]);
export type FigureSpec = z.infer<typeof FigureSpec>;

export type FigureKind = FigureSpec["kind"];
