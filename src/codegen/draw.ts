import type { FigureSpec, PlottedSpec } from "../schema.ts";
import { pyStr } from "./py.ts";
import { BAND_ALPHA, PRESETS, RAW_ALPHA } from "./theme.ts";
import { needsMissingIntervalReport } from "./data.ts";

/**
 * One `draw_panel` function per chart kind.
 *
 * Every one takes an axes and the rows for that panel, so faceting is just
 * calling the same function once per panel. Nothing here reads the spec at
 * runtime; the constants it needs were emitted into the preamble.
 */

export function emitSeriesHelpers(spec: FigureSpec, out: string[]): void {
  if (spec.kind === "heatmap" || !spec.group) return;

  const preset = PRESETS[spec.style.preset];
  const scatter = spec.kind === "scatter";
  const sizes = scatter ? preset.marker : preset.line;
  const key = scatter ? "size" : "width";
  const channelConst =
    scatter ? "MARKERS" : spec.kind === "line" ? "LINE_STYLES" : "HATCHES";
  const channelKey = scatter ? "marker" : spec.kind === "line" ? "linestyle" : "hatch";
  const plain = scatter ? pyStr("o") : spec.kind === "line" ? pyStr("-") : pyStr("");

  out.push(
    "",
    "def locked_appearance(names):",
    "    # A shared lock keeps a model the same colour in figure 1 and figure 7.",
    "    if PALETTE_LOCK is None:",
    "        return None",
    "    try:",
    "        from graphunslopify.lockfile import appearance",
    "    except ImportError:",
    '        print("graphunslopify is not installed, so palette_lock was ignored")',
    "        return None",
    "    return appearance(PALETTE_LOCK, [str(n) for n in names])",
    "",
    "",
    "def series_names(frame):",
    "    if SERIES_ORDER is not None:",
    "        return [n for n in SERIES_ORDER if n in set(frame[GROUP])] or list(SERIES_ORDER)",
    "    return sorted(frame[GROUP].dropna().unique().tolist(), key=str)",
    "",
    "",
    "def series_style(name, index, total):",
    "    locked = LOCKED.get(str(name)) if LOCKED else None",
    "    colour = locked[\"colour\"] if locked else PALETTE[index % len(PALETTE)]",
    "    # Colour alone is not enough in greyscale, so add a second channel.",
    "    if total <= SECOND_CHANNEL_THRESHOLD:",
    `        channel = ${plain}`,
    "    elif EMPHASIS is None:",
    `        channel = ${channelConst}[index % len(${channelConst})]`,
    "    else:",
    "        # The emphasised series keeps the plain form, so the others must skip",
    "        # it. Without this, series zero is also plain and the two collide.",
    `        rest = ${channelConst}[1:] or ${channelConst}`,
    "        channel = rest[index % len(rest)]",
    "    if locked and total > SECOND_CHANNEL_THRESHOLD:",
    `        channel = locked[${pyStr(channelKey)}]`,
    "    if name == EMPHASIS:",
    `        channel = ${plain}`,
    "    if EMPHASIS is None:",
    `        style = {"colour": colour, ${pyStr(key)}: ${sizes.base}, "alpha": 1.0, "zorder": 2}`,
    "    elif name == EMPHASIS:",
    `        style = {"colour": colour, ${pyStr(key)}: ${sizes.emphasis}, "alpha": 1.0, "zorder": 3}`,
    "    else:",
    `        style = {"colour": colour, ${pyStr(key)}: ${sizes.muted}, "alpha": RECEDED_ALPHA, "zorder": 1}`,
    `    style[${pyStr(channelKey)}] = channel`,
    "    return style",
    "",
  );
}

function emitCategories(spec: FigureSpec, out: string[]): void {
  const sortable = spec.kind === "bar" || spec.kind === "box";
  out.push(
    "",
    "def category_order(frame):",
    "    if CATEGORY_ORDER is not None:",
    "        return [c for c in CATEGORY_ORDER if c in set(frame[X_FIELD])]",
  );
  if (sortable && "sort" in spec && spec.sort?.by === "value") {
    const ascending = spec.sort.direction === "asc" ? "True" : "False";
    out.push(
      "    ranked = frame.groupby(X_FIELD, sort=False)[Y_FIELD].mean()",
      `    return list(ranked.sort_values(ascending=${ascending}).index)`,
    );
  } else if (sortable && "sort" in spec && spec.sort?.by === "category") {
    const reverse = spec.sort.direction === "desc" ? "True" : "False";
    out.push(
      `    return sorted(dict.fromkeys(frame[X_FIELD].tolist()), key=str, reverse=${reverse})`,
    );
  } else {
    out.push("    return list(dict.fromkeys(frame[X_FIELD].tolist()))");
  }
  out.push("");
}

