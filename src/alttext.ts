import type { FigureSpec } from "./schema.ts";

/**
 * Alternative text, built from the four-level semantic model in the
 * accessibility literature.
 *
 *   1. the encoding and the axes
 *   2. statistics computed from the data
 *   3. trends and comparisons
 *   4. context a human has to supply
 *
 * Levels 1 to 3 are derivable. The spec knows the encoding, and the script has
 * the data, so most of this writes itself. Level 4 is deliberately left blank
 * rather than invented, because guessing at why a result matters is exactly the
 * kind of confident fabrication that gets figures retracted.
 *
 * Two conventions come straight from the guidance. Alt text does not repeat the
 * caption, and it never opens with "this figure shows", because a screen reader
 * has already announced that it is reading an image.
 */

const KIND_PHRASING: Record<FigureSpec["kind"], string> = {
  line: "Line chart",
  scatter: "Scatter plot",
  bar: "Bar chart",
  box: "Box plot",
  violin: "Violin plot",
  heatmap: "Heatmap",
  table: "Table",
};

function axisPhrase(label: string, unit?: string): string {
  return unit ? `${label} in ${unit}` : label;
}

/** Level 1, which needs only the spec. */
export function encodingSentence(spec: FigureSpec): string {
  const kind = KIND_PHRASING[spec.kind];
  const parts: string[] = [];

  if (spec.kind === "table") {
    parts.push(
      `${kind} of ${axisPhrase(spec.y.label, spec.y.unit)}, one row per ${spec.x.label.toLowerCase()}`,
    );
  } else if (spec.kind === "heatmap") {
    parts.push(
      `${kind} of ${spec.value_label.toLowerCase()}, with ${axisPhrase(spec.x.label, spec.x.unit)} ` +
        `across the horizontal axis and ${axisPhrase(spec.y.label, spec.y.unit)} down the vertical axis`,
    );
  } else if (spec.kind === "bar" && spec.orientation === "horizontal") {
    parts.push(
      `${kind} with ${axisPhrase(spec.y.label, spec.y.unit)} along the horizontal axis and ` +
        `${spec.x.label} listed down the vertical axis`,
    );
  } else {
    parts.push(
      `${kind} of ${axisPhrase(spec.y.label, spec.y.unit)} against ` +
        `${axisPhrase(spec.x.label, spec.x.unit)}`,
    );
  }

  if (spec.group) {
    parts.push(
      spec.series_order
        ? `one series per ${spec.group}, being ${spec.series_order.join(", ")}`
        : `one series per ${spec.group}`,
    );
  }

  for (const [name, axis] of [
    ["horizontal", spec.x],
    ["vertical", spec.y],
  ] as const) {
    if (axis.scale === "log") parts.push(`the ${name} axis is logarithmic`);
    if (axis.scale === "symlog") parts.push(`the ${name} axis is symmetric logarithmic`);
  }

  if ("uncertainty" in spec && spec.uncertainty) {
    const wording =
      spec.uncertainty.kind === "ci"
        ? `${Math.round(spec.uncertainty.level * 100)} percent confidence intervals`
        : spec.uncertainty.kind === "sem"
          ? "standard errors"
          : spec.uncertainty.kind === "std"
            ? "standard deviations"
            : spec.uncertainty.kind === "iqr"
              ? "interquartile ranges"
              : "full ranges";
    parts.push(
      spec.uncertainty.display === "band" ? `shaded ${wording}` : `${wording} as error bars`,
    );
  }

  if (spec.emphasis) parts.push(`${spec.emphasis.series} is drawn in the foreground`);

  for (const line of spec.reference_lines ?? []) {
    parts.push(
      `a ${line.meaning === "other" ? "reference" : line.meaning} line at ${line.value}` +
        (line.label ? ` labelled ${line.label}` : ""),
    );
  }

  if (spec.facet) parts.push(`split into one panel per ${spec.facet.by}`);

  // Each clause becomes its own sentence, so a screen reader pauses between them.
  return parts.map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(". ") + ".";
}

/**
 * Levels 2 and 3, which need the data, so they are computed by the script.
 * The emitted function returns a sentence, not a paragraph.
 */
export function emitAltText(spec: FigureSpec, out: string[]): void {
  const grouped = Boolean(spec.group) && spec.kind !== "heatmap";

  out.push(
    "",
    "def describe_figure(frame):",
    '    """Levels 2 and 3 of the alt text: the numbers and the trend."""',
    "    parts = []",
  );

  if (spec.kind === "heatmap") {
    out.push(
      "    values = frame[VALUE_FIELD].dropna()",
      "    if len(values):",
      "        peak = frame.loc[frame[VALUE_FIELD].idxmax()]",
      '        parts.append(f"Values run from {values.min():.3g} to {values.max():.3g}")',
      "        parts.append(",
      '            f"the largest is {peak[VALUE_FIELD]:.3g} at {peak[X_FIELD]}, {peak[Y_FIELD]}"',
      "        )",
    );
  } else if (grouped) {
    out.push(
      "    ends = {}",
      "    for name in series_names(frame):",
      "        block = frame[frame[GROUP] == name].dropna(subset=[Y_FIELD]).sort_values(X_FIELD)",
      "        if len(block):",
      "            ends[name] = (float(block[Y_FIELD].iloc[-1]), float(block[Y_FIELD].mean()))",
      "    if ends:",
      "        ranked = sorted(ends.items(), key=lambda kv: -kv[1][0])",
      "        best, worst = ranked[0], ranked[-1]",
      "        parts.append(",
      '            f"At the largest {X_LABEL_PLAIN}, {best[0]} is highest at {best[1][0]:.3g} "',
      '            f"and {worst[0]} is lowest at {worst[1][0]:.3g}"',
      "        )",
      "        if len(ranked) > 1:",
      "            spread = best[1][0] - worst[1][0]",
      '            parts.append(f"a spread of {spread:.3g}")',
    );
  } else {
    out.push(
      "    values = frame[Y_FIELD].dropna()",
      "    if len(values):",
      '        parts.append(f"Values run from {values.min():.3g} to {values.max():.3g}")',
      '        parts.append(f"the mean is {values.mean():.3g}")',
    );
  }

  out.push(
    "    if not parts:",
    '        return ""',
    "    # Every clause is its own sentence, so a screen reader pauses between them.",
    '    return ". ".join(part[:1].upper() + part[1:] for part in parts) + "."',
    "",
    "",
    "def alt_text(frame):",
    "    detail = describe_figure(frame)",
    '    body = ENCODING_SENTENCE + (f" {detail}" if detail else "")',
    "    for claim in CLAIMS:",
    '        if claim.get("_verdict") is not True:',
    "            continue",
    '        wording = claim["wording"].replace("{reference}", str(claim.get("reference")))',
    '        sentence = f"{claim[\'subject\']} {wording}"',
    '        body += " " + sentence[:1].upper() + sentence[1:] + "."',
    "    return body",
    "",
  );
}
