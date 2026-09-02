# GraphUnslopify

An MCP server that turns a JSON figure spec into matplotlib code.
Live at [json-translator-three.vercel.app](https://json-translator-three.vercel.app).

![Grouped horizontal bar chart of favourite ice cream flavours, split by age group](docs/first-pass.png)

*First pass with the translation tool with JSON*

Nothing in the spec sets a colour, a line width, or a font size. The generator picks those, which is
how two figures in one paper end up agreeing with each other.

![The same chart with the Adults series hatched](docs/second-pass.png)

*Same JSON, after the improvements*

Adults is hatched now. The spec did not change, the tool did.

| First pass | After |
| --- | --- |
| ![First pass in greyscale, both series the same grey](docs/first-pass-greyscale.png) | ![Second pass in greyscale, one series hatched](docs/second-pass-greyscale.png) |

*Both of them printed in black and white*

This is why the hatching is there. Okabe-Ito is colourblind-safe but not greyscale-safe, so blue and
vermillion land 0.07 apart in relative luminance, under the 0.10 a reader needs. Reordering the
palette does not save it. Of all 40,320 orderings the best still leaves four series 0.094 apart.
Hatching does save it, at any number of series.

Line, scatter, bar, box, violin, heatmap and table. Faceting into panels, Pareto frontiers, stacked
bars, smoothing, sorting, filtering, derived values, direct labelling, and venue presets that set
the column width and font floor from the real submission guides.

## Third pass, the rest of the chart types

| | |
| --- | --- |
| ![Heatmap of cafe customers by weekday and hour](docs/third-pass-heatmap.png) | ![Box plot of order wait times by store with a target line](docs/third-pass-box.png) |
| ![Scatter of menu price against rating with a Pareto frontier](docs/third-pass-pareto.png) | ![Stacked bars of drink units sold by store](docs/third-pass-stacked.png) |

*Made-up coffee chain data, one chart per kind*

The data is invented, but each chart is the right choice for its question rather than a demo of the
feature. The heatmap finds the weekday commuter spike at 8am and the weekend brunch block without
being told either exists. The scatter draws the Pareto frontier. The box plot carries a target line
that says what it means, `"meaning": "target"`, and lets the generator decide how a target is drawn.

Building these found two bugs, and neither had shown up across thirty earlier figures. A scatter's
legend handle is a `PathCollection`, which has no marker to read, so four genuinely distinct marker
shapes all looked identical and the greyscale check complained about a problem the emitter had
already solved. And a colourbar is an axes, so every heatmap looked like two panels disagreeing
about their ranges.

The third finding was mine, not the tool's. It told me the legend was sitting on three data points
and suggested moving it outside, so I did.

## Fourth pass, most of it switched on at once

![Four training curves with confidence bands, two reference lines and two annotations](docs/fourth-pass-showcase.png)

*Every feature that fits on one figure*

Four methods, mean of five seeds with 95% bootstrap intervals, two reference lines that state what
they mean rather than how they look, and two annotations placed at `"crossover"` and `"max"` instead
of at coordinates. NeurIPS column width, and a dash pattern per series so it survives a black and
white print. The spec names no colour and no position.

```json
{
  "kind": "line",
  "x": { "field": "epoch", "label": "Training epoch" },
  "y": { "field": "accuracy", "label": "Top-1 accuracy", "unit": "%" },
  "group": "method",
  "aggregation": "mean",
  "uncertainty": { "kind": "ci", "level": 0.95, "over": "seed", "display": "band" },
  "series_order": ["ResNet-50", "+ MixUp", "+ Distill", "Ours"],
  "emphasis": { "series": "Ours" },
  "reference_lines": [
    { "axis": "y", "value": 76.5, "meaning": "human", "label": "prior SOTA" },
    { "axis": "x", "value": 8, "meaning": "threshold", "label": "warmup ends" }
  ],
  "annotate": [
    { "at": "crossover", "series": "Ours", "text": "overtakes" },
    { "at": "max", "series": "Ours", "text": "83.1%" }
  ],
  "style": { "venue": "neurips" }
}
```

![The same four curves labelled at the end of each line instead of in a legend](docs/fourth-pass-direct-labels.png)

*Direct labelling, which sidesteps the legend entirely*

A legend box has to sit somewhere, and somewhere is usually on top of the data. Setting
`legend.style` to `direct` puts each name at the end of its own line.

### The part you cannot see

A figure can now carry the claim it makes, and the script tests it against the data. The integrity
work names this failure exactly, a caption asserting a gain the figure does not show, and notes that
looking at pixels cannot catch it because the checker cannot read the manuscript.

```json
"claims": [
  { "kind": "beats_everywhere", "subject": "ours", "reference": "baseline" },
  { "kind": "gap_widens", "subject": "ours", "reference": "baseline" }
]
```

Run against data where the baseline leads early, that prints:

```text
claims:
  FAILS     ours is above baseline at every x (12 of 20 x values are not above baseline)
            the figure does not support this. Do not write it in the caption.
  HOLDS     ours pulls further ahead of baseline as x grows (gap moves from -5.2 to +3.8)
```

Alt text writes itself, which several journals now require. Levels one to three of the accessibility
model are derivable, so the spec supplies the encoding and the script supplies the numbers and the
trend. Level four is left to you rather than invented, because guessing at why a result matters is
the fabrication this tool exists to avoid. Only claims that held get quoted.

Each figure also writes a `.tex` block at the right column width, an optional interactive HTML
version through plotly, and a hash of the data file so a stale figure can say so.

### One appearance per series, across a whole paper

| Figure 1 | Figure 7 |
| --- | --- |
| ![Two curves, baseline blue and ours orange](docs/lock-figure-1.png) | ![Three curves with baseline still blue and ours still orange](docs/lock-figure-2.png) |

*The second figure lists the series in a different order and adds a third*

`series_order` fixed colour inside one spec while figure 1 and figure 7 were free to disagree. Point
`palette_lock` at a shared file and the first figure to mention a series claims an appearance for
it. Adding a method later does not recolour the ones already in the paper.

## Fifth pass, composition and a library on top

| | |
| --- | --- |
| ![A y axis with 30 to 60 cut out and slanted marks at the join](docs/fifth-pass-axis-break.png) | ![The same curves with a magnified corner and its source region marked](docs/fifth-pass-inset.png) |

*A cut axis and a zoomed inset*

Extra marks over the same axes, one panel per metric, a gap cut out of an axis, and a magnified
corner. Vega-Lite's operators compose recursively, which is more than this needs. What recurs in a
paper is a short flat list, so that is what the spec takes.

```json
{
  "layers": [{ "mark": "scatter", "label": "observations" }, { "mark": "rug" }],
  "repeat": { "fields": ["accuracy", "loss", "latency_ms"], "columns": 3 },
  "axis_break": { "axis": "y", "from": 30, "to": 60 },
  "inset": { "x": [14, 20], "y": [65, 85], "corner": "lower_right" }
}
```

A cut axis is drawn as two stacked axes with slanted marks at the join. The marks are the point.
Without them a reader takes the axis for continuous and misreads every distance across the gap,
which is the failure the truncation literature is about.

There is a `table` kind now, because sometimes six numbers should not be a chart. A printed number
is exact rather than estimated, so it outranks every graphical channel for reading one value. One
spec writes markdown, LaTeX and an image, so the readme, the manuscript and the slides cannot drift
apart, and `highlight` bolds the winner in each row or column.

### Writing specs in Python

The MCP tools are for an agent. `graphunslopify.Figure` is the same thing for a person in a
notebook.

```python
from graphunslopify import Figure

(
    Figure.line("results.csv")
    .x("epoch", "Training epoch")
    .y("accuracy", "Test accuracy", unit="%")
    .by("model", order=["baseline", "ours"], emphasise="ours")
    .average_over("seed")
    .claim("beats_everywhere", "ours", "baseline")
    .venue("neurips")
    .render()
)
```

`average_over` sets the aggregation and the spread together, because doing one without the other
throws away what a reader most needs. `render` posts the spec, writes the script beside the data and
runs it, so what lands on disk is the same script an agent would have got. Nothing here
reimplements the emitter, because two emitters drift. `Figure.from_profile` skips the guessing
entirely by ranking candidates for a file and starting from the best one.

## Writing a spec

Do not guess at the data. Ask it:

```bash
pip install ./python
graphunslopify describe results.csv
```

That reports the columns, their roles, how many distinct values each has, and whether x repeats per
series, along with a starting spec. On the example data it picks `epoch` over `seed` as the x axis
and adds the aggregation and confidence interval the repeats require.

Then hand that profile to `suggest_figures` and get candidates back, ranked by a weighted cost in
the shape Draco uses. The weights come from the Cleveland and McGill accuracy ranking, so a design
that reads by length scores worse than one that reads by position, and the suggestion quotes the
measured ratio rather than asserting a preference.

`apply_fixes` repairs a spec using its own findings. Every finding carries a machine-readable patch,
because the agent literature reports models recognising an error and failing to act on it, which is
an interface problem rather than a reasoning one. The loop has a budget so it says what it could not
fix instead of churning.

`list_recipes` has eleven known-good specs to start from. `validate_spec` checks one without
generating anything, and `score_spec` costs one so two can be compared.

## Connecting

```bash
claude mcp add --transport http graph-unslopify https://json-translator-three.vercel.app/api/mcp
```

Your data never leaves your machine. You get back a script that reads your own CSV.

## Other output formats

Set `animate` and the same figure draws itself as a gif or an mp4.

```json
{ "animate": { "style": "draw", "duration_s": 4, "easing": "smooth", "format": "gif" } }
```

Set `output.interactive` and you also get a self-contained HTML figure through plotly, with hover
and zoom, which is what a project page wants and a paper does not. Set `output.latex` and you get an
`\includegraphics` block at the right column width with the caption and alt text already in it.

On manim, with evidence rather than an opinion. It does not install here: `moderngl` and `glcontext`
fail to build wheels, needing a C toolchain. Even where it does install it draws its own axes rather
than the ones this spent so long getting right. What actually makes those animations read well is
easing and staged construction, and both are a few lines over `FuncAnimation`. The rate functions
are ports of manim's and keep its names, so `easing: "rush_into"` does what you would expect. plotly
and scipy install cleanly and are used; scipy makes the t-test and Mann-Whitney options real rather
than a fallback.

## What checks the work

Forty-seven rules run on the spec alone, on the server. The rendered figure is checked separately by
the Python package, which measures text at the width it will be printed, finds colliding tick
labels, a legend covering data, series a reader cannot separate, series that merge in greyscale, a
truncated bar axis, and panels that disagree.

`docs/research.md` maps every rule to the paper or policy behind it. `examples/README.md` covers the
gallery and why its images are committed.