function emitLine(spec: FigureSpec & { kind: "line" }, out: string[]): void {
  const preset = PRESETS[spec.style.preset];
  const band = spec.uncertainty?.display === "band";

  out.push("", "def draw_panel(ax, df):", "    frame = summarise(df)");
  if (needsMissingIntervalReport(spec)) out.push("    note_missing_interval(frame)");

  const plot = (indentLevel: string, source: string, styleExpr: string, label: string) => {
    const lines: string[] = [];
    if (spec.smooth?.show_raw) {
      lines.push(
        `${indentLevel}ax.plot(`,
        `${indentLevel}    ${source}[X_FIELD],`,
        `${indentLevel}    ${source}[Y_FIELD],`,
        `${indentLevel}    color=${styleExpr}["colour"],`,
        `${indentLevel}    linewidth=${styleExpr}["width"] * 0.8,`,
        `${indentLevel}    alpha=RAW_ALPHA,`,
        `${indentLevel}    zorder=${styleExpr}["zorder"] - 1,`,
        `${indentLevel})`,
      );
    }
    const values = spec.smooth ? `smooth(${source}[Y_FIELD])` : `${source}[Y_FIELD]`;
    lines.push(
      `${indentLevel}ax.plot(`,
      `${indentLevel}    ${source}[X_FIELD],`,
      `${indentLevel}    ${values},`,
      label ? `${indentLevel}    label=${label},` : `${indentLevel}    label=None,`,
      `${indentLevel}    color=${styleExpr}["colour"],`,
      `${indentLevel}    linewidth=${styleExpr}["width"],`,
      `${indentLevel}    alpha=${styleExpr}["alpha"],`,
      `${indentLevel}    zorder=${styleExpr}["zorder"],`,
      `${indentLevel}    linestyle=${styleExpr}["linestyle"],`,
    );
    if (spec.marker) lines.push(`${indentLevel}    marker="o",`);
    lines.push(`${indentLevel})`);
    if (spec.uncertainty && band) {
      lines.push(
        `${indentLevel}if "_low" in ${source}:`,
        `${indentLevel}    ax.fill_between(`,
        `${indentLevel}        ${source}[X_FIELD],`,
        `${indentLevel}        ${source}["_low"],`,
        `${indentLevel}        ${source}["_high"],`,
        `${indentLevel}        color=${styleExpr}["colour"],`,
        `${indentLevel}        alpha=BAND_ALPHA,`,
        `${indentLevel}        linewidth=0,`,
        `${indentLevel}        zorder=${styleExpr}["zorder"] - 1,`,
        `${indentLevel}    )`,
      );
    } else if (spec.uncertainty) {
      lines.push(
        `${indentLevel}if "_low" in ${source}:`,
        `${indentLevel}    ax.errorbar(`,
        `${indentLevel}        ${source}[X_FIELD],`,
        `${indentLevel}        ${source}[Y_FIELD],`,
        `${indentLevel}        yerr=[`,
        `${indentLevel}            ${source}[Y_FIELD] - ${source}["_low"],`,
        `${indentLevel}            ${source}["_high"] - ${source}[Y_FIELD],`,
        `${indentLevel}        ],`,
        `${indentLevel}        fmt="none",`,
        `${indentLevel}        ecolor=${styleExpr}["colour"],`,
        `${indentLevel}        elinewidth=0.9,`,
        `${indentLevel}        capsize=2,`,
        `${indentLevel}        zorder=${styleExpr}["zorder"],`,
        `${indentLevel}    )`,
      );
    }
    return lines;
  };

  if (spec.group) {
    out.push("    names = series_names(frame)", "    for index, name in enumerate(names):");
    out.push("        block = frame[frame[GROUP] == name]");
    if (spec.sort_x) out.push("        block = block.sort_values(X_FIELD)");
    out.push("        style = series_style(name, index, len(names))");
    out.push(...plot("        ", "block", "style", "str(name)"));
  } else {
    out.push("    block = frame");
    if (spec.sort_x) out.push("    block = block.sort_values(X_FIELD)");
    out.push(
      `    style = {"colour": PALETTE[0], "width": ${preset.line.base}, "alpha": 1.0, "zorder": 2, "linestyle": "-"}`,
    );
    out.push(...plot("    ", "block", "style", ""));
  }

  if (spec.y2) {
    out.push(
      "    twin = ax.twinx()",
      "    second = df.sort_values(X_FIELD)",
      "    twin.plot(",
      "        second[X_FIELD],",
      "        second[Y2_FIELD],",
      "        color=PALETTE[1],",
      `        linewidth=${preset.line.base},`,
      '        linestyle="--",',
      "        zorder=1,",
      "    )",
      "    twin.set_ylabel(Y2_LABEL, color=PALETTE[1])",
      '    twin.tick_params(axis="y", labelcolor=PALETTE[1])',
      `    twin.set_yscale(${pyStr(spec.y2.scale)})`,
      "    ax._gu_twin = twin",
    );
  }
  out.push("");
}

function emitScatter(spec: FigureSpec & { kind: "scatter" }, out: string[]): void {
  const preset = PRESETS[spec.style.preset];
  out.push("", "def draw_panel(ax, df):", "    frame = df");

  const body = (level: string, source: string, styleExpr: string, label: string) => [
    `${level}ax.scatter(`,
    `${level}    ${source}[X_FIELD],`,
    `${level}    ${source}[Y_FIELD],`,
    label ? `${level}    label=${label},` : `${level}    label=None,`,
    `${level}    color=${styleExpr}["colour"],`,
    `${level}    s=${styleExpr}["size"],`,
    `${level}    alpha=${styleExpr}["alpha"],`,
    `${level}    zorder=${styleExpr}["zorder"],`,
    `${level}    marker=${styleExpr}["marker"],`,
    `${level})`,
  ];

  if (spec.group) {
    out.push(
      "    names = series_names(frame)",
      "    for index, name in enumerate(names):",
      "        block = frame[frame[GROUP] == name]",
      "        style = series_style(name, index, len(names))",
      ...body("        ", "block", "style", "str(name)"),
    );
    if (spec.trendline === "linear") {
      out.push('        add_trendline(ax, block[X_FIELD], block[Y_FIELD], style["colour"])');
    }
  } else {
    out.push(
      `    style = {"colour": PALETTE[0], "size": ${preset.marker.base}, "alpha": 1.0, "zorder": 2, "marker": "o"}`,
      ...body("    ", "frame", "style", ""),
    );
    if (spec.trendline === "linear") {
      out.push("    add_trendline(ax, frame[X_FIELD], frame[Y_FIELD], PALETTE[0])");
    }
  }

  if (spec.frontier) out.push("    draw_frontier(ax, frame)");
  out.push("");
}

function emitBar(spec: FigureSpec & { kind: "bar" }, out: string[]): void {
  const vertical = spec.orientation === "vertical";
  const plot = vertical ? "bar" : "barh";
  const tick = vertical ? "x" : "y";
  const errKey = vertical ? "yerr" : "xerr";

  out.push(
    "",
    "def draw_panel(ax, df):",
    "    frame = summarise(df)",
    ...(needsMissingIntervalReport(spec) ? ["    note_missing_interval(frame)"] : []),
    "    categories = category_order(frame)",
    "    positions = np.arange(len(categories))",
  );

  if (spec.group && spec.stacked) {
    out.push(
      "    names = series_names(frame)",
      "    running = np.zeros(len(categories))",
      "    for index, name in enumerate(names):",
      "        block = frame[frame[GROUP] == name].set_index(X_FIELD).reindex(categories)",
      "        values = np.nan_to_num(block[Y_FIELD].to_numpy(dtype=float))",
      "        style = series_style(name, index, len(names))",
      `        ax.${plot}(`,
      "            positions,",
      "            values,",
      "            0.72,",
      vertical ? "            bottom=running," : "            left=running,",
      "            label=str(name),",
      '            color=style["colour"],',
      '            alpha=style["alpha"],',
      '            zorder=style["zorder"],',
      '            hatch=style["hatch"],',
      '            edgecolor="white",',
      "            linewidth=0.0,",
      "        )",
      "        running = running + values",
    );
  } else if (spec.group) {
    out.push(
      "    names = series_names(frame)",
      "    width = 0.8 / max(len(names), 1)",
      "    for index, name in enumerate(names):",
      "        block = frame[frame[GROUP] == name].set_index(X_FIELD).reindex(categories)",
      "        offset = (index - (len(names) - 1) / 2) * width",
      "        style = series_style(name, index, len(names))",
      `        ax.${plot}(`,
      "            positions + offset,",
      "            block[Y_FIELD].to_numpy(dtype=float),",
      "            width,",
      "            label=str(name),",
      '            color=style["colour"],',
      '            alpha=style["alpha"],',
      '            zorder=style["zorder"],',
      '            hatch=style["hatch"],',
      '            edgecolor="white",',
      "            linewidth=0.0,",
      spec.uncertainty
        ? `            ${errKey}=error_pair(block),`
        : "",
      spec.uncertainty ? '            ecolor="#404040",' : "",
      spec.uncertainty ? "            capsize=2," : "",
      "        )",
    );
    if (spec.value_labels) out.push("        label_bars(ax, block[Y_FIELD], positions + offset)");
  } else {
    out.push(
      "    block = frame.set_index(X_FIELD).reindex(categories)",
      `    ax.${plot}(`,
      "        positions,",
      "        block[Y_FIELD].to_numpy(dtype=float),",
      "        0.7,",
      "        color=PALETTE[0],",
      "        zorder=2,",
      spec.uncertainty ? `        ${errKey}=error_pair(block),` : "",
      spec.uncertainty ? '        ecolor="#404040",' : "",
      spec.uncertainty ? "        capsize=2," : "",
      "    )",
    );
    if (spec.value_labels) out.push("    label_bars(ax, block[Y_FIELD], positions)");
  }

  out.push(
    `    ax.set_${tick}ticks(positions)`,
    `    ax.set_${tick}ticklabels([str(value) for value in categories])`,
  );
  if (!vertical) {
    out.push(
      "    # barh puts the first category at the bottom; readers expect it at the top.",
      "    ax.invert_yaxis()",
    );
  }
  if (spec.significance) out.push("    mark_significance(ax, df, categories, positions)");
  out.push("");
}

function emitDistribution(spec: FigureSpec & { kind: "box" | "violin" }, out: string[]): void {
  const violin = spec.kind === "violin";
  out.push(
    "",
    "def draw_panel(ax, df):",
    "    categories = category_order(df)",
    "    groups = [df[df[X_FIELD] == c][Y_FIELD].dropna().to_numpy(dtype=float) for c in categories]",
    "    groups = [g if len(g) else np.array([np.nan]) for g in groups]",
    "    positions = np.arange(len(categories))",
  );

  if (violin) {
    out.push(
      "    parts = ax.violinplot(",
      "        groups,",
      "        positions=positions,",
      `        showmedians=${spec.show_box ? "False" : "True"},`,
      "        showextrema=False,",
      "        widths=0.7,",
      "    )",
      '    for index, body in enumerate(parts["bodies"]):',
      "        body.set_facecolor(PALETTE[index % len(PALETTE)])",
      "        body.set_alpha(0.55)",
      '        body.set_edgecolor("white")',
    );
    if (spec.show_box) {
      out.push(
        "    ax.boxplot(",
        "        groups,",
        "        positions=positions,",
        "        widths=0.14,",
        "        showfliers=False,",
        "        patch_artist=True,",
        '        boxprops={"facecolor": "white", "linewidth": 0.8},',
        '        medianprops={"color": "#202020", "linewidth": 1.2},',
        '        whiskerprops={"linewidth": 0.8},',
        '        capprops={"linewidth": 0.8},',
        "    )",
      );
    }
  } else {
    out.push(
      "    drawn = ax.boxplot(",
      "        groups,",
      "        positions=positions,",
      "        widths=0.6,",
      `        notch=${spec.notch ? "True" : "False"},`,
      "        showfliers=True,",
      "        patch_artist=True,",
      '        medianprops={"color": "#202020", "linewidth": 1.2},',
      '        flierprops={"marker": "o", "markersize": 2, "markerfacecolor": "#808080", "markeredgecolor": "none"},',
      "    )",
      '    for index, box in enumerate(drawn["boxes"]):',
      "        box.set_facecolor(PALETTE[index % len(PALETTE)])",
      "        box.set_alpha(0.55)",
      '        box.set_edgecolor("#404040")',
      "        box.set_linewidth(0.8)",
    );
  }

  if (spec.show_points) {
    out.push(
      "    jitter = np.random.default_rng(POINT_JITTER_SEED)",
      "    for index, values in enumerate(groups):",
      "        spread = jitter.uniform(-0.09, 0.09, size=len(values))",
      "        ax.scatter(",
      "            np.full(len(values), index) + spread,",
      "            values,",
      "            s=6,",
      '            color="#303030",',
      "            alpha=0.5,",
      "            zorder=4,",
      "            linewidths=0,",
      "        )",
    );
  }

  out.push(
    "    ax.set_xticks(positions)",
    "    ax.set_xticklabels([str(value) for value in categories])",
    "",
  );
}

function emitHeatmap(spec: FigureSpec & { kind: "heatmap" }, out: string[]): void {
  out.push(
    "",
    "def draw_panel(ax, df):",
    "    matrix = df.pivot_table(",
    "        index=Y_FIELD,",
    "        columns=X_FIELD,",
    "        values=VALUE_FIELD,",
    `        aggfunc=${pyStr(spec.aggregation)},`,
    "        sort=False,",
    "    )",
    "    values = matrix.to_numpy(dtype=float)",
  );

  if (spec.diverging) {
    out.push(
      "    reach = float(np.nanmax(np.abs(values))) if np.isfinite(values).any() else 1.0",
      "    image = ax.imshow(",
      "        values,",
      '        aspect="auto",',
      "        cmap=DIVERGING_MAP,",
      "        vmin=-reach,",
      "        vmax=reach,",
      "    )",
    );
  } else {
    out.push("    image = ax.imshow(values, aspect=\"auto\", cmap=SEQUENTIAL_MAP)");
  }

  out.push(
    "    ax.set_xticks(range(len(matrix.columns)))",
    "    ax.set_xticklabels([str(c) for c in matrix.columns])",
    "    ax.set_yticks(range(len(matrix.index)))",
    "    ax.set_yticklabels([str(i) for i in matrix.index])",
    "    bar = ax.figure.colorbar(image, ax=ax)",
    "    bar.set_label(VALUE_LABEL)",
  );

  if (spec.annotate_cells) {
    out.push(
      "    # White on dark, black on light, so the number stays readable either way.",
      "    span = np.nanmax(values) - np.nanmin(values) if np.isfinite(values).any() else 1.0",
      "    midpoint = np.nanmin(values) + span / 2 if span else 0.0",
      "    # One precision for every cell, so the grid reads like a table.",
      "    reach = np.nanmax(np.abs(values)) if np.isfinite(values).any() else 1.0",
      "    digits = 0 if reach >= 100 else 1 if reach >= 10 else 2 if reach >= 1 else 3",
      "    for row in range(values.shape[0]):",
      "        for column in range(values.shape[1]):",
      "            cell = values[row, column]",
      "            if not np.isfinite(cell):",
      "                continue",
      "            ax.text(",
      "                column,",
      "                row,",
      '                f"{cell:.{digits}f}",',
      '                ha="center",',
      '                va="center",',
      '                color="white" if cell > midpoint else "#111111",',
      "                fontsize=ANNOTATION_PT - 1,",
      "            )",
    );
  }
  out.push("");
}

export function emitDraw(spec: PlottedSpec, out: string[]): void {
  emitSeriesHelpers(spec, out);
  if (spec.kind === "bar" || spec.kind === "box" || spec.kind === "violin") {
    emitCategories(spec, out);
  }

  switch (spec.kind) {
    case "line":
      emitLine(spec, out);
      break;
    case "scatter":
      emitScatter(spec, out);
      break;
    case "bar":
      emitBar(spec, out);
      break;
    case "box":
    case "violin":
      emitDistribution(spec, out);
      break;
    case "heatmap":
      emitHeatmap(spec, out);
      break;
    default: {
      const unhandled: never = spec;
      throw new Error(`no emitter for kind ${JSON.stringify(unhandled)}`);
    }
  }
}
